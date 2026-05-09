import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription, interval } from 'rxjs';
import { TechService, TechTask } from './tech.service';
import { TechBottomNavComponent } from './tech-bottom-nav.component';

@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [CommonModule, RouterModule, TechBottomNavComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <h1 class="page-title">My Tasks</h1>
        <div class="header-right">
          <span class="clock">{{ currentTime() }}</span>
          <button class="refresh-btn" (click)="loadTasks()" title="Refresh">&#8635;</button>
        </div>
      </header>

      <main class="task-scroll">
        @if (loading()) {
          <div class="empty-state">Loading...</div>
        } @else if (tasks().length === 0) {
          <div class="empty-state">No tasks assigned. Ask your station owner.</div>
        } @else {
          @for (task of tasks(); track task.id) {
            <div class="task-card" [class.blocked-card]="task.status === 'BLOCKED'"
                 (click)="openTask(task.id)">
              <div class="task-main">
                <span class="op-name">{{ task.operationName }}</span>
                <span class="status-pill" [class]="statusClass(task.status)">{{ task.status }}</span>
              </div>
              <div class="task-sub">
                <span class="ro-info">{{ task.roNumber }} &middot; {{ task.customerName }}</span>
              </div>

              @if (task.status === 'BLOCKED') {
                <div class="block-banner">
                  <span class="block-banner-title">
                    Awaiting supervisor
                    @if (task.blockedAt) {
                      <span class="block-banner-when">· {{ relativeTime(task.blockedAt) }}</span>
                    }
                  </span>
                  @if (task.blockedReason) {
                    <span class="block-banner-reason">{{ task.blockedReason }}</span>
                  }
                </div>
                <div class="task-footer">
                  <span class="hours">Est {{ task.estimatedHours }}h</span>
                  <span class="block-hint">Tap for details</span>
                </div>
              } @else {
                <div class="task-footer">
                  <span class="hours">Est {{ task.estimatedHours }}h / Act {{ task.actualHours }}h</span>
                  <button class="action-btn" [class]="task.status === 'IN_PROGRESS' ? 'btn-continue' : 'btn-clockin'"
                    (click)="$event.stopPropagation(); openTask(task.id)">
                    {{ task.status === 'IN_PROGRESS' ? 'Continue' : 'Clock In' }}
                  </button>
                </div>
              }
            </div>
          }
        }
      </main>

      <app-tech-bottom-nav />
    </div>
  `,
  styles: [`
    .page {
      display: flex; flex-direction: column;
      min-height: 100vh; background: var(--paper);
      max-width: 420px; margin: 0 auto;
      position: relative; z-index: 1;
    }
    .page-header {
      display: flex; align-items: center; justify-content: space-between;
      background: white; border-bottom: 0.5px solid var(--rule);
      padding: 16px;
      position: sticky; top: 0; z-index: 10;
    }
    .page-title { margin: 0; font-family: var(--display); font-size: 22px; font-weight: 500;
                  color: var(--ink); letter-spacing: -0.01em; }
    .header-right { display: flex; align-items: center; gap: 8px; }
    .clock { font-family: var(--mono); font-size: 13px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
    .refresh-btn {
      background: none; border: none; font-size: 22px;
      cursor: pointer; color: var(--accent); line-height: 1;
    }
    .task-scroll { flex: 1; padding: 12px 14px 80px; display: flex; flex-direction: column; gap: 10px; }
    .empty-state { text-align: center; padding: 48px 16px; color: var(--ink-3); font-size: 14px; }
    .task-card {
      background: white;
      border: 0.5px solid var(--rule);
      border-radius: 10px;
      padding: 12px 14px;
      cursor: pointer;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .task-card:hover { border-color: var(--accent); box-shadow: 0 2px 8px rgba(10,14,15,0.06); }
    .task-main { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .op-name { font-size: 15px; font-weight: 600; color: var(--ink); flex: 1; }
    .task-sub { margin-bottom: 10px; }
    .ro-info { font-family: var(--mono); font-size: 11px; color: var(--ink-3); }
    .task-footer { display: flex; align-items: center; justify-content: space-between; }
    .hours { font-family: var(--mono); font-size: 12px; color: var(--ink-3); }
    .action-btn {
      padding: 7px 14px; border-radius: 8px; border: none;
      font-size: 12px; font-weight: 500; cursor: pointer; font-family: var(--sans);
    }
    .btn-clockin { background: var(--accent); color: white; }
    .btn-clockin:hover { background: #1d6bc8; }
    .btn-continue { background: var(--good); color: white; }
    .btn-continue:hover { background: #166534; }
    .status-pill {
      font-family: var(--mono); font-size: 10px; font-weight: 500; padding: 2px 8px;
      border-radius: 3px; text-transform: uppercase;
    }
    .pill-assigned { background: #e0e7ff; color: #3730a3; }
    .pill-in_progress { background: #dbeafe; color: var(--info); }
    .pill-paused { background: #fef9c3; color: var(--warn); }
    .pill-default { background: var(--paper-3); color: var(--ink-3); }
    .pill-blocked { background: rgba(185,28,28,0.12); color: var(--bad); }

    .blocked-card {
      border-color: rgba(185,28,28,0.35);
      box-shadow: inset 3px 0 0 var(--bad);
    }
    .blocked-card:hover { border-color: var(--bad); box-shadow: inset 3px 0 0 var(--bad), 0 2px 8px rgba(185,28,28,0.08); }
    .block-banner {
      margin: 6px 0 10px; padding: 8px 10px;
      background: rgba(185,28,28,0.06); border-radius: 6px;
      display: flex; flex-direction: column; gap: 2px;
    }
    .block-banner-title { font-size: 12px; font-weight: 600; color: var(--bad); }
    .block-banner-when  { font-family: var(--mono); font-size: 11px; font-weight: 400;
                          color: var(--ink-3); margin-left: 2px; }
    .block-banner-reason {
      font-size: 12px; color: var(--ink-2); line-height: 1.35;
      word-break: break-word;
      display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3;
      -webkit-box-orient: vertical; overflow: hidden;
    }
    .block-hint { font-family: var(--sans); font-size: 12px; color: var(--ink-3); font-style: italic; }
  `],
})
export class TechTaskListComponent implements OnInit, OnDestroy {
  private techService = inject(TechService);
  private router = inject(Router);

  tasks = signal<TechTask[]>([]);
  loading = signal(true);
  currentTime = signal('');

  private tickSub?: Subscription;

  ngOnInit(): void {
    this.loadTasks();
    this.updateClock();
    this.tickSub = interval(1000).subscribe(() => this.updateClock());
  }

  ngOnDestroy(): void {
    this.tickSub?.unsubscribe();
  }

  loadTasks(): void {
    this.loading.set(true);
    this.techService.getMyTasks().subscribe({
      next: tasks => {
        this.tasks.set(tasks);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  openTask(id: string): void {
    this.router.navigate(['/tech/tasks', id]);
  }

  statusClass(status: string): string {
    switch (status.toLowerCase()) {
      case 'in_progress': return 'status-pill pill-in_progress';
      case 'paused':      return 'status-pill pill-paused';
      case 'assigned':    return 'status-pill pill-assigned';
      case 'blocked':     return 'status-pill pill-blocked';
      default:            return 'status-pill pill-default';
    }
  }

  relativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    const minutes = Math.floor((Date.now() - then) / 60000);
    if (minutes < 1)    return 'just now';
    if (minutes < 60)   return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)     return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  private updateClock(): void {
    const now = new Date();
    this.currentTime.set(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }
}
