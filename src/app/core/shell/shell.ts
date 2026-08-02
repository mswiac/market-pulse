import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-shell',
  imports: [MatToolbarModule, MatButtonModule, MatIconModule, MatSidenavModule, MatListModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly user = this.authService.currentUser;
  protected readonly isAdmin = computed(() => this.user()?.isAdmin ?? false);
  // Starts expanded when landing directly on a History route (e.g. a page
  // refresh on /history) so the active section isn't hidden behind a
  // collapsed toggle with no visual trace of where the user actually is.
  protected readonly historyExpanded = signal(this.router.url.startsWith('/history'));

  protected onLogout(): void {
    this.authService.logout().subscribe(() => void this.router.navigateByUrl('/login'));
  }
}
