import { HttpErrorResponse } from '@angular/common/http';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { fireEvent, render, screen } from '@testing-library/angular/zoneless';
import { Subject, of, throwError } from 'rxjs';
import { Instrument, InstrumentsService } from '../../instruments/instruments.service';
import { AdminService, InstrumentImpact, RemovedInstrument } from '../admin-panel.service';
import { RemoveInstrument } from './remove-instrument';

const INSTRUMENTS: Instrument[] = [
  { ticker: '^NDX', name: 'NASDAQ-100', type: 'index', rsiEligible: true, currency: 'USD' },
  { ticker: 'CDR', name: 'CD Projekt', type: 'pl_stock', rsiEligible: true, currency: 'PLN' },
];

async function renderRemoveInstrument(options?: {
  getInstrumentImpact?: () => ReturnType<AdminService['getInstrumentImpact']>;
  removeInstrument?: ReturnType<typeof vi.fn>;
  // Nothing is selected on load; most tests are about the flow after a choice,
  // so they start with ^NDX picked. Pass '' to keep the picker empty.
  initialTicker?: string;
  catalogue?: Instrument[];
  ensureLoaded?: () => ReturnType<InstrumentsService['ensureLoaded']>;
}) {
  const dialogSubject = new Subject<boolean | undefined>();
  const dialogOpen = vi.fn(() => ({ afterClosed: () => dialogSubject.asObservable() }));
  const getInstrumentImpact = vi.fn(
    options?.getInstrumentImpact ??
      (() => of<InstrumentImpact>({ ticker: '^NDX', alertsCount: 2 })),
  );
  const removeInstrument =
    options?.removeInstrument ??
    vi.fn(() => of<RemovedInstrument>({ ticker: '^NDX', alertsDeleted: 2 }));
  const reload = vi.fn(() => of(INSTRUMENTS));

  const result = await render(RemoveInstrument, {
    providers: [
      {
        provide: InstrumentsService,
        useValue: {
          instruments: () => options?.catalogue ?? INSTRUMENTS,
          types: () => [...new Set((options?.catalogue ?? INSTRUMENTS).map((i) => i.type))],
          ensureLoaded: options?.ensureLoaded ?? (() => of(INSTRUMENTS)),
          reload,
        },
      },
      {
        provide: AdminService,
        useValue: { getInstrumentImpact, removeInstrument },
      },
      { provide: MatDialog, useValue: { open: dialogOpen } },
    ],
    // `MatDialogModule` (pulled in via the component's own `imports`) redundantly
    // re-provides the real `MatDialog` at module level despite it being
    // `providedIn: 'root'`, which shadows a root-level TestBed override — drop
    // the import for this test so the stub above is what actually resolves.
    importOverrides: [{ replace: MatDialogModule, with: [] }],
  });
  const component = result.fixture.componentInstance as unknown as {
    onTickerChange: (ticker: string) => void;
    onSubmit: () => void;
    submitting: () => boolean;
  };
  const initialTicker = options?.initialTicker ?? '^NDX';
  if (initialTicker) {
    component.onTickerChange(initialTicker);
    result.fixture.detectChanges();
  }
  return {
    ...result,
    component,
    dialogOpen,
    dialogSubject,
    getInstrumentImpact,
    removeInstrument,
    reload,
  };
}

