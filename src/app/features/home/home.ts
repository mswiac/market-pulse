import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AlertForm } from '../alerts/alert-form/alert-form';
import { AlertList } from '../alerts/alert-list/alert-list';

@Component({
  selector: 'app-home',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, AlertList],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly dialog = inject(MatDialog);

  protected openNewAlertDialog(): void {
    this.dialog.open(AlertForm, { width: '32rem' });
  }
}
