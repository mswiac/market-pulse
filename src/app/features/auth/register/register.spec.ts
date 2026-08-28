import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { fireEvent, render, screen } from '@testing-library/angular/zoneless';
import { Subject, of, throwError } from 'rxjs';
import { AuthService, AuthUser } from '../../../core/auth/auth.service';
import { Register } from './register';

const FIXTURE_USER: AuthUser = { id: 1, email: 'user@example.com', isAdmin: false };

async function renderRegister(
  registerImpl: () => ReturnType<AuthService['register']> = () => of(FIXTURE_USER),
) {
  const register = vi.fn(registerImpl);
  const result = await render(Register, {
    providers: [
      { provide: AuthService, useValue: { register } },
      { provide: Router, useValue: { navigateByUrl: () => Promise.resolve(true) } },
      // RouterLink (used by the "Log in" footer link) injects ActivatedRoute
      // even though this component never navigates relative to it.
      { provide: ActivatedRoute, useValue: {} },
    ],
  });
  const component = result.fixture.componentInstance as unknown as {
    form: Register['form'];
    onSubmit: () => void;
    submitting: () => boolean;
  };
  return { ...result, form: component.form, component, register };
}

describe('Register', () => {
  const submitButton = () => screen.getByRole('button', { name: 'Register' }) as HTMLButtonElement;

  it('requires an email and rejects an invalid format', async () => {
    const { fixture, form } = await renderRegister();

    form.controls.email.setValue('');
    form.controls.email.markAsTouched();
    fixture.detectChanges();
    expect(await screen.findByText('Email is required.')).toBeTruthy();

    form.controls.email.setValue('not-an-email');
    fixture.detectChanges();
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
  });

  it('rejects a password shorter than 8 characters', async () => {
    const { fixture, form } = await renderRegister();

    form.controls.password.setValue('short');
    form.controls.password.markAsTouched();
    fixture.detectChanges();

    expect(await screen.findByText('Password must be at least 8 characters.')).toBeTruthy();
  });

  it('shows the taken-email message and marks the email control on a 409 conflict', async () => {
    const registerImpl = () => throwError(() => new HttpErrorResponse({ status: 409 }));
    const { fixture, form } = await renderRegister(registerImpl);

    form.controls.email.setValue('taken@example.com');
    form.controls.password.setValue('longenoughpassword');
    fixture.detectChanges();

    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(await screen.findByText('This email is already registered.')).toBeTruthy();
    expect(form.controls.email.hasError('server')).toBe(true);
  });

  it('does not register while the form is invalid', async () => {
    const { fixture, form, component, register } = await renderRegister();
    fixture.detectChanges();

    // Both controls start empty, so the form is invalid on render.
    expect(form.invalid).toBe(true);
    expect(submitButton().disabled).toBe(true);

    component.onSubmit();

    expect(register).not.toHaveBeenCalled();
  });

  it('keeps the submit button disabled and ignores a second submit while registration is in flight', async () => {
    const pending = new Subject<AuthUser>();
    const { fixture, form, component, register } = await renderRegister(() => pending);

    form.controls.email.setValue('new@example.com');
    form.controls.password.setValue('longenoughpassword');
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(false);

    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(true);

    component.onSubmit();

    expect(register).toHaveBeenCalledTimes(1);
  });

  it('re-enables the submit button once the user retries after a failed registration', async () => {
    const pending = new Subject<AuthUser>();
    const { fixture, form } = await renderRegister(() => pending);

    form.controls.email.setValue('new@example.com');
    form.controls.password.setValue('longenoughpassword');
    fixture.detectChanges();
    fireEvent.click(submitButton());
    fixture.detectChanges();

    pending.error(new HttpErrorResponse({ status: 500 }));
    fixture.detectChanges();

    // The error handler stamps a `server` error on the email control, so the
    // form stays invalid until it's edited. Editing it clears that error — and
    // the button only re-enables if `submitting` was also reset to false.
    form.controls.email.setValue('another@example.com');
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(false);
  });
});