describe('RemoveInstrument', () => {
  it('shows a load error and no picker when the instrument catalogue cannot be loaded', async () => {
    await renderRemoveInstrument({ initialTicker: '', ensureLoaded: () => throwError(() => new Error('offline')) });

    expect(screen.getByText(/Failed to load instruments/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove instrument' })).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('tells the admin there is nothing to remove when the catalogue is empty', async () => {
    await renderRemoveInstrument({ initialTicker: '', catalogue: [], ensureLoaded: () => of([]) });

    expect(screen.getByText('No instruments available to remove.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove instrument' })).toBeNull();
  });

  it('starts with nothing selected and the remove button disabled', async () => {
    const { fixture, getInstrumentImpact } = await renderRemoveInstrument({ initialTicker: '' });
    fixture.detectChanges();

    expect((screen.getByRole('combobox', { name: 'Instrument' }) as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('button', { name: 'Remove instrument' }) as HTMLButtonElement).disabled).toBe(true);
    expect(getInstrumentImpact).not.toHaveBeenCalled();
  });

  it('enables the remove button once an instrument is chosen in the picker', async () => {
    const { fixture } = await renderRemoveInstrument({ initialTicker: '' });
    const input = screen.getByRole('combobox', { name: 'Instrument' }) as HTMLInputElement;

    input.focus();
    fireEvent.input(input, { target: { value: 'cdr' } });
    fixture.detectChanges();
    fireEvent.click(await screen.findByRole('option', { name: 'CDR — CD Projekt' }));
    fixture.detectChanges();

    expect((screen.getByRole('button', { name: 'Remove instrument' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('previews impact, opens the confirm dialog with that data, and removes the instrument on confirm', async () => {
    const { fixture, dialogOpen, dialogSubject, removeInstrument, reload } =
      await renderRemoveInstrument();
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove instrument' }) as HTMLButtonElement;

    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(dialogOpen).toHaveBeenCalledWith(expect.anything(), {
      data: { ticker: '^NDX', alertsCount: 2 },
    });
    expect(removeInstrument).not.toHaveBeenCalled();

    dialogSubject.next(true);
    fixture.detectChanges();

    expect(removeInstrument).toHaveBeenCalledWith('^NDX');
    expect(reload).toHaveBeenCalled();
    expect(await screen.findByText('Removed ^NDX (2 alert(s) deleted).')).toBeTruthy();
  });

  it('shows the error message and never opens the dialog when the impact preview fails', async () => {
    const { fixture, dialogOpen } = await renderRemoveInstrument({
      getInstrumentImpact: () =>
        throwError(
          () => new HttpErrorResponse({ status: 404, error: { code: 'unknown_instrument' } }),
        ),
    });
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove instrument' }) as HTMLButtonElement;

    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(await screen.findByText('Unknown instrument.')).toBeTruthy();
    expect(dialogOpen).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(false);
  });

  it('does not remove the instrument when the confirm dialog is cancelled', async () => {
    const { fixture, dialogSubject, removeInstrument } = await renderRemoveInstrument();
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove instrument' }) as HTMLButtonElement;

    fireEvent.click(submitButton());
    fixture.detectChanges();

    dialogSubject.next(undefined);
    fixture.detectChanges();

    expect(removeInstrument).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(false);
  });

  it('falls back to the generic message when removal fails with an unrecognized error code', async () => {
    const removeInstrument = vi.fn(() =>
      throwError(() => new HttpErrorResponse({ status: 500, error: { code: 'totally_unknown' } })),
    );
    const { fixture, dialogSubject } = await renderRemoveInstrument({ removeInstrument });
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove instrument' }) as HTMLButtonElement;

    fireEvent.click(submitButton());
    fixture.detectChanges();
    dialogSubject.next(true);
    fixture.detectChanges();

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
  });

  it('keeps submit disabled across the impact→confirm→delete flow and ignores repeat submits', async () => {
    const impactSubject = new Subject<InstrumentImpact>();
    const deleteSubject = new Subject<RemovedInstrument>();
    const getInstrumentImpact = vi.fn(() => impactSubject);
    const removeInstrument = vi.fn(() => deleteSubject);
    const { fixture, component, dialogSubject } = await renderRemoveInstrument({
      getInstrumentImpact,
      removeInstrument,
    });
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove instrument' }) as HTMLButtonElement;

    // Window 1 — impact preview in flight.
    fireEvent.click(submitButton());
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(true);
    expect(component.submitting()).toBe(true);
    component.onSubmit();
    expect(getInstrumentImpact).toHaveBeenCalledTimes(1);

    // Window 2 — confirm dialog open, awaiting the user.
    impactSubject.next({ ticker: '^NDX', alertsCount: 2 });
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(true);
    expect(component.submitting()).toBe(true);

    // Window 3 — delete request in flight.
    dialogSubject.next(true);
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(true);
    expect(component.submitting()).toBe(true);
    expect(removeInstrument).toHaveBeenCalledTimes(1);
  });

  it('re-enables submit after the delete request fails', async () => {
    const deleteSubject = new Subject<RemovedInstrument>();
    const removeInstrument = vi.fn(() => deleteSubject);
    const { fixture, component, dialogSubject } = await renderRemoveInstrument({
      removeInstrument,
    });
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove instrument' }) as HTMLButtonElement;

    fireEvent.click(submitButton());
    fixture.detectChanges();
    dialogSubject.next(true);
    fixture.detectChanges();

    deleteSubject.error(new HttpErrorResponse({ status: 500 }));
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(false);
    expect(component.submitting()).toBe(false);
  });

  it('stops submitting and clears the selection after a successful delete', async () => {
    const { fixture, component, dialogSubject } = await renderRemoveInstrument();
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove instrument' }) as HTMLButtonElement;

    fireEvent.click(submitButton());
    fixture.detectChanges();
    dialogSubject.next(true);
    fixture.detectChanges();

    // The removed instrument is gone, so nothing is selected and the button
    // stays disabled until the next deliberate choice.
    expect(component.submitting()).toBe(false);
    expect(submitButton().disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Instrument' }) as HTMLInputElement).value).toBe('');
  });

  it('keeps submit disabled and onSubmit inert when no ticker is selected', async () => {
    const getInstrumentImpact = vi.fn(() =>
      of<InstrumentImpact>({ ticker: '^NDX', alertsCount: 2 }),
    );
    const { fixture, component } = await renderRemoveInstrument({ getInstrumentImpact });
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove instrument' }) as HTMLButtonElement;

    component.onTickerChange('');
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(true);
    component.onSubmit();
    expect(getInstrumentImpact).not.toHaveBeenCalled();
  });
});
