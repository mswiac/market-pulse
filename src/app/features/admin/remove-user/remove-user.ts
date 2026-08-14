import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AdminService, AdminUser, RemovedUser } from '../admin-panel.service';
import { RemoveUserConfirm, RemoveUserConfirmData } from '../remove-user-confirm/remove-user-confirm';

// Backend returns a fixed set of machine-readable codes shared by both the
// impact-preview and delete calls (src/worker/routes/admin.ts) — mapped here
// to localized text rather than displaying the (English, code-facing) server message.
const ERROR_MESSAGES: Record<string, string> = {
  forbidden: $localize`:@@removeUser.error.forbidden:You don't have permission to do this.`,
  unknown_user: $localize`:@@removeUser.error.unknownUser:Unknown user.`,
  cannot_delete_self: $localize`:@@removeUser.error.cannotDeleteSelf:You cannot delete your own account.`,
};

const GENERIC_ERROR = $localize`:@@removeUser.error.generic:Something went wrong. Please try again.`;
const SNACKBAR_DURATION_MS = 5000;

@Component({
  selector: 'app-remove-user',
  imports: [MatFormFieldModule, MatSelectModule, MatButtonModule, MatCardModule, MatSnackBarModule, MatDialogModule],
  templateUrl: './remove-user.html',
  styleUrl: './remove-user.scss',
})
export class RemoveUser {
  private readonly adminService = inject(AdminService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  protected readonly users = signal<AdminUser[]>([]);
  protected readonly selectedUserId = signal<number | null>(null);

  protected readonly submitting = signal(false);
  protected readonly loadError = signal(false);
  protected readonly noUsers = computed(() => this.users().length === 0);

  protected readonly canSubmit = computed(() => this.selectedUserId() !== null && !this.submitting());

  constructor() {
    this.fetchUsers();
  }

  protected onUserChange(id: number): void {
    this.selectedUserId.set(id);
  }

  protected onSubmit(): void {
    const id = this.selectedUserId();
    if (!this.canSubmit() || id === null) return;

    this.submitting.set(true);

    this.adminService.getUserImpact(id).subscribe({
      next: (impact) => this.openConfirmDialog(id, impact.email, impact.alertsCount, impact.triggerEventsCount),
      error: (err: unknown) => {
        this.submitting.set(false);
        this.showError(err);
      },
    });
  }

  private openConfirmDialog(id: number, email: string, alertsCount: number, triggerEventsCount: number): void {
    const data: RemoveUserConfirmData = { email, alertsCount, triggerEventsCount };

    this.dialog
      .open(RemoveUserConfirm, { data })
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed) {
          this.removeUser(id);
        } else {
          this.submitting.set(false);
        }
      });
  }

  private removeUser(id: number): void {
    this.adminService.removeUser(id).subscribe({
      next: (result) => {
        this.submitting.set(false);
        this.fetchUsers();
        this.showResult(result);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.showError(err);
      },
    });
  }

  private fetchUsers(): void {
    this.adminService.listUsers().subscribe({
      error: () => this.loadError.set(true),
      next: (users) => {
        this.users.set([...users].sort((a, b) => a.email.localeCompare(b.email)));
        const firstUser = this.users()[0];
        this.selectedUserId.set(firstUser ? firstUser.id : null);
      },
    });
  }

  private showResult(result: RemovedUser): void {
    const message = $localize`:@@removeUser.result.success:Removed ${result.email}:INTERPOLATION: (${result.alertsDeleted}:INTERPOLATION_1: alert(s), ${result.triggerEventsDeleted}:INTERPOLATION_2: trigger event(s) deleted).`;
    this.snackBar.open(message, undefined, { duration: SNACKBAR_DURATION_MS });
  }

  private showError(err: unknown): void {
    const code = err instanceof HttpErrorResponse && typeof err.error?.code === 'string' ? err.error.code : null;
    const message = (code && ERROR_MESSAGES[code]) || GENERIC_ERROR;
    this.snackBar.open(message, undefined, { duration: SNACKBAR_DURATION_MS });
  }
}
