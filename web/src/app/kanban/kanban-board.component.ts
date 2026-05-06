import {
  Component, OnInit, inject, signal, computed, DestroyRef,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { interval, firstValueFrom } from 'rxjs';
import { startWith, switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../core/auth.service';
import { KanbanService, KanbanStationDto, KanbanCardDto, KanbanTaskDto } from './kanban.service';
import { StationCardComponent } from './station-card.component';
import { TaskDrawerComponent } from './task-drawer.component';
import { NotificationBellComponent } from '../core/notification-bell.component';

@Component({
  selector: 'app-kanban-board',
  standalone: true,
  imports: [CommonModule, DatePipe, StationCardComponent, TaskDrawerComponent, NotificationBellComponent],
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
    <div class="board">
      <div class="board-columns">
        @for (station of displayedStations(); track station.stationId) {
          <div class="board-col">
            <div class="col-header">
              <div class="col-header-info">
                <span class="col-name">{{ station.stationName }}</span>
                <span class="col-owner">{{ station.ownerName ?? 'Unassigned' }}</span>
              </div>
              <span class="task-count-badge">{{ station.cards.length }}</span>
            </div>
            <div class="col-body">
              @if (station.cards.length === 0) {
                <p class="no-tasks">No open work</p>
              } @else {
                @for (card of station.cards; track card.roId) {
                  <app-station-card
                    [card]="card"
                    (cardClick)="openCardDrawer(card)"
                    (pdfClick)="openPdfInTab(card)" />
                }
              }
            </div>
          </div>
        }
      </div>
    </div>

    <!-- Task drawer (E23-S3 will replace with card-aware drawer) -->
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

    /* Station card host styling (border, hover) */
    app-station-card {
      display: block;
      background: white;
      border: 0.5px solid var(--rule);
      border-radius: 10px;
      margin-bottom: 8px;
      cursor: pointer;
      overflow: hidden;
      transition: all 0.15s ease;
      position: relative;
    }
    app-station-card:hover {
      border-color: var(--accent);
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(10,14,15,0.06);
    }
    app-station-card.gated {
      border-style: dashed;
      border-color: var(--rule-strong);
      background: repeating-linear-gradient(45deg, white, white 8px, #faf7ee 8px, #faf7ee 14px);
    }
    app-station-card.ready {
      border-color: var(--good);
      box-shadow: inset 3px 0 0 var(--good);
    }
    app-station-card.complete {
      background: #f0fdf4;
      border-color: #86efac;
    }
  `],
})
export class KanbanBoardComponent implements OnInit {
  private auth       = inject(AuthService);
  router             = inject(Router);
  private svc        = inject(KanbanService);
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

  // Drawer (E23-S3 will replace with card-aware drawer)
  selectedTask  = signal<KanbanTaskDto | null>(null);
  isDrawerOpen  = signal(false);

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

  // TODO E23-S3: replace with card-aware drawer that shows all tasks in the card
  openCardDrawer(card: KanbanCardDto): void {
    const t = card.tasks[0];
    if (!t) return;
    this.selectedTask.set({
      id:               t.id,
      roId:             card.roId,
      roNumber:         card.roNumber,
      sequence:         t.sequence,
      jobCodeLine:      t.jobCodeLine,
      operationName:    t.operationName,
      assignedToUserId: t.assignedToUserId,
      assignedToName:   t.assignedToName,
      estimatedHours:   t.estimatedHours,
      actualHours:      t.actualHours,
      status:           t.status,
      priority:         card.priority,
      customerName:     card.customerName,
      requiredDate:     card.requiredDate,
      stationId:        card.stationId,
      stationName:      card.stationName,
      notes:            t.notes,
      hasManualOverride: card.hasManualOverride,
      overrideAt:       null,
      overrideReason:   null,
      overrideByName:   null,
    });
    this.isDrawerOpen.set(true);
  }

  openPdfInTab(card: KanbanCardDto): void {
    if (card.sourcePdfUrl) {
      window.open(card.sourcePdfUrl, '_blank');
    }
  }

  onTaskUpdated(partial: Partial<KanbanTaskDto>): void {
    this.selectedTask.update(t => t ? { ...t, ...partial } : t);
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
