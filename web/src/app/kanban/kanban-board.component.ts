import {
  Component, OnInit, inject, signal, computed, DestroyRef,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { interval, firstValueFrom } from 'rxjs';
import { startWith, switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../core/auth.service';
import { KanbanService, KanbanStationDto, KanbanTaskDto } from './kanban.service';
import { TaskCardComponent } from './task-card.component';
import { TaskDrawerComponent } from './task-drawer.component';
import { NotificationBellComponent } from '../core/notification-bell.component';

interface KanbanStage { id: number; code: string; name: string; isTerminal: boolean; }

@Component({
  selector: 'app-kanban-board',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, TaskCardComponent, TaskDrawerComponent, NotificationBellComponent],
  template: `
    <!-- Topbar -->
    <div class="topbar">
      <div class="brand">
        <span class="brand-name">North East Engineering</span>
        <span class="brand-sub">Production Platform</span>
      </div>
      <div class="topbar-right">
        <span class="refresh-indicator">
          <span class="refresh-dot" [class.active]="isRefreshing()"></span>
          @if (lastUpdated()) {
            <span class="last-updated">Updated {{ lastUpdated() | date:'HH:mm:ss' }}</span>
          }
        </span>
        @if (user(); as u) {
          <span class="user-label">{{ u.fullName }} · <span class="role">{{ u.roles.join(', ') }}</span></span>
          @if (isSupervisor()) {
            <a class="nav-link" (click)="router.navigate(['/dashboard'])">Dashboard</a>
          }
        }
        <app-notification-bell />
        <button class="logout" (click)="logout()">Sign out</button>
      </div>
    </div>

    <!-- Page header + controls -->
    <div class="page-header">
      <h1 class="page-title">Kanban Board</h1>
      <div class="header-controls">
        <select class="station-filter" (change)="onStationFilter($any($event.target).value)">
          <option value="">All stations</option>
          @for (s of allStations(); track s.stationId) {
            <option [value]="s.stationId">{{ s.stationName }}</option>
          }
        </select>
        <button class="refresh-btn" (click)="refresh()" [disabled]="isRefreshing()">
          {{ isRefreshing() ? 'Refreshing…' : 'Refresh' }}
        </button>
      </div>
    </div>

    @if (loadError()) {
      <div class="alert-error">Could not load board data. Retrying automatically…</div>
    }

    <!-- Board -->
    <div class="board" (click)="closeMenu()">
      <div class="board-columns">
        @for (station of displayedStations(); track station.stationId) {
          <div class="board-col">
            <div class="col-header">
              <div class="col-header-info">
                <span class="col-name">{{ station.stationName }}</span>
                <span class="col-owner">{{ station.ownerName ?? 'Unassigned' }}</span>
              </div>
              <span class="task-count-badge">{{ station.tasks.length }}</span>
            </div>
            <div class="col-body">
              @if (station.tasks.length === 0) {
                <p class="no-tasks">No open tasks</p>
              } @else {
                @for (task of station.tasks; track task.id) {
                  <app-task-card
                    [task]="task"
                    [isSupervisor]="isSupervisor()"
                    (cardClicked)="openDrawer($event)"
                    (menuClicked)="onMenuClick($event)" />
                }
              }
            </div>
          </div>
        }
      </div>
    </div>

    <!-- ⋯ context menu (fixed overlay) -->
    @if (menuAnchor(); as anchor) {
      <div class="ctx-menu"
           [style.top.px]="anchor.rect.bottom + 4"
           [style.left.px]="anchor.rect.left"
           (click)="$event.stopPropagation()">
        <button class="ctx-item" (click)="openOverrideModal(anchor.task)">Override stage…</button>
      </div>
    }

    <!-- Override stage modal -->
    @if (overrideModalTask()) {
      <div class="modal-backdrop" (click)="overrideModalTask.set(null)">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h2 class="modal-title">Override Kanban Stage</h2>
            <button class="close-btn" (click)="overrideModalTask.set(null)">✕</button>
          </div>
          <p class="modal-sub">{{ overrideModalTask()!.roNumber }} · {{ overrideModalTask()!.customerName }}</p>
          @if (overrideError()) {
            <div class="alert-error">{{ overrideError() }}</div>
          }
          <label class="field-label">STAGE</label>
          <select [(ngModel)]="overrideStageId" class="field-input">
            <option value="">Select stage…</option>
            @for (s of kanbanStages(); track s.id) {
              <option [value]="s.id">{{ s.name }}</option>
            }
          </select>
          <label class="field-label">REASON <span class="hint">(min 10 characters)</span></label>
          <textarea [(ngModel)]="overrideReason" rows="3" class="field-textarea"
                    placeholder="Why are you manually changing this stage?"></textarea>
          <div class="modal-footer">
            <button class="btn-secondary" (click)="overrideModalTask.set(null)">Cancel</button>
            <button class="btn-primary" [disabled]="overrideSaving()" (click)="doOverrideStage()">
              {{ overrideSaving() ? 'Saving…' : 'Override Stage' }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Task drawer -->
    <app-task-drawer
      [task]="selectedTask()"
      [isOpen]="isDrawerOpen()"
      (closed)="isDrawerOpen.set(false)"
      (taskUpdated)="onTaskUpdated($event)" />
  `,
  styles: [`
    /* Topbar */
    .topbar { display: flex; justify-content: space-between; align-items: center;
              padding: 14px 28px; background: var(--ink); color: var(--paper);
              border-bottom: 0.5px solid rgba(245,242,234,0.1); position: relative; z-index: 10; }
    .brand  { display: flex; flex-direction: column; gap: 2px; }
    .brand-name { font-family: var(--display); font-weight: 500; font-size: 16px; letter-spacing: -0.01em; color: var(--paper); }
    .brand-sub  { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: rgba(245,242,234,0.5); }
    .topbar-right { display: flex; align-items: center; gap: 16px; }
    .user-label { font-size: 13px; color: rgba(245,242,234,0.8); }
    .role { opacity: 0.65; }
    .nav-link { font-size: 13px; color: rgba(245,242,234,0.8); cursor: pointer;
                padding: 5px 0; border-bottom: 1px solid transparent; transition: border-color 0.15s, color 0.15s; }
    .nav-link:hover { color: var(--paper); border-bottom-color: rgba(245,242,234,0.4); }
    .logout { background: transparent; border: 0.5px solid rgba(245,242,234,0.3); color: var(--paper);
              padding: 5px 12px; border-radius: 5px; cursor: pointer; font-size: 12px; }
    .logout:hover { background: rgba(245,242,234,0.1); }

    /* Refresh indicator */
    .refresh-indicator { display: flex; align-items: center; gap: 6px; }
    .refresh-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--good); opacity: 0.4; }
    .refresh-dot.active { opacity: 1; animation: pulse 1s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
    .last-updated { font-family: var(--mono); font-size: 11px; color: rgba(245,242,234,0.6); }

    /* Page header */
    .page-header { display: flex; align-items: center; justify-content: space-between;
                   padding: 24px 28px 0; position: relative; z-index: 1; }
    .page-title  { font-family: var(--display); font-size: 28px; font-weight: 500; color: var(--ink);
                   letter-spacing: -0.02em; margin: 0; }
    .header-controls { display: flex; gap: 10px; align-items: center; }
    .station-filter { padding: 8px 10px; border: 0.5px solid var(--rule-strong); border-radius: 6px;
                      font-size: 13px; background: var(--paper); color: var(--ink); }
    .refresh-btn { padding: 8px 16px; border: 0.5px solid var(--rule-strong); border-radius: 999px;
                   font-size: 13px; font-weight: 500; background: transparent; color: var(--ink); cursor: pointer;
                   transition: background 0.15s, color 0.15s; }
    .refresh-btn:hover:not(:disabled) { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    .refresh-btn:disabled { opacity: 0.5; cursor: default; }

    .alert-error { background: #fef2f2; color: var(--bad); border-left: 4px solid var(--bad);
                   border-radius: 6px; padding: 10px 16px; margin: 12px 28px; font-size: 13px; }

    /* Board layout */
    .board { overflow-x: auto; padding: 16px 28px 28px; position: relative; z-index: 1; }
    .board-columns { display: flex; gap: 14px; min-width: max-content; }
    .board-col { width: 290px; flex-shrink: 0; background: var(--paper-2);
                 border-radius: 12px; padding: 14px; min-height: 200px; }

    .col-header { display: flex; justify-content: space-between; align-items: flex-start;
                  margin-bottom: 14px; }
    .col-header-info { display: flex; flex-direction: column; gap: 2px; }
    .col-name  { font-size: 13px; font-weight: 600; color: var(--ink); }
    .col-owner { font-family: var(--mono); font-size: 11px; color: var(--ink-3); }
    .task-count-badge { background: var(--paper-3); border-radius: 999px; padding: 2px 9px;
                        font-family: var(--mono); font-size: 11px; font-weight: 500; color: var(--ink-3); white-space: nowrap; }

    .col-body { }
    .no-tasks { font-family: var(--mono); font-size: 11px; color: var(--ink-3); text-align: center; padding: 24px 0; margin: 0; }

    /* Context menu */
    .ctx-menu {
      position: fixed; z-index: 1000;
      background: white; border: 0.5px solid var(--rule-strong);
      border-radius: 8px; padding: 4px;
      box-shadow: 0 4px 16px rgba(10,14,15,0.12);
      min-width: 160px;
    }
    .ctx-item {
      display: block; width: 100%; text-align: left;
      padding: 8px 12px; border: none; background: none;
      font-size: 13px; color: var(--ink); cursor: pointer; border-radius: 5px;
      transition: background 0.12s;
    }
    .ctx-item:hover { background: var(--paper-2); }

    /* Modal */
    .modal-backdrop { position: fixed; inset: 0; background: rgba(10,14,15,0.4);
                      display: flex; align-items: center; justify-content: center; z-index: 500; }
    .modal { background: white; border-radius: 12px; padding: 24px; width: 420px; max-width: 95vw;
             box-shadow: 0 8px 32px rgba(10,14,15,0.18); }
    .modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .modal-title  { font-family: var(--display); font-size: 18px; font-weight: 500; color: var(--ink); margin: 0; }
    .modal-sub    { font-family: var(--mono); font-size: 11px; color: var(--ink-3); margin: 0 0 16px; }
    .close-btn    { background: none; border: none; font-size: 18px; color: var(--ink-3); cursor: pointer; padding: 0; }
    .close-btn:hover { color: var(--ink); }
    .field-label  { display: block; font-family: var(--mono); font-size: 10px; font-weight: 600;
                    letter-spacing: 0.08em; color: var(--ink-3); text-transform: uppercase; margin: 12px 0 4px; }
    .hint         { font-weight: 400; text-transform: none; color: var(--ink-3); }
    .field-input, .field-textarea {
      width: 100%; box-sizing: border-box;
      border: 0.5px solid var(--rule-strong); border-radius: 6px;
      padding: 9px 12px; font-size: 13px; color: var(--ink); background: var(--paper);
    }
    .field-textarea { resize: vertical; font-family: inherit; }
    .modal-footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
    .btn-primary   { padding: 9px 18px; background: var(--ink); color: var(--paper); border: none;
                     border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer; }
    .btn-primary:disabled { opacity: 0.5; cursor: default; }
    .btn-secondary { padding: 9px 18px; background: transparent; color: var(--ink);
                     border: 0.5px solid var(--rule-strong); border-radius: 8px; font-size: 13px; cursor: pointer; }
  `],
})
export class KanbanBoardComponent implements OnInit {
  private auth      = inject(AuthService);
  private http      = inject(HttpClient);
  router            = inject(Router);
  private svc       = inject(KanbanService);
  private destroyRef = inject(DestroyRef);

  user         = this.auth.user;
  isSupervisor = computed(() => {
    const roles = this.user()?.roles ?? [];
    return roles.includes('SUPERVISOR') || roles.includes('ADMIN');
  });

  allStations       = signal<KanbanStationDto[]>([]);
  displayedStations = signal<KanbanStationDto[]>([]);
  selectedStationId = signal<number | null>(null);
  isRefreshing      = signal(false);
  lastUpdated       = signal<Date | null>(null);
  loadError         = signal(false);
  selectedTask      = signal<KanbanTaskDto | null>(null);
  isDrawerOpen      = signal(false);

  // ⋯ context menu
  menuAnchor = signal<{ task: KanbanTaskDto; rect: DOMRect } | null>(null);

  // Override stage modal
  overrideModalTask = signal<KanbanTaskDto | null>(null);
  kanbanStages      = signal<KanbanStage[]>([]);
  overrideStageId   = '';
  overrideReason    = '';
  overrideSaving    = signal(false);
  overrideError     = signal<string | null>(null);

  ngOnInit() {
    interval(30_000).pipe(
      startWith(0),
      switchMap(() => {
        this.isRefreshing.set(true);
        const stationId = this.selectedStationId() ?? undefined;
        return this.svc.getBoard(stationId).pipe(
          catchError(() => { this.loadError.set(true); return of(null); }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(board => {
      this.isRefreshing.set(false);
      if (!board) return;
      this.loadError.set(false);
      if (!this.selectedStationId()) this.allStations.set(board.stations);
      this.displayedStations.set(board.stations);
      this.lastUpdated.set(new Date());
    });
  }

  loadBoard(stationId?: number) {
    this.isRefreshing.set(true);
    this.svc.getBoard(stationId).pipe(
      catchError(() => { this.loadError.set(true); return of(null); }),
    ).subscribe(board => {
      this.isRefreshing.set(false);
      if (!board) return;
      this.loadError.set(false);
      if (!stationId) this.allStations.set(board.stations);
      this.displayedStations.set(board.stations);
      this.lastUpdated.set(new Date());
    });
  }

  refresh() { this.loadBoard(this.selectedStationId() ?? undefined); }

  onStationFilter(value: string) {
    const stationId = value ? Number(value) : undefined;
    this.selectedStationId.set(stationId ?? null);
    this.loadBoard(stationId);
  }

  openDrawer(task: KanbanTaskDto) {
    this.selectedTask.set(task);
    this.isDrawerOpen.set(true);
  }

  onTaskUpdated(partial: Partial<KanbanTaskDto>) {
    const patchStations = (stations: KanbanStationDto[]) =>
      stations.map(s => ({
        ...s,
        tasks: s.tasks.map(t =>
          t.id === this.selectedTask()?.id ? { ...t, ...partial } : t,
        ),
      }));
    this.allStations.update(patchStations);
    this.displayedStations.update(patchStations);
    this.selectedTask.update(t => t ? { ...t, ...partial } : t);
  }

  // ── ⋯ menu ───────────────────────────────────────────────────────────────

  onMenuClick(event: { task: KanbanTaskDto; rect: DOMRect }) {
    const current = this.menuAnchor();
    // Toggle off if same card clicked again
    if (current?.task.id === event.task.id) {
      this.menuAnchor.set(null);
    } else {
      this.menuAnchor.set(event);
    }
  }

  closeMenu() { this.menuAnchor.set(null); }

  // ── Override stage modal ─────────────────────────────────────────────────

  async openOverrideModal(task: KanbanTaskDto) {
    this.menuAnchor.set(null);
    this.overrideError.set(null);
    this.overrideReason = '';
    this.overrideStageId = '';

    if (this.kanbanStages().length === 0) {
      const stages = await firstValueFrom(this.http.get<KanbanStage[]>('/api/kanban/stages'));
      this.kanbanStages.set(stages);
    }

    this.overrideModalTask.set(task);
  }

  async doOverrideStage() {
    const task = this.overrideModalTask();
    if (!task) return;
    if (!this.overrideStageId) { this.overrideError.set('Select a stage.'); return; }
    if (this.overrideReason.trim().length < 10) {
      this.overrideError.set('Reason must be at least 10 characters.');
      return;
    }

    this.overrideSaving.set(true);
    this.overrideError.set(null);
    try {
      await firstValueFrom(this.http.post(
        `/api/kanban/ros/${task.roId}/override-stage`,
        { stageId: Number(this.overrideStageId), reason: this.overrideReason.trim() },
      ));
      this.overrideModalTask.set(null);
      this.refresh();
    } catch (err: any) {
      const msg = err?.error?.message ?? 'Failed to override stage.';
      this.overrideError.set(msg);
    } finally {
      this.overrideSaving.set(false);
    }
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
