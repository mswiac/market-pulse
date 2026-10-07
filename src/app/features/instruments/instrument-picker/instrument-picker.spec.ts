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
});
