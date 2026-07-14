import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  templateUrl: './register.html',
  styleUrl: './register.scss',
})
export class Register {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected readonly emailError = signal<string | null>(null);
  protected readonly submitting = signal(false);

  protected onSubmit(): void {
    if (this.form.invalid || this.submitting()) return;

    this.emailError.set(null);
    this.submitting.set(true);
    const { email, password } = this.form.getRawValue();

    this.authService.register(email, password).subscribe({
      next: () => void this.router.navigateByUrl('/'),
      error: (err: unknown) => {
        this.submitting.set(false);
        if (err instanceof HttpErrorResponse && err.status === 409) {
          this.emailError.set('This email is already registered.');
        } else {
          this.emailError.set('Something went wrong. Please try again.');
        }
        // mat-form-field only renders its <mat-error> when the control's own
        // errorState is true; the required/email validators alone won't flip
        // that for a server-side conflict, so mark it manually.
        this.form.controls.email.setErrors({ server: true });
        this.form.controls.email.markAsTouched();
      },
    });
  }
}
