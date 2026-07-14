import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-home',
  imports: [MatToolbarModule, MatButtonModule, MatCardModule],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly user = this.authService.currentUser;

  protected onLogout(): void {
    this.authService.logout().subscribe(() => void this.router.navigateByUrl('/login'));
  }
}
