import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';

export interface DeleteAlertConfirmData {
  instrument: string;
  alertType: string;
  threshold: string;
}

@Component({
  selector: 'app-delete-alert-confirm',
  imports: [MatButtonModule, MatDialogModule],
  templateUrl: './delete-alert-confirm.html',
  styleUrl: './delete-alert-confirm.scss',
})
export class DeleteAlertConfirm {
  protected readonly data = inject<DeleteAlertConfirmData>(MAT_DIALOG_DATA);
}
