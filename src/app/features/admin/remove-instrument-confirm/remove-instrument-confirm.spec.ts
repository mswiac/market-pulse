import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { fireEvent, render, screen } from '@testing-library/angular/zoneless';
import { RemoveInstrumentConfirm, RemoveInstrumentConfirmData } from './remove-instrument-confirm';

async function renderConfirm(data: RemoveInstrumentConfirmData) {
  const close = vi.fn();
  const result = await render(RemoveInstrumentConfirm, {
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close } },
    ],
  });
  return { ...result, close };
}

describe('RemoveInstrumentConfirm', () => {
  it('hides the alerts warning when alertsCount is zero', async () => {
    await renderConfirm({ ticker: '^NDX', alertsCount: 0 });

    expect(screen.getByText('Instrument: ^NDX')).toBeTruthy();
    expect(screen.queryByText(/alert\(s\) belonging to other users/)).toBeNull();
  });

  it('shows the alerts warning when alertsCount is greater than zero', async () => {
    await renderConfirm({ ticker: '^NDX', alertsCount: 3 });

    expect(screen.getByText('Instrument: ^NDX')).toBeTruthy();
    expect(screen.getByText('This will also delete 3 alert(s) belonging to other users.')).toBeTruthy();
  });

  it('calls close(true) when the Remove button is clicked', async () => {
    const { close } = await renderConfirm({ ticker: '^NDX', alertsCount: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(close).toHaveBeenCalledWith(true);
  });

  it('calls close with no confirmation value when Cancel is clicked', async () => {
    const { close } = await renderConfirm({ ticker: '^NDX', alertsCount: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // Bare `mat-dialog-close` (no value binding) closes with '', not `true` —
    // the opener's `.subscribe((confirmed) => ...)` treats both '' and
    // `undefined` as falsy, so this still exercises the cancel branch.
    expect(close).toHaveBeenCalledWith('');
  });
});
