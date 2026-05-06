import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of, tap } from 'rxjs';

export interface NotificationItem {
  id: string;
  eventType: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private http = inject(HttpClient);

  unreadCount = signal(0);
  items       = signal<NotificationItem[]>([]);

  refreshCount() {
    this.http.get<{ count: number }>('/api/notifications/unread-count').pipe(
      catchError(() => of({ count: 0 })),
    ).subscribe(r => this.unreadCount.set(r.count));
  }

  /** Returns the Observable so callers can react to the emitted list. */
  fetchAll(): Observable<NotificationItem[]> {
    return this.http.get<NotificationItem[]>('/api/notifications').pipe(
      catchError(() => of([])),
      tap(list => {
        this.items.set(list);
        this.unreadCount.set(list.filter(n => !n.isRead).length);
      }),
    );
  }

  loadAll() {
    this.fetchAll().subscribe();
  }

  markRead(id: string) {
    this.http.post(`/api/notifications/${id}/read`, {}).pipe(
      catchError(() => of(null)),
    ).subscribe(() => {
      this.items.update(list => list.map(n => n.id === id ? { ...n, isRead: true } : n));
      this.unreadCount.update(c => Math.max(0, c - 1));
    });
  }

  markAllRead() {
    this.http.post('/api/notifications/read-all', {}).pipe(
      catchError(() => of(null)),
    ).subscribe(() => {
      this.items.update(list => list.map(n => ({ ...n, isRead: true })));
      this.unreadCount.set(0);
    });
  }
}
