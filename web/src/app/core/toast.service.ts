import { Injectable, signal } from '@angular/core';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  title: string;
  body: string;
  variant: ToastVariant;
  notifId?: string;
  entityType?: string | null;
  entityId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private seq = 0;
  toasts = signal<Toast[]>([]);

  show(title: string, body: string, variant: ToastVariant = 'info', durationMs = 5000) {
    const id = ++this.seq;
    this.toasts.update(list => [...list, { id, title, body, variant }]);
    setTimeout(() => this.dismiss(id), durationMs);
  }

  showNotification(notif: { id: string; title: string; body: string; eventType: string; entityType: string | null; entityId: string | null }) {
    const id = ++this.seq;
    const variant = notif.eventType === 'TaskBlocked' ? 'error'
      : (notif.eventType === 'QcPassed' || notif.eventType === 'RoCompleted') ? 'success'
      : 'info';
    this.toasts.update(list => [
      ...list,
      { id, title: notif.title, body: notif.body, variant,
        notifId: notif.id, entityType: notif.entityType, entityId: notif.entityId },
    ]);
    setTimeout(() => this.dismiss(id), 5000);
  }

  dismiss(id: number) {
    this.toasts.update(list => list.filter(t => t.id !== id));
  }
}
