import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { catchError, firstValueFrom, of } from 'rxjs';

import { routes } from './app.routes';
import { AuthService } from './core/auth/auth.service';
import { sessionExpiredInterceptor } from './core/auth/session-expired.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch(), withInterceptors([sessionExpiredInterceptor])),
    // The app is Polish-only end-user-facing (see CLAUDE.md) — matches the
    // dd.MM.yyyy date format already used elsewhere (e.g. alert-list.html).
    provideNativeDateAdapter(),
    { provide: MAT_DATE_LOCALE, useValue: 'pl-PL' },
    // Restores auth state from the httpOnly session cookie before the router's
    // initial navigation runs, so authGuard sees the correct isAuthenticated()
    // value on a fresh page load instead of racing the /api/me call.
    provideAppInitializer(() => {
      const authService = inject(AuthService);
      return firstValueFrom(authService.checkSession().pipe(catchError(() => of(null))));
    })
  ]
};
