import { Component, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular/zoneless';
import { Instrument, InstrumentsService } from '../instruments.service';
import { InstrumentPicker } from './instrument-picker';

const INSTRUMENTS: Instrument[] = [
  { ticker: '^NDX', name: 'NASDAQ-100', type: 'index', rsiEligible: true, currency: 'USD' },
  { ticker: 'CDR', name: 'CD Projekt', type: 'pl_stock', rsiEligible: true, currency: 'PLN' },
  { ticker: 'ZAB', name: 'Żabka', type: 'pl_stock', rsiEligible: true, currency: 'PLN' },
];

const make = (ticker: string, type: string): Instrument => ({ ticker, name: ticker, type, rsiEligible: true, currency: 'USD' });

const providers = [
  {
    provide: InstrumentsService,
    useValue: {
      instruments: () => INSTRUMENTS,
      types: () => [...new Set(INSTRUMENTS.map((i) => i.type))],
    },
  },
];

@Component({
  imports: [InstrumentPicker],
  template: `<app-instrument-picker [ticker]="ticker()" (tickerChange)="ticker.set($event)" />`,
})
class SignalHost {
  ticker = signal('');
}

@Component({
  imports: [InstrumentPicker, ReactiveFormsModule],
  template: `<app-instrument-picker [formControl]="control" />`,
})
class FormHost {
  control = new FormControl('', { nonNullable: true });
}

@Component({
  imports: [InstrumentPicker],
  template: `<app-instrument-picker [disabled]="true" />`,
})
class DisabledHost {}

@Component({
  imports: [InstrumentPicker],
  template: `<app-instrument-picker stacked />`,
})
class StackedHost {}

const combobox = () => screen.getByRole('combobox', { name: 'Instrument' }) as HTMLInputElement;

function type(text: string) {
  const input = combobox();
  input.focus();
  fireEvent.input(input, { target: { value: text } });
}

describe('InstrumentPicker', () => {
  it('offers options in "TICKER — Name" form and selects one by click', async () => {
    const { fixture } = await render(SignalHost, { providers });

    type('cdr');
    fixture.detectChanges();
    fireEvent.click(await screen.findByRole('option', { name: 'CDR — CD Projekt' }));
    fixture.detectChanges();

    expect(fixture.componentInstance.ticker()).toBe('CDR');
    expect(combobox().value).toBe('CDR — CD Projekt');
  });

  it('finds an instrument by a diacritic-free name', async () => {
    const { fixture } = await render(SignalHost, { providers });

    type('zabka');
    fixture.detectChanges();

    expect(await screen.findByRole('option', { name: 'ZAB — Żabka' })).toBeTruthy();
  });

  it('shows "No matches" and keeps the typed text with a hint after blur', async () => {
    const { fixture } = await render(SignalHost, { providers });

    type('qqq');
    fixture.detectChanges();
    expect(await screen.findByText('No matches')).toBeTruthy();

    fireEvent.blur(combobox());
    fixture.detectChanges();

    expect(combobox().value).toBe('qqq');
    expect(fixture.componentInstance.ticker()).toBe('');
    expect(screen.getByText('Choose an instrument from the list')).toBeTruthy();
  });

  it('clears the selection with the clear button', async () => {
    const { fixture } = await render(SignalHost, { providers });
    fixture.componentInstance.ticker.set('CDR');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(combobox().value).toBe('CDR — CD Projekt');

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    fixture.detectChanges();

    expect(fixture.componentInstance.ticker()).toBe('');
    expect(combobox().value).toBe('');
  });

  it('drops the selection as soon as the text is edited', async () => {
    const { fixture } = await render(SignalHost, { providers });
    fixture.componentInstance.ticker.set('CDR');
    fixture.detectChanges();
    await fixture.whenStable();

    type('CDR — CD Proj');
    fixture.detectChanges();

    expect(fixture.componentInstance.ticker()).toBe('');
    expect(combobox().value).toBe('CDR — CD Proj');
  });

  it('clears a selection that does not belong to a newly chosen type', async () => {
    const { fixture } = await render(SignalHost, { providers });
    fixture.componentInstance.ticker.set('CDR');
    fixture.detectChanges();
    await fixture.whenStable();

    const picker = fixture.debugElement.children[0].componentInstance as unknown as {
      onTypeChange: (type: string) => void;
    };
    picker.onTypeChange('index');
    fixture.detectChanges();

    expect(fixture.componentInstance.ticker()).toBe('');
    expect(combobox().value).toBe('');
  });

  it('keeps a selection that matches the newly chosen type', async () => {
    const { fixture } = await render(SignalHost, { providers });
    fixture.componentInstance.ticker.set('CDR');
    fixture.detectChanges();
    await fixture.whenStable();

    const picker = fixture.debugElement.children[0].componentInstance as unknown as {
      onTypeChange: (type: string) => void;
    };
    picker.onTypeChange('pl_stock');
    fixture.detectChanges();

    expect(fixture.componentInstance.ticker()).toBe('CDR');
  });

  it('works as a form control: writes the value in and reports selections out', async () => {
    const { fixture } = await render(FormHost, { providers });
    fixture.componentInstance.control.setValue('ZAB');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(combobox().value).toBe('ZAB — Żabka');

    type('ndx');
    fixture.detectChanges();
    expect(fixture.componentInstance.control.value).toBe('');
    fireEvent.click(await screen.findByRole('option', { name: '^NDX — NASDAQ-100' }));
    fixture.detectChanges();

    expect(fixture.componentInstance.control.value).toBe('^NDX');
  });
  it('selects the highlighted option with the keyboard (ArrowDown, Enter)', async () => {
    const { fixture } = await render(SignalHost, { providers });

    type('cdr');
    fixture.detectChanges();
    await screen.findByRole('option', { name: 'CDR — CD Projekt' });
    fireEvent.keyDown(combobox(), { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 });
    fixture.detectChanges();
    fireEvent.keyDown(combobox(), { key: 'Enter', code: 'Enter', keyCode: 13 });
    fixture.detectChanges();

    expect(fixture.componentInstance.ticker()).toBe('CDR');
    expect(combobox().value).toBe('CDR — CD Projekt');
  });

  it('keeps a ticker set before the catalogue loads and shows its label once instruments arrive', async () => {
    const loaded = signal<Instrument[]>([]);
    const { fixture } = await render(SignalHost, {
      providers: [
        {
          provide: InstrumentsService,
          useValue: { instruments: () => loaded(), types: () => [...new Set(loaded().map((i) => i.type))] },
        },
      ],
    });
    fixture.componentInstance.ticker.set('CDR');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(combobox().value).toBe('');

    loaded.set(INSTRUMENTS);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.ticker()).toBe('CDR');
    expect(combobox().value).toBe('CDR — CD Projekt');
  });

  it('disables the search field from the disabled input', async () => {
    await render(DisabledHost, { providers });

    expect(combobox().disabled).toBe(true);
  });

  it('disables the search field when the form control is disabled', async () => {
    const { fixture } = await render(FormHost, { providers });
    fixture.componentInstance.control.disable();
    fixture.detectChanges();

    expect(combobox().disabled).toBe(true);
  });

  it('marks the host as stacked when asked to', async () => {
    const { container } = await render(StackedHost, { providers });

    expect(container.querySelector('app-instrument-picker')!.classList.contains('stacked')).toBe(true);
  });

  it('lists the instrument types alphabetically by their label', async () => {
    const reversed = ['us_stock', 'pl_stock', 'index'];
    const instruments = reversed.map((t) => make(t, t));
    const { fixture } = await render(SignalHost, {
      providers: [{ provide: InstrumentsService, useValue: { instruments: () => instruments, types: () => reversed } }],
    });
    const picker = fixture.debugElement.children[0].componentInstance as unknown as {
      types: () => string[];
      typeLabel: (type: string) => string;
    };

    const labels = picker.types().map((t) => picker.typeLabel(t));
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    expect(picker.types()).not.toEqual(reversed);
  });

  it('offers the whole catalogue again once an instrument is selected', async () => {
    const { fixture } = await render(SignalHost, { providers });
    fixture.componentInstance.ticker.set('CDR');
    fixture.detectChanges();
    await fixture.whenStable();

    fireEvent.focus(combobox());
    fireEvent.click(combobox());
    fixture.detectChanges();

    expect(await screen.findByRole('option', { name: '^NDX — NASDAQ-100' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'ZAB — Żabka' })).toBeTruthy();
  });

  it('shows the invalid hint only after blur, with unmatched text and nothing selected', async () => {
    const { fixture } = await render(SignalHost, { providers });
    const hint = () => screen.queryByText('Choose an instrument from the list');

    type('qqq');
    fixture.detectChanges();
    expect(hint()).toBeNull();

    fireEvent.blur(combobox());
    fixture.detectChanges();
    expect(hint()).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    fixture.detectChanges();
    type('qqq');
    fixture.detectChanges();
    expect(hint()).toBeNull();
  });

  it('shows no hint after blur when the field is empty or an instrument is selected', async () => {
    const { fixture } = await render(SignalHost, { providers });
    const hint = () => screen.queryByText('Choose an instrument from the list');

    fireEvent.blur(combobox());
    fixture.detectChanges();
    expect(hint()).toBeNull();

    fixture.componentInstance.ticker.set('CDR');
    fixture.detectChanges();
    await fixture.whenStable();
    fireEvent.blur(combobox());
    fixture.detectChanges();
    expect(hint()).toBeNull();
  });

  it('marks the bound form control as touched on blur but not as dirty while typing without a selection', async () => {
    const { fixture } = await render(FormHost, { providers });
    const { control } = fixture.componentInstance;

    type('c');
    fixture.detectChanges();
    expect(control.dirty).toBe(false);
    expect(control.touched).toBe(false);

    fireEvent.blur(combobox());
    fixture.detectChanges();
    expect(control.touched).toBe(true);
  });

  it('resets the selection when the form control is written with null', async () => {
    const { fixture } = await render(FormHost, { providers });
    fixture.componentInstance.control.setValue('CDR');
    fixture.detectChanges();
    await fixture.whenStable();
    const picker = fixture.debugElement.children[0].componentInstance as unknown as { ticker: () => string };
    expect(picker.ticker()).toBe('CDR');

    fixture.componentInstance.control.setValue(null as unknown as string);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(picker.ticker()).toBe('');
    expect(combobox().value).toBe('');
  });

  it('starts with nothing selected and displays an unknown ticker as itself', async () => {
    const { fixture } = await render(DisabledHost, { providers });
    const picker = fixture.debugElement.children[0].componentInstance as unknown as {
      ticker: () => string;
      displayWith: (ticker: string) => string;
    };

    expect(picker.ticker()).toBe('');
    expect(picker.displayWith('CDR')).toBe('CDR — CD Projekt');
    expect(picker.displayWith('NOPE')).toBe('NOPE');
  });

  it('keeps text typed after an outside clear when the catalogue reloads', async () => {
    const loaded = signal<Instrument[]>(INSTRUMENTS);
    const { fixture } = await render(SignalHost, {
      providers: [
        {
          provide: InstrumentsService,
          useValue: { instruments: () => loaded(), types: () => [...new Set(loaded().map((i) => i.type))] },
        },
      ],
    });
    fixture.componentInstance.ticker.set('CDR');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.ticker.set('');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(combobox().value).toBe('');

    type('abc');
    fixture.detectChanges();
    loaded.set([...INSTRUMENTS]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(combobox().value).toBe('abc');
  });

  it('is not stacked by default', async () => {
    const { container } = await render(DisabledHost, { providers });

    expect(container.querySelector('app-instrument-picker')!.classList.contains('stacked')).toBe(false);
  });
});
