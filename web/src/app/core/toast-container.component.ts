import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ToastService, Toast } from './toast.service';
import { NotificationService } from './notification.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  template: `
    <div class="toast-stack">
      @for (t of svc.toasts(); track t.id) {
        <div class="toast" [class]="'toast-' + t.variant" (click)="onToastClick(t)">
          <div class="toast-content">
            <span class="toast-title">{{ t.title }}</span>
            <span class="toast-body">{{ t.body }}</span>
          </div>
          <button class="toast-close" (click)="$event.stopPropagation(); svc.dismiss(t.id)">&#x2715;</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-stack {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      display: flex; flex-direction: column; gap: 10px; pointer-events: none;
    }
    .toast {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
      padding: 12px 16px; border-radius: 8px; min-width: 280px; max-width: 380px;
      font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      pointer-events: all; animation: slideIn 0.2s ease; cursor: pointer;
    }
    @keyframes slideIn { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }
    .toast-info    { background: #eff6ff; color: var(--info,#1d4ed8); border-left: 4px solid var(--info,#1d4ed8); }
    .toast-success { background: #f0fdf4; color: var(--good,#15803d); border-left: 4px solid var(--good,#15803d); }
    .toast-warning { background: #fffbeb; color: #92400e; border-left: 4px solid #f59e0b; }
    .toast-error   { background: #fef2f2; color: var(--bad,#b91c1c); border-left: 4px solid var(--bad,#b91c1c); }
    .toast-content { flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .toast-title { font-weight: 600; line-height: 1.3; }
    .toast-body  { font-size: 12px; opacity: 0.8; line-height: 1.4; }
    .toast-close {
      background: none; border: none; cursor: pointer; font-size: 14px; opacity: 0.6;
      padding: 0 2px; color: inherit; line-height: 1; flex-shrink: 0; margin-top: 1px;
    }
    .toast-close:hover { opacity: 1; }
  `],
})
export class ToastContainerComponent {
  svc     = inject(ToastService);
  private notifSvc = inject(NotificationService);
  private router   = inject(Router);

  onToastClick(t: Toast) {
    if (t.notifId) this.notifSvc.markRead(t.notifId);
    this.svc.dismiss(t.id);
    if (t.entityType === 'RepairOrder' && t.entityId) {
      this.router.navigate(['/sales/ro', t.entityId]);
    } else if (t.entityType === 'JobTask' && t.entityId) {
      this.router.navigate(['/tech/tasks', t.entityId]);
    }
  }
}
