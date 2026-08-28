import { HttpErrorResponse } from '@angular/common/http';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { fireEvent, render, screen } from '@testing-library/angular/zoneless';
import { Subject, of, throwError } from 'rxjs';
import { AdminService, AdminUser, RemovedUser, UserImpact } from '../admin-panel.service';
import { RemoveUser } from './remove-user';

const USERS: AdminUser[] = [
  { id: 1, email: 'admin@example.com' },
  { id: 2, email: 'user@example.com' },
];

async function renderRemoveUser(options?: {
  listUsers?: () => ReturnType<AdminService['listUsers']>;
  getUserImpact?: () => ReturnType<AdminService['getUserImpact']>;
  removeUser?: ReturnType<typeof vi.fn>;
}) {
  const dialogSubject = new Subject<boolean | undefined>();
  const dialogOpen = vi.fn(() => ({ afterClosed: () => dialogSubject.asObservable() }));
  const listUsers = vi.fn(options?.listUsers ?? (() => of(USERS)));
  const getUserImpact = vi.fn(
    options?.getUserImpact ??
      (() =>
        of<UserImpact>({
          id: 1,
          email: 'admin@example.com',
          alertsCount: 1,
          triggerEventsCount: 2,
        })),
  );
  const removeUser =
    options?.removeUser ??
    vi.fn(() =>
      of<RemovedUser>({
        id: 1,
        email: 'admin@example.com',
        alertsDeleted: 1,
        triggerEventsDeleted: 2,
      }),
    );

  const result = await render(RemoveUser, {
    providers: [
      {
        provide: AdminService,
        useValue: { listUsers, getUserImpact, removeUser },
      },
      { provide: MatDialog, useValue: { open: dialogOpen } },
    ],
    // See remove-instrument.spec.ts: MatDialogModule redundantly re-provides
    // the real MatDialog at module level, shadowing a root-level TestBed override.
    importOverrides: [{ replace: MatDialogModule, with: [] }],
  });
  const component = result.fixture.componentInstance as unknown as {
    users: () => AdminUser[];
    selectedUserId: () => number | null;
    onUserChange: (id: number | null) => void;
    onSubmit: () => void;
    submitting: () => boolean;
  };
  return { ...result, component, dialogOpen, dialogSubject, listUsers, getUserImpact, removeUser };
}

