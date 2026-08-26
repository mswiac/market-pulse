import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { fireEvent, render, screen } from '@testing-library/angular/zoneless';
import { RemoveUserConfirm, RemoveUserConfirmData } from './remove-user-confirm';

async function renderConfirm(data: RemoveUserConfirmData) {
  const close = vi.fn();
  const result = await render(RemoveUserConfirm, {
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close } },
    ],
  });
  return { ...result, close };
}

describe('RemoveUserConfirm', () => {
  it('shows only the alerts warning when only alertsCount is greater than zero', async () => {
    await renderConfirm({ email: 'user@example.com', alertsCount: 2, triggerEventsCount: 0 });

    expect(screen.getByText('User: user@example.com')).toBeTruthy();
    expect(screen.getByText('This will also delete 2 alert(s).')).toBeTruthy();
    expect(screen.queryByText(/trigger event\(s\) from the history/)).toBeNull();
  });

  it('shows only the trigger-events warning when only triggerEventsCount is greater than zero', async () => {
    await renderConfirm({ email: 'user@example.com', alertsCount: 0, triggerEventsCount: 5 });

    expect(screen.queryByText(/alert\(s\)\./)).toBeNull();
    expect(screen.getByText('This will also delete 5 trigger event(s) from the history.')).toBeTruthy();
  });

  it('calls close(true) when the Remove button is clicked', async () => {
    const { close } = await renderConfirm({ email: 'user@example.com', alertsCount: 0, triggerEventsCount: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(close).toHaveBeenCalledWith(true);
  });

  it('calls close with no confirmation value when Cancel is clicked', async () => {
    const { close } = await renderConfirm({ email: 'user@example.com', alertsCount: 0, triggerEventsCount: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(close).toHaveBeenCalledWith('');
  });
});
