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
}) {
  const dialogSubject = new Subject<boolean | undefined>();
  const dialogOpen = vi.fn(() => ({ afterClosed: () => dialogSubject.asObservable() }));
  const removeInstrument =
    options?.removeInstrument ?? vi.fn(() => of<RemovedInstrument>({ ticker: '^NDX', alertsDeleted: 2 }));
  const reload = vi.fn(() => of(INSTRUMENTS));

  const result = await render(RemoveInstrument, {
    providers: [
      {
        provide: InstrumentsService,
        useValue: {
          instruments: () => INSTRUMENTS,
          types: () => [...new Set(INSTRUMENTS.map((i) => i.type))],
          ensureLoaded: () => of(INSTRUMENTS),
          reload,
        },
      },
      {
        provide: AdminService,
        useValue: {
          getInstrumentImpact:
            options?.getInstrumentImpact ?? (() => of<InstrumentImpact>({ ticker: '^NDX', alertsCount: 2 })),
          removeInstrument,
        },
      },
      { provide: MatDialog, useValue: { open: dialogOpen } },
    ],
    // `MatDialogModule` (pulled in via the component's own `imports`) redundantly
    // re-provides the real `MatDialog` at module level despite it being
    // `providedIn: 'root'`, which shadows a root-level TestBed override — drop
    // the import for this test so the stub above is what actually resolves.
    importOverrides: [{ replace: MatDialogModule, with: [] }],
  });
  const component = result.fixture.componentInstance as unknown as { onTypeChange: (type: string) => void };
  return { ...result, component, dialogOpen, dialogSubject, removeInstrument, reload };
}

describe('RemoveInstrument', () => {
  it('narrows the instrument picker to the selected type', async () => {
    const { fixture, component } = await renderRemoveInstrument();

    component.onTypeChange('pl_stock');
    fixture.detectChanges();

    expect(await screen.findByText('CD Projekt')).toBeTruthy();
  });

  it('previews impact, opens the confirm dialog with that data, and removes the instrument on confirm', async () => {
    const { fixture, dialogOpen, dialogSubject, removeInstrument, reload } = await renderRemoveInstrument();
    const submitButton = () => screen.getByRole('button', { name: 'Remove instrument' }) as HTMLButtonElement;

    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(dialogOpen).toHaveBeenCalledWith(expect.anything(), { data: { ticker: '^NDX', alertsCount: 2 } });
    expect(removeInstrument).not.toHaveBeenCalled();

    dialogSubject.next(true);
    fixture.detectChanges();

    expect(removeInstrument).toHaveBeenCalledWith('^NDX');
    expect(reload).toHaveBeenCalled();
    expect(await screen.findByText('Removed ^NDX (2 alert(s) deleted).')).toBeTruthy();
  });

  it('shows the error message and never opens the dialog when the impact preview fails', async () => {
    const { fixture, dialogOpen } = await renderRemoveInstrument({
      getInstrumentImpact: () => throwError(() => new HttpErrorResponse({ status: 404, error: { code: 'unknown_instrument' } })),
    });
    const submitButton = () => screen.getByRole('button', { name: 'Remove instrument' }) as HTMLButtonElement;

    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(await screen.findByText('Unknown instrument.')).toBeTruthy();
    expect(dialogOpen).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(false);
  });

  it('does not remove the instrument when the confirm dialog is cancelled', async () => {
    const { fixture, dialogSubject, removeInstrument } = await renderRemoveInstrument();
    const submitButton = () => screen.getByRole('button', { name: 'Remove instrument' }) as HTMLButtonElement;

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
    const submitButton = () => screen.getByRole('button', { name: 'Remove instrument' }) as HTMLButtonElement;

    fireEvent.click(submitButton());
    fixture.detectChanges();
    dialogSubject.next(true);
    fixture.detectChanges();

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
  });
});
