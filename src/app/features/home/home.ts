import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AlertForm } from '../alerts/alert-form/alert-form';
import { AlertList } from '../alerts/alert-list/alert-list';

@Component({
  selector: 'app-home',
  imports: [MatToolbarModule, MatButtonModule, MatCardModule, MatDialogModule, MatIconModule, AlertList],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);

  protected readonly user = this.authService.currentUser;

  protected onLogout(): void {
    this.authService.logout().subscribe(() => void this.router.navigateByUrl('/login'));
  }

  protected openNewAlertDialog(): void {
    this.dialog.open(AlertForm, { width: '32rem' });
  }
}
