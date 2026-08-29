import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { fireEvent, render, screen } from '@testing-library/angular/zoneless';
import { Subject, of, throwError } from 'rxjs';
import { AuthService, AuthUser } from '../../../core/auth/auth.service';
import { Login } from './login';

const FIXTURE_USER: AuthUser = { id: 1, email: 'user@example.com', isAdmin: false };

async function renderLogin(
  loginImpl: () => ReturnType<AuthService['login']> = () => of(FIXTURE_USER),
) {
  const login = vi.fn(loginImpl);
  const navigateByUrl = vi.fn(() => Promise.resolve(true));
  const result = await render(Login, {
    providers: [
      { provide: AuthService, useValue: { login } },
      { provide: Router, useValue: { navigateByUrl } },
      // RouterLink (used by the "Register" footer link) injects ActivatedRoute
      // even though this component never navigates relative to it.
      { provide: ActivatedRoute, useValue: {} },
    ],
  });
  const component = result.fixture.componentInstance as unknown as {
    form: Login['form'];
    onSubmit: () => void;
    submitting: () => boolean;
  };
  return { ...result, form: component.form, component, login, navigateByUrl };
}

describe('Login', () => {
  const submitButton = () => screen.getByRole('button', { name: 'Log in' }) as HTMLButtonElement;

  it('requires an email and rejects an invalid format', async () => {
    const { fixture, form } = await renderLogin();

    form.controls.email.setValue('');
    form.controls.email.markAsTouched();
    fixture.detectChanges();
    expect(await screen.findByText('Email is required.')).toBeTruthy();

    form.controls.email.setValue('not-an-email');
    fixture.detectChanges();
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
  });

  it('requires a password', async () => {
    const { fixture, form } = await renderLogin();

    form.controls.password.setValue('');
    form.controls.password.markAsTouched();
    fixture.detectChanges();

    expect(await screen.findByText('Password is required.')).toBeTruthy();
  });

  // submitting-flag / double-submit guard (issue #116): a synchronous login()
  // stub flips submitting false->true->false in one tick, so no test can observe
  // the in-flight state — the pending Subject holds the call open instead.

  it('does not log in while the form is invalid', async () => {
    const { fixture, form, component, login } = await renderLogin();
    fixture.detectChanges();

    // Both controls start empty, so the form is invalid on render.
    expect(form.invalid).toBe(true);
    expect(submitButton().disabled).toBe(true);

    component.onSubmit();

    expect(login).not.toHaveBeenCalled();
  });

  it('keeps the submit button disabled and ignores a second submit while a login is in flight', async () => {
    const pending = new Subject<AuthUser>();
    const { fixture, form, component, login } = await renderLogin(() => pending);

    form.controls.email.setValue('user@example.com');
    form.controls.password.setValue('secret123');
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(false);

    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(true);

    component.onSubmit();

    expect(login).toHaveBeenCalledTimes(1);
  });

  it('re-enables the submit button after a failed login', async () => {
    const pending = new Subject<AuthUser>();
    const { fixture, form } = await renderLogin(() => pending);

    form.controls.email.setValue('user@example.com');
    form.controls.password.setValue('secret123');
    fixture.detectChanges();
    fireEvent.click(submitButton());
    fixture.detectChanges();

    pending.error(new HttpErrorResponse({ status: 401 }));
    fixture.detectChanges();

    // The error handler touches no form control, so the form stays valid — the
    // button re-enables only if `submitting` was also reset to false.
    expect(submitButton().disabled).toBe(false);
  });

  it('logs in with the entered credentials and navigates home on success', async () => {
    const { fixture, form, login, navigateByUrl } = await renderLogin();

    form.controls.email.setValue('user@example.com');
    form.controls.password.setValue('secret123');
    fixture.detectChanges();

    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(login).toHaveBeenCalledWith('user@example.com', 'secret123');
    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('shows an invalid-credentials message when the login fails', async () => {
    const { fixture, form } = await renderLogin(() =>
      throwError(() => new HttpErrorResponse({ status: 401 })),
    );

    form.controls.email.setValue('user@example.com');
    form.controls.password.setValue('wrong-password');
    fixture.detectChanges();

    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(await screen.findByText('Invalid email or password.')).toBeTruthy();
  });
});
