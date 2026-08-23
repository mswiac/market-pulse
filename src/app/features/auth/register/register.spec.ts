import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { fireEvent, render, screen } from '@testing-library/angular/zoneless';
import { of, throwError } from 'rxjs';
import { AuthService, AuthUser } from '../../../core/auth/auth.service';
import { Register } from './register';

const FIXTURE_USER: AuthUser = { id: 1, email: 'user@example.com', isAdmin: false };

async function renderRegister(registerImpl: () => ReturnType<AuthService['register']> = () => of(FIXTURE_USER)) {
  const result = await render(Register, {
    providers: [
      { provide: AuthService, useValue: { register: registerImpl } },
      { provide: Router, useValue: { navigateByUrl: () => Promise.resolve(true) } },
      // RouterLink (used by the "Log in" footer link) injects ActivatedRoute
      // even though this component never navigates relative to it.
      { provide: ActivatedRoute, useValue: {} },
    ],
  });
  const component = result.fixture.componentInstance as unknown as { form: Register['form'] };
  return { ...result, form: component.form };
}

describe('Register', () => {
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
    const { fixture, form, container } = await renderRegister(registerImpl);

    form.controls.email.setValue('taken@example.com');
    form.controls.password.setValue('longenoughpassword');
    fixture.detectChanges();

    const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    fireEvent.click(submitButton);
    fixture.detectChanges();

    expect(await screen.findByText('This email is already registered.')).toBeTruthy();
    expect(form.controls.email.hasError('server')).toBe(true);
  });
});
