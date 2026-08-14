import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';

export interface RemoveUserConfirmData {
  email: string;
  alertsCount: number;
  triggerEventsCount: number;
}

@Component({
  selector: 'app-remove-user-confirm',
  imports: [MatButtonModule, MatDialogModule],
  templateUrl: './remove-user-confirm.html',
})
export class RemoveUserConfirm {
  protected readonly data = inject<RemoveUserConfirmData>(MAT_DIALOG_DATA);
}
