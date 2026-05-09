import {
  Component, OnInit, effect, inject, signal, computed, DestroyRef, InjectionToken,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { interval, Subject } from 'rxjs';
import { startWith, switchMap, catchError, debounceTime } from 'rxjs/operators';
import { of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import * as signalR from '@microsoft/signalr';
import { AuthService } from '../core/auth.service';
import { ThemeSwitcherComponent } from '../core/theme-switcher.component';
import { KanbanService, KanbanStationDto, KanbanCardDto, ScheduledWeekDto } from './kanban.service';
import { StationCardComponent } from './station-card.component';
import { CardDrawerComponent } from './card-drawer.component';
import { FlowRibbonComponent } from './flow-ribbon.component';
import { NotificationBellComponent } from '../core/notification-bell.component';
import { bodyTypeLabel, bodyTypeShortCode } from './body-type.util';

export interface KanbanHubConnection {
  on(methodName: string, newMethod: (...args: unknown[]) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const KANBAN_HUB_FACTORY = new InjectionToken<() => KanbanHubConnection>(
  'KANBAN_HUB_FACTORY',
  {
    providedIn: 'root',
    factory: () => () =>
      new signalR.HubConnectionBuilder()
        .withUrl('/hubs/kanban')
        .withAutomaticReconnect()
        .build() as unknown as KanbanHubConnection,
  },
);

interface GateStateChip {
  value: string;
  label: string;
  activeClass: string;
}

const GATE_STATES: GateStateChip[] = [
  { value: 'IN_PROGRESS', label: 'In Progress', activeClass: 'chip-inprogress' },
  { value: 'READY',       label: 'Ready',       activeClass: 'chip-ready'      },
  { value: 'GATED',       label: 'Gated',       activeClass: 'chip-gated'      },
  { value: 'COMPLETE',    label: 'Complete',    activeClass: 'chip-complete'   },
];

const WEEK_KEY = 'kanban.selectedWeek';
const BACKLOG = 'backlog';

/** Returns the Monday of the current week as `yyyy-MM-dd` in local time. */
function currentMonday(): string {
  const today = new Date();
  const dow = today.getDay(); // Sunday=0, Monday=1, ...
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  const yyyy = monday.getFullYear();
  const mm = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format a week as "Week of May 11 · W20" (or "· W01 2027" when the ISO year
 * differs from the calendar year, e.g. Dec 30 falling into next ISO year).
 * If the API didn't supply isoWeek (e.g. the week isn't in availableWeeks
 * because nothing's scheduled there), compute it locally so the label is
 * consistent.
 */
function formatWeekLabel(yyyymmdd: string, isoWeek?: number, isoYear?: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const month = date.toLocaleString('default', { month: 'short' });
  if (!isoWeek) {
    const computed = computeIsoWeek(yyyymmdd);
    isoWeek = computed.week;
    isoYear = computed.year;
  }
  const wkPart = isoYear && isoYear !== y
    ? `W${String(isoWeek).padStart(2, '0')} ${isoYear}`
    : `W${String(isoWeek).padStart(2, '0')}`;
  return `Week of ${month} ${d} · ${wkPart}`;
}

/** ISO 8601 week + week-numbering year for the given yyyy-MM-dd. */
function computeIsoWeek(yyyymmdd: string): { week: number; year: number } {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);  // Thursday of the week
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { week, year: date.getUTCFullYear() };
}

@Component({
  selector: 'app-kanban-board',
  standalone: true,
  imports: [CommonModule, DatePipe, StationCardComponent, CardDrawerComponent, FlowRibbonComponent, NotificationBellComponent, ThemeSwitcherComponent],
  template: `
    <!-- Topbar -->
    <div class="topbar">
      <div class="brand">
        <img class="brand-logo" src="assets/nee-logo.png" alt="North East Engineering" />
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
        <app-theme-switcher />
        <button class="logout" (click)="logout()">Sign out</button>
      </div>
    </div>

    <!-- Page header + controls -->
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">Kanban Board</h1>
        <p class="page-caption">
          {{ selectedWeekLabel() }} ·
          @if (visibleCardCount() === totalCardCount()) {
            {{ totalCardCount() }} card{{ totalCardCount() === 1 ? '' : 's' }}
          } @else {
            {{ visibleCardCount() }} of {{ totalCardCount() }} cards visible
          }
        </p>
      </div>
      <div class="header-controls">
        <select class="week-filter"
                (change)="onWeekChange($any($event.target).value)"
                title="Filter by scheduled week">
          @for (opt of weekOptions(); track opt.value) {
            <option [value]="opt.value" [selected]="opt.value === selectedWeek()">
              {{ opt.label }}
            </option>
          }
        </select>

        <select class="station-filter" (change)="onStationFilter($any($event.target).value)">
          <option value="">All stations</option>
          @for (s of allStations(); track s.stationId) {
            <option [value]="s.stationId">{{ s.stationName }}</option>
          }
        </select>

        @if (distinctBodyTypes().length > 1) {
          <div class="bodytype-chips" role="group" aria-label="Filter by body type">
            <button class="bodytype-chip"
                    [class.active]="activeBodyTypes().length === 0"
                    (click)="activeBodyTypes.set([])"
                    title="Show all body types">All</button>
            @for (bt of distinctBodyTypes(); track bt) {
              <button class="bodytype-chip"
                      [class.active]="activeBodyTypes().includes(bt)"
                      (click)="toggleBodyType(bt)"
                      [title]="bodyTypeLabel(bt)">
                {{ bodyTypeShortCode(bt) }}
              </button>
            }
          </div>
        }

        <div class="gate-chips" role="group" aria-label="Filter by status">
          @for (gs of gateStates; track gs.value) {
            <button class="gate-chip"
                    [class]="isGateActive(gs.value) ? 'gate-chip ' + gs.activeClass : 'gate-chip chip-off'"
                    (click)="toggleGate(gs.value)"
                    [title]="isGateActive(gs.value) ? 'Hide ' + gs.label : 'Show ' + gs.label">
              {{ gs.label }}
              <span class="chip-count"
                    [style.visibility]="gateCount(gs.value) > 0 ? 'visible' : 'hidden'">
                {{ gateCount(gs.value) }}
              </span>
            </button>
          }
        </div>

        <button class="refresh-btn" (click)="refresh()" [disabled]="isRefreshing()">
          {{ isRefreshing() ? 'Refreshing…' : 'Refresh' }}
        </button>
      </div>
    </div>

    @if (loadError()) {
      <div class="alert-error">Could not load board data. Retrying automatically…</div>
    }

    <!-- Flow ribbon for last-selected RO -->
    @if (selectedCard(); as card) {
      <app-flow-ribbon [roId]="card.roId" [refreshAt]="boardRefreshCount()" />
    }

    @if (showEmptyBanner()) {
      <div class="empty-banner">
        <p class="empty-title">No ROs in this view</p>
        <p class="empty-detail">
          @if (selectedWeek() === 'backlog') {
            There are no unscheduled ROs in the backlog.
          } @else if (selectedWeek() === '') {
            No active repair orders.
          } @else {
            Nothing scheduled for {{ selectedWeekLabel() }}.
            Try selecting a different week or "All scheduled weeks".
          }
        </p>
      </div>
    }

    <!-- Board -->
    <div class="board">
      <div class="board-columns">
        @for (station of filteredStations(); track station.stationId) {
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
                <p class="no-tasks">
                  {{ isFiltered() ? 'No matching cards' : 'No open work' }}
                </p>
              } @else {
                @for (card of station.cards; track card.roId) {
                  <app-station-card
                    [card]="card"
                    [selectedWeek]="selectedWeek()"
                    (cardClick)="openCardDrawer(card)"
                    (pdfClick)="openPdfInTab(card)" />
                }
              }
            </div>
          </div>
        }
      </div>
    </div>

    <app-card-drawer
      [card]="selectedCard()"
      [isOpen]="isDrawerOpen()"
      [refreshAt]="boardRefreshCount()"
      (closed)="isDrawerOpen.set(false)" />
  `,
  styles: [`
    /* Topbar */
    .topbar { display: flex; justify-content: space-between; align-items: center;
              padding: 14px 28px; background: var(--topbar-bg); color: var(--topbar-text);
              border-bottom: 0.5px solid var(--topbar-border); position: relative; z-index: 10; }
    .brand  { display: flex; flex-direction: row; align-items: center; gap: 12px; }
    .brand-logo { height: 48px; width: auto; filter: var(--logo-filter); }
    .brand-sub  { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--topbar-sub); }
    .topbar-right { display: flex; align-items: center; gap: 16px; }
    .user-label { font-size: 13px; color: var(--topbar-muted); }
    .role { opacity: 0.65; }
    .nav-link { font-size: 13px; color: var(--topbar-muted); cursor: pointer;
                padding: 5px 0; border-bottom: 1px solid transparent; transition: border-color 0.15s, color 0.15s; }
    .nav-link:hover { color: var(--topbar-text); border-bottom-color: var(--topbar-border); }
    .logout { background: transparent; border: 0.5px solid var(--topbar-border); color: var(--topbar-text);
              padding: 5px 12px; border-radius: 5px; cursor: pointer; font-size: 12px; }
    .logout:hover { background: var(--topbar-hover); }

    /* Refresh indicator */
    .refresh-indicator { display: flex; align-items: center; gap: 6px; }
    .refresh-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--good); opacity: 0.4; }
    .refresh-dot.active { opacity: 1; animation: pulse 1s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
    .last-updated { font-family: var(--mono); font-size: 11px; color: var(--topbar-sub); }

    /* Page header */
    .page-header { display: flex; align-items: center; justify-content: space-between;
                   padding: 24px 28px 12px; position: relative; z-index: 1; flex-wrap: wrap; gap: 12px; }
    .page-title  { font-family: var(--display); font-size: 28px; font-weight: 500; color: var(--ink);
                   letter-spacing: -0.02em; margin: 0; }
    .header-controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .station-filter, .week-filter { padding: 8px 10px; border: 0.5px solid var(--rule-strong); border-radius: 6px;
                      font-size: 13px; background: var(--paper); color: var(--ink); cursor: pointer; }
    .week-filter { font-weight: 500; min-width: 200px; }
    .page-title-block { display: flex; flex-direction: column; gap: 4px; }
    .page-caption { font-size: 12px; color: var(--ink-3); margin: 0;
                    font-family: var(--mono); }
    .empty-banner { margin: 12px 28px 0; padding: 28px;
                    border: 0.5px dashed var(--rule-strong); border-radius: 10px;
                    background: var(--paper-2); text-align: center; }
    .empty-title  { font-family: var(--display); font-size: 18px; font-weight: 500;
                    color: var(--ink); margin: 0 0 6px; }
    .empty-detail { font-size: 13px; color: var(--ink-3); margin: 0; }
    .refresh-btn { padding: 8px 16px; border: 0.5px solid var(--rule-strong); border-radius: 999px;
                   font-size: 13px; font-weight: 500; background: transparent; color: var(--ink); cursor: pointer;
                   transition: background 0.15s, color 0.15s;
                   min-width: 116px; text-align: center; }
    .refresh-btn:hover:not(:disabled) { background: var(--topbar-bg); color: var(--topbar-text); border-color: var(--ink); }
    .refresh-btn:disabled { opacity: 0.5; cursor: default; }

    /* Body-type filter chips */
    .bodytype-chips { display: flex; gap: 4px; align-items: center; }
    .bodytype-chip {
      display: inline-flex; align-items: center;
      padding: 4px 9px; border-radius: 999px; font-size: 11px; font-weight: 500;
      font-family: var(--mono); text-transform: uppercase; letter-spacing: 0.04em;
      cursor: pointer; border: 1px solid var(--rule); background: var(--paper-2); color: var(--ink-3);
      transition: background 0.12s, color 0.12s, border-color 0.12s;
      white-space: nowrap;
    }
    .bodytype-chip:hover { background: var(--paper-3); color: var(--ink); }
    .bodytype-chip.active { background: var(--topbar-bg); color: var(--topbar-text); border-color: var(--ink); }

    /* Gate state chips */
    .gate-chips { display: flex; gap: 5px; align-items: center; }
    .gate-chip {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 5px 10px; border-radius: 999px; font-size: 12px; font-weight: 500;
      cursor: pointer; border: 1px solid transparent;
      transition: opacity 0.15s, background 0.15s, color 0.15s, border-color 0.15s;
      font-family: var(--sans); white-space: nowrap;
    }
    .chip-count {
      font-family: var(--mono); font-size: 10px; font-weight: 600;
      background: rgba(0,0,0,0.12); border-radius: 999px;
      padding: 0px 5px; min-width: 22px; text-align: center;
    }

    /* Active states — colours match the card border styles */
    .chip-inprogress { background: rgba(29,78,216,0.12); color: #1d4ed8; border-color: rgba(29,78,216,0.25); }
    .chip-inprogress:hover { background: rgba(29,78,216,0.2); }
    .chip-ready      { background: rgba(22,163,74,0.12);  color: var(--good); border-color: rgba(22,163,74,0.3); }
    .chip-ready:hover { background: rgba(22,163,74,0.2); }
    .chip-gated      { background: rgba(180,83,9,0.1);   color: #b45309; border-color: rgba(180,83,9,0.25); }
    .chip-gated:hover { background: rgba(180,83,9,0.18); }
    .chip-complete   { background: rgba(22,163,74,0.08); color: #15803d; border-color: rgba(22,163,74,0.2); }
    .chip-complete:hover { background: rgba(22,163,74,0.16); }

    /* Inactive / off state */
    .chip-off { background: var(--paper-2); color: var(--ink-3); border-color: var(--rule);
                opacity: 0.55; }
    .chip-off:hover { opacity: 0.8; }

    .alert-error { background: #fef2f2; color: var(--bad); border-left: 4px solid var(--bad);
                   border-radius: 6px; padding: 10px 16px; margin: 0 28px 12px; font-size: 13px; }

    /* Board layout */
    .board { overflow-x: auto; padding: 4px 28px 28px; position: relative; z-index: 1; }
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
  private hubFactory = inject(KANBAN_HUB_FACTORY);

  readonly gateStates = GATE_STATES;
  readonly bodyTypeLabel    = bodyTypeLabel;
  readonly bodyTypeShortCode = bodyTypeShortCode;

  private readonly BT_KEY = 'kanban.activeBodyTypes';

  user         = this.auth.user;
  isSupervisor = computed(() => {
    const roles = this.user()?.roles ?? [];
    return roles.includes('SUPERVISOR') || roles.includes('ADMIN');
  });

  allStations       = signal<KanbanStationDto[]>([]);
  displayedStations = signal<KanbanStationDto[]>([]);
  selectedStationId = signal<number | null>(null);
  activeGateStates  = signal<string[]>(GATE_STATES.map(g => g.value));
  activeBodyTypes   = signal<string[]>((() => {
    try { return JSON.parse(localStorage.getItem('kanban.activeBodyTypes') ?? '[]'); }
    catch { return []; }
  })());
  isRefreshing      = signal(false);
  lastUpdated       = signal<Date | null>(null);
  loadError         = signal(false);
  boardRefreshCount = signal(0);

  // Week filter — persisted to sessionStorage so refresh keeps the user's choice.
  // Default = current Monday (Monday-based week, computed in local time).
  // sessionStorage takes precedence so a per-tab pick survives reload.
  selectedWeek      = signal<string>(sessionStorage.getItem(WEEK_KEY) ?? currentMonday());
  // True when selectedWeek's initial value came from sessionStorage (a stale
  // user pick that may need reconciling), rather than the fresh "current
  // Monday" default. We never want to snap the user away from the system
  // default just because the current week happens to have no scheduled work.
  private weekFromSession = sessionStorage.getItem(WEEK_KEY) !== null;
  availableWeeks    = signal<ScheduledWeekDto[]>([]);
  backlogCount      = signal(0);

  /** Card count from server (pre-gate-filter / pre-bodytype-filter) */
  totalCardCount = computed(() =>
    this.displayedStations().reduce((sum, s) => sum + s.cards.length, 0)
  );
  /** Card count after gate / body-type filters are applied */
  visibleCardCount = computed(() =>
    this.filteredStations().reduce((sum, s) => sum + s.cards.length, 0)
  );

  selectedWeekLabel = computed(() => {
    const w = this.selectedWeek();
    if (w === '')     return 'All scheduled weeks';
    if (w === BACKLOG) return 'Backlog · unscheduled';
    const match = this.availableWeeks().find(x => x.week === w);
    return formatWeekLabel(w, match?.isoWeek, match?.isoYear);
  });

  showEmptyBanner = computed(() =>
    !this.isRefreshing() && this.totalCardCount() === 0
  );

  /**
   * Unified options list for the week dropdown. Built as a single computed so
   * Angular's @for (track by value) reuses the same <option> DOM node across
   * updates — critical for the case where selectedWeek is initialised from
   * sessionStorage *before* /weeks has resolved. If we render two separate
   * @if/@for blocks, the option's DOM node gets destroyed when /weeks lands
   * and recreated under @for, which causes the <select> to lose its selection.
   */
  weekOptions = computed(() => {
    const sel       = this.selectedWeek();
    const available = this.availableWeeks();
    const opts: { value: string; label: string }[] = [
      { value: '',        label: 'All scheduled weeks' },
      { value: BACKLOG,   label: `Backlog · unscheduled (${this.backlogCount()})` },
    ];
    for (const w of available) {
      opts.push({ value: w.week, label: this.formatWeekOption(w) });
    }
    // Fallback if selectedWeek is a date not yet in availableWeeks
    if (sel && sel !== BACKLOG && !available.some(w => w.week === sel)) {
      opts.push({ value: sel, label: this.selectedWeekLabel() });
    }
    return opts;
  });

  selectedCard = signal<KanbanCardDto | null>(null);
  isDrawerOpen = signal(false);

  private hubConnection: KanbanHubConnection | null = null;
  private readonly cardUpdated$ = new Subject<void>();

  distinctBodyTypes = computed<string[]>(() => {
    const types = this.allStations()
      .flatMap(s => s.cards.map(c => c.bodyType ?? ''))
      .filter(t => t.length > 0);
    return [...new Set(types)].sort();
  });

  filteredStations = computed<KanbanStationDto[]>(() => {
    const activeGates = this.activeGateStates();
    const activeBTs   = this.activeBodyTypes();
    const stations    = this.displayedStations();
    const allGates    = activeGates.length === GATE_STATES.length;
    const allBTs      = activeBTs.length === 0;
    if (allGates && allBTs) return stations;
    return stations.map(s => ({
      ...s,
      cards: s.cards.filter(c => {
        const gateOk = allGates || activeGates.includes(c.gateState);
        const btOk   = allBTs   || activeBTs.includes(c.bodyType ?? '');
        return gateOk && btOk;
      }),
    }));
  });

  isFiltered = computed(() =>
    this.activeGateStates().length < GATE_STATES.length || this.activeBodyTypes().length > 0
  );

  constructor() {
    effect(() => {
      localStorage.setItem(this.BT_KEY, JSON.stringify(this.activeBodyTypes()));
    });
    this.cardUpdated$.pipe(
      debounceTime(250),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => this.refresh());
  }

  ngOnInit() {
    this.connectRealtime();
    this.loadWeeks();
    interval(30_000).pipe(
      startWith(0),
      switchMap(() => {
        this.isRefreshing.set(true);
        const stationId = this.selectedStationId() ?? undefined;
        return this.svc.getBoard(stationId, this.selectedWeek()).pipe(
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
      this.boardRefreshCount.update(n => n + 1);
    });
  }

  loadWeeks(): void {
    this.svc.getScheduledWeeks().subscribe(res => {
      this.availableWeeks.set(res.weeks);
      this.backlogCount.set(res.backlogCount);
      this.reconcileSelectedWeek();
    });
  }

  /**
   * If a persisted (sessionStorage) selectedWeek isn't in the available list
   * (e.g. all ROs in that week have completed since last session), snap to the
   * closest existing past-or-present week. Does NOT touch the system default
   * "current Monday" — when the current week has no scheduled work, the empty
   * banner is the right UX, not a silent teleport to a different week.
   */
  private reconcileSelectedWeek(): void {
    if (!this.weekFromSession) return;
    const sel = this.selectedWeek();
    if (sel === '' || sel === BACKLOG) return;

    const weeks = this.availableWeeks();
    if (weeks.some(w => w.week === sel)) return;

    if (weeks.length === 0) {
      this.selectedWeek.set('');
      sessionStorage.removeItem(WEEK_KEY);
      this.weekFromSession = false;
      return;
    }

    // Pick the closest week ≤ sel; if none, the earliest available
    const past = weeks.filter(w => w.week <= sel);
    const next = past.length ? past[past.length - 1].week : weeks[0].week;
    this.selectedWeek.set(next);
    sessionStorage.setItem(WEEK_KEY, next);
    this.loadBoard(this.selectedStationId() ?? undefined);
  }

  private connectRealtime(): void {
    const conn = this.hubFactory();
    conn.on('KanbanUpdated', () => {
      this.refresh();
      this.loadWeeks();  // schedule changes (RoScheduled, RO completed) may add/remove weeks
    });
    conn.on('KanbanCardUpdated', () => this.cardUpdated$.next());
    conn.start().catch(err => console.error('[KanbanHub]', err));
    this.hubConnection = conn;
    this.destroyRef.onDestroy(() => conn.stop());
  }

  loadBoard(stationId?: number) {
    this.isRefreshing.set(true);
    this.svc.getBoard(stationId, this.selectedWeek()).pipe(
      catchError(() => { this.loadError.set(true); return of(null); }),
    ).subscribe(board => {
      this.isRefreshing.set(false);
      if (!board) return;
      this.loadError.set(false);
      if (!stationId) this.allStations.set(board.stations);
      this.displayedStations.set(board.stations);
      this.lastUpdated.set(new Date());
      this.boardRefreshCount.update(n => n + 1);
    });
  }

  refresh() { this.loadBoard(this.selectedStationId() ?? undefined); }

  onStationFilter(value: string) {
    const stationId = value ? Number(value) : undefined;
    this.selectedStationId.set(stationId ?? null);
    this.loadBoard(stationId);
  }

  onWeekChange(value: string) {
    this.selectedWeek.set(value);
    if (value) {
      sessionStorage.setItem(WEEK_KEY, value);
      this.weekFromSession = true;   // explicit user pick — eligible for reconcile
    } else {
      sessionStorage.removeItem(WEEK_KEY);
      this.weekFromSession = false;  // "All weeks" / cleared — never reconcile
    }
    this.loadBoard(this.selectedStationId() ?? undefined);
    // Note: don't reload /weeks here — week list only changes when ROs are
    // scheduled/completed, which is signalled via SignalR or refresh().
  }

  formatWeekOption(w: ScheduledWeekDto): string {
    return `${formatWeekLabel(w.week, w.isoWeek, w.isoYear)} (${w.roCount})`;
  }

  toggleBodyType(bt: string): void {
    const current = this.activeBodyTypes();
    this.activeBodyTypes.set(
      current.includes(bt) ? current.filter(t => t !== bt) : [...current, bt],
    );
  }

  toggleGate(state: string): void {
    const current = this.activeGateStates();
    this.activeGateStates.set(
      current.includes(state) ? current.filter(s => s !== state) : [...current, state],
    );
  }

  isGateActive(state: string): boolean {
    return this.activeGateStates().includes(state);
  }

  gateCount(state: string): number {
    return this.displayedStations().reduce(
      (sum, s) => sum + s.cards.filter(c => c.gateState === state).length, 0,
    );
  }

  openCardDrawer(card: KanbanCardDto): void {
    this.selectedCard.set(card);
    this.isDrawerOpen.set(true);
  }

  openPdfInTab(card: KanbanCardDto): void {
    if (card.sourcePdfUrl) {
      window.open(card.sourcePdfUrl, '_blank');
    }
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
