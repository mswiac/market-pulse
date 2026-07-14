import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const sessionExpiredInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        // Only force-navigate when a previously-authenticated session just
        // expired/was revoked. A 401 with currentUser already null means
        // this is the anonymous bootstrap checkSession() call, and forcing
        // a redirect here would hijack the router's own initial navigation
        // (e.g. a fresh visit to /register would get bounced to /login).
        const wasAuthenticated = authService.currentUser() !== null;
        authService.clearSession();
        if (wasAuthenticated) {
          void router.navigateByUrl('/login');
        }
      }
      return throwError(() => error);
    }),
  );
};
