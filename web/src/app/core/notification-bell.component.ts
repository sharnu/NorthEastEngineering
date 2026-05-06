import {
  Component, OnInit, inject, signal, DestroyRef, HostListener,
} from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { startWith, switchMap } from 'rxjs/operators';
import { NotificationService, NotificationItem } from './notification.service';
import { ToastService } from './toast.service';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  template: `
    <div class="bell-wrap">
      <button class="bell-btn" (click)="toggle()" [attr.aria-label]="'Notifications, ' + svc.unreadCount() + ' unread'">
        <svg class="bell-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        @if (svc.unreadCount() > 0) {
          <span class="badge">{{ svc.unreadCount() > 9 ? '9+' : svc.unreadCount() }}</span>
        }
      </button>

      @if (open()) {
        <div class="dropdown">
          <div class="dd-header">
            <span class="dd-title">Notifications</span>
            @if (svc.unreadCount() > 0) {
              <button class="dd-mark-all" (click)="markAll()">Mark all read</button>
            }
          </div>
          <div class="dd-body">
            @if (svc.items().length === 0) {
              <p class="dd-empty">No notifications yet.</p>
            }
            @for (n of svc.items(); track n.id) {
              <div class="notif-row" [class.unread]="!n.isRead" (click)="onNotifClick(n)">
                <span class="event-dot" [class]="dotClass(n.eventType)"></span>
                <div class="notif-content">
                  <span class="notif-title">{{ n.title }}</span>
                  <span class="notif-body">{{ n.body }}</span>
                  <span class="notif-time">{{ timeAgo(n.createdAt) }}</span>
                </div>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .bell-wrap { position: relative; }

    .bell-btn {
      position: relative; display: flex; align-items: center; justify-content: center;
      width: 34px; height: 34px; background: transparent;
      border: 0.5px solid rgba(245,242,234,0.25); border-radius: 8px;
      cursor: pointer; color: rgba(245,242,234,0.8); padding: 0;
      transition: background 0.15s, color 0.15s;
    }
    .bell-btn:hover { background: rgba(245,242,234,0.1); color: var(--paper,#f5f2ea); }
    .bell-icon { width: 17px; height: 17px; }

    .badge {
      position: absolute; top: -5px; right: -5px;
      background: var(--bad,#b91c1c); color: #fff;
      border-radius: 999px; font-size: 10px; font-weight: 600;
      min-width: 16px; height: 16px; padding: 0 4px;
      display: flex; align-items: center; justify-content: center; line-height: 1;
    }

    .dropdown {
      position: absolute; top: calc(100% + 8px); right: 0; z-index: 200;
      width: 340px; background: #fff; border: 0.5px solid #e5e7eb;
      border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.14); overflow: hidden;
    }

    .dd-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-bottom: 0.5px solid #f3f4f6;
    }
    .dd-title { font-size: 13px; font-weight: 600; color: #0a0e0f; }
    .dd-mark-all { background: none; border: none; cursor: pointer; font-size: 12px; color: #1d4ed8; padding: 0; }
    .dd-mark-all:hover { text-decoration: underline; }

    .dd-body { max-height: 360px; overflow-y: auto; }
    .dd-empty { padding: 24px 16px; text-align: center; color: #9ca3af; font-size: 13px; margin: 0; }

    .notif-row {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 12px 16px; cursor: pointer; transition: background 0.1s;
      border-bottom: 0.5px solid #f9fafb;
    }
    .notif-row:last-child { border-bottom: none; }
    .notif-row:hover { background: #f9fafb; }
    .notif-row.unread { background: #eff6ff; }
    .notif-row.unread:hover { background: #dbeafe; }

    .event-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
    .dot-blocked   { background: var(--bad,#b91c1c); }
    .dot-completed { background: var(--good,#15803d); }
    .dot-default   { background: var(--info,#1d4ed8); }

    .notif-content { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .notif-title { font-size: 13px; font-weight: 600; color: #0a0e0f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .notif-body  { font-size: 12px; color: #374151; line-height: 1.4; }
    .notif-time  { font-size: 11px; color: #9ca3af; margin-top: 2px; }
  `],
})
export class NotificationBellComponent implements OnInit {
  svc      = inject(NotificationService);
  private toastSvc   = inject(ToastService);
  private auth       = inject(AuthService);
  private router     = inject(Router);
  private destroyRef = inject(DestroyRef);

  open        = signal(false);
  lastSeenAt  = signal<Date | null>(null);

  ngOnInit() {
    if (!this.auth.isAuthenticated()) return;

    interval(15_000).pipe(
      startWith(0),
      switchMap(() => this.svc.fetchAll()),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(list => {
      const seen = this.lastSeenAt();

      if (seen === null) {
        // Cold start: record now so only future events trigger toasts
        this.lastSeenAt.set(new Date());
        return;
      }

      const newItems = list.filter(n => new Date(n.createdAt) > seen);
      for (const n of newItems) {
        this.toastSvc.showNotification(n);
      }
      this.lastSeenAt.set(new Date());
    });
  }

  toggle() {
    if (!this.open()) this.svc.loadAll();
    this.open.update(v => !v);
  }

  onNotifClick(n: NotificationItem) {
    this.svc.markRead(n.id);
    this.open.set(false);
    if (n.entityType === 'RepairOrder' && n.entityId) {
      this.router.navigate(['/sales/ro', n.entityId]);
    } else if (n.entityType === 'JobTask' && n.entityId) {
      this.router.navigate(['/tech/tasks', n.entityId]);
    }
  }

  markAll() {
    this.svc.markAllRead();
  }

  dotClass(eventType: string): string {
    if (eventType === 'TaskBlocked') return 'event-dot dot-blocked';
    if (eventType === 'QcPassed' || eventType === 'RoCompleted' || eventType === 'TaskCompleted') return 'event-dot dot-completed';
    return 'event-dot dot-default';
  }

  timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs} hr ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent) {
    if (!(e.target as HTMLElement).closest('app-notification-bell')) {
      this.open.set(false);
    }
  }
}
