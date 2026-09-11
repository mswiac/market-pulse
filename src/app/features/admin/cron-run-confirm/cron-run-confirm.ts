import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';

@Component({
  selector: 'app-cron-run-confirm',
  imports: [MatButtonModule, MatDialogModule],
  templateUrl: './cron-run-confirm.html',
})
export class CronRunConfirm {}
