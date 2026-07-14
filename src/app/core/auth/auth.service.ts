import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

export interface AuthUser {
  id: number;
  email: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  private readonly _currentUser = signal<AuthUser | null>(null);
  readonly currentUser = this._currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this._currentUser() !== null);

  register(email: string, password: string): Observable<AuthUser> {
    return this.http
      .post<AuthUser>('/api/register', { email, password })
      .pipe(tap((user) => this._currentUser.set(user)));
  }

  login(email: string, password: string): Observable<AuthUser> {
    return this.http.post<AuthUser>('/api/login', { email, password }).pipe(tap((user) => this._currentUser.set(user)));
  }

  logout(): Observable<void> {
    return this.http.post<void>('/api/logout', {}).pipe(tap(() => this._currentUser.set(null)));
  }

  checkSession(): Observable<AuthUser> {
    return this.http.get<AuthUser>('/api/me').pipe(tap((user) => this._currentUser.set(user)));
  }

  /** Clears local auth state without a round-trip; used when a 401 reveals the session already ended server-side. */
  clearSession(): void {
    this._currentUser.set(null);
  }
}
