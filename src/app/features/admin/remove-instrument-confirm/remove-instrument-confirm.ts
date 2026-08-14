import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';

export interface RemoveInstrumentConfirmData {
  ticker: string;
  alertsCount: number;
}

@Component({
  selector: 'app-remove-instrument-confirm',
  imports: [MatButtonModule, MatDialogModule],
  templateUrl: './remove-instrument-confirm.html',
})
export class RemoveInstrumentConfirm {
  protected readonly data = inject<RemoveInstrumentConfirmData>(MAT_DIALOG_DATA);
}