describe('RemoveUser', () => {
  it('shows the load-error message when the user list fails to load', async () => {
    await renderRemoveUser({
      listUsers: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });

    expect(
      await screen.findByText('Failed to load users. Please refresh the page and try again.'),
    ).toBeTruthy();
  });

  it('previews impact, opens the confirm dialog with that data, removes the user, and re-fetches the list', async () => {
    const { fixture, dialogOpen, dialogSubject, removeUser, listUsers } = await renderRemoveUser();
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove user' }) as HTMLButtonElement;

    expect(await screen.findByText('admin@example.com')).toBeTruthy();
    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(dialogOpen).toHaveBeenCalledWith(expect.anything(), {
      data: { email: 'admin@example.com', alertsCount: 1, triggerEventsCount: 2 },
    });
    expect(listUsers).toHaveBeenCalledTimes(1);

    dialogSubject.next(true);
    fixture.detectChanges();

    expect(removeUser).toHaveBeenCalledWith(1);
    expect(listUsers).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText(
        'Removed admin@example.com (1 alert(s), 2 trigger event(s) deleted).',
      ),
    ).toBeTruthy();
  });

  it('shows the error message and never opens the dialog when the impact preview fails', async () => {
    const { fixture, dialogOpen } = await renderRemoveUser({
      getUserImpact: () =>
        throwError(() => new HttpErrorResponse({ status: 404, error: { code: 'unknown_user' } })),
    });
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove user' }) as HTMLButtonElement;

    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(await screen.findByText('Unknown user.')).toBeTruthy();
    expect(dialogOpen).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(false);
  });

  it('does not remove the user when the confirm dialog is cancelled', async () => {
    const { fixture, dialogSubject, removeUser } = await renderRemoveUser();
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove user' }) as HTMLButtonElement;

    fireEvent.click(submitButton());
    fixture.detectChanges();

    dialogSubject.next(undefined);
    fixture.detectChanges();

    expect(removeUser).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(false);
  });

  it('sorts the fetched users alphabetically by email and selects the first', async () => {
    const unsorted: AdminUser[] = [
      { id: 2, email: 'zoe@example.com' },
      { id: 1, email: 'alice@example.com' },
    ];
    const { fixture, component } = await renderRemoveUser({ listUsers: () => of(unsorted) });
    fixture.detectChanges();

    expect(component.users().map((u) => u.email)).toEqual(['alice@example.com', 'zoe@example.com']);
    expect(component.selectedUserId()).toBe(1);
  });

  it('shows the mapped message for a known error code (cannot_delete_self)', async () => {
    const removeUser = vi.fn(() =>
      throwError(
        () => new HttpErrorResponse({ status: 403, error: { code: 'cannot_delete_self' } }),
      ),
    );
    const { fixture, dialogSubject } = await renderRemoveUser({ removeUser });
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove user' }) as HTMLButtonElement;

    fireEvent.click(submitButton());
    fixture.detectChanges();
    dialogSubject.next(true);
    fixture.detectChanges();

    expect(await screen.findByText('You cannot delete your own account.')).toBeTruthy();
  });

  it('falls back to the generic message for an unrecognized error code', async () => {
    const removeUser = vi.fn(() =>
      throwError(() => new HttpErrorResponse({ status: 500, error: { code: 'totally_unknown' } })),
    );
    const { fixture, dialogSubject } = await renderRemoveUser({ removeUser });
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove user' }) as HTMLButtonElement;

    fireEvent.click(submitButton());
    fixture.detectChanges();
    dialogSubject.next(true);
    fixture.detectChanges();

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
  });

  it('keeps submit disabled across the impact→confirm→delete flow and ignores repeat submits', async () => {
    const impactSubject = new Subject<UserImpact>();
    const deleteSubject = new Subject<RemovedUser>();
    const getUserImpact = vi.fn(() => impactSubject);
    const removeUser = vi.fn(() => deleteSubject);
    const { fixture, component, dialogSubject } = await renderRemoveUser({
      getUserImpact,
      removeUser,
    });
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove user' }) as HTMLButtonElement;

    // Window 1 — impact preview in flight.
    fireEvent.click(submitButton());
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(true);
    expect(component.submitting()).toBe(true);
    component.onSubmit();
    expect(getUserImpact).toHaveBeenCalledTimes(1);

    // Window 2 — confirm dialog open, awaiting the user.
    impactSubject.next({
      id: 1,
      email: 'admin@example.com',
      alertsCount: 1,
      triggerEventsCount: 2,
    });
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(true);
    expect(component.submitting()).toBe(true);

    // Window 3 — delete request in flight.
    dialogSubject.next(true);
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(true);
    expect(component.submitting()).toBe(true);
    expect(removeUser).toHaveBeenCalledTimes(1);
  });

  it('re-enables submit after the delete request fails', async () => {
    const deleteSubject = new Subject<RemovedUser>();
    const removeUser = vi.fn(() => deleteSubject);
    const { fixture, component, dialogSubject } = await renderRemoveUser({ removeUser });
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove user' }) as HTMLButtonElement;

    fireEvent.click(submitButton());
    fixture.detectChanges();
    dialogSubject.next(true);
    fixture.detectChanges();

    deleteSubject.error(new HttpErrorResponse({ status: 500 }));
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(false);
    expect(component.submitting()).toBe(false);
  });

  it('re-enables submit after a successful delete', async () => {
    const { fixture, component, dialogSubject } = await renderRemoveUser();
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove user' }) as HTMLButtonElement;

    fireEvent.click(submitButton());
    fixture.detectChanges();
    dialogSubject.next(true);
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(false);
    expect(component.submitting()).toBe(false);
  });

  it('keeps submit disabled and onSubmit inert when no user is selected', async () => {
    const getUserImpact = vi.fn(() =>
      of<UserImpact>({ id: 1, email: 'admin@example.com', alertsCount: 1, triggerEventsCount: 2 }),
    );
    const { fixture, component } = await renderRemoveUser({ getUserImpact });
    const submitButton = () =>
      screen.getByRole('button', { name: 'Remove user' }) as HTMLButtonElement;

    component.onUserChange(null);
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(true);
    component.onSubmit();
    expect(getUserImpact).not.toHaveBeenCalled();
  });
});
