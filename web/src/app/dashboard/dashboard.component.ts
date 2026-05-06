import {
  Component, OnInit, inject, signal, computed, DestroyRef,
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, forkJoin } from 'rxjs';
import { startWith, switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { DashboardService, KpiData, StationLoad, TopVarianceItem, ActiveRo } from './dashboard.service';
import { ActiveRosTableComponent } from './active-ros-table.component';
import { NotificationBellComponent } from '../core/notification-bell.component';
import { ReportsComponent } from './reports.component';
import { SchedulingComponent } from './scheduling.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, DatePipe, DecimalPipe, ActiveRosTableComponent, NotificationBellComponent, ReportsComponent, SchedulingComponent],
  styleUrls: ['./dashboard.component.css'],
  template: `
    <div class="topbar">
      <div class="brand">
        <span class="brand-name">North East Engineering</span>
        <span class="brand-sub">Production Platform</span>
      </div>
      <div class="topbar-right">
        <span class="refresh-indicator">
          @if (isRefreshing()) {
            <span class="refresh-dot active"></span>
          } @else {
            <span class="refresh-dot"></span>
          }
          @if (lastUpdated()) {
            <span class="last-updated">Updated {{ lastUpdated() | date:'HH:mm:ss' }}</span>
          }
        </span>
        @if (user(); as u) {
          <span class="user-label">{{ u.fullName }} · <span class="role">{{ u.roles.join(', ') }}</span></span>
        }
        <a class="nav-link" (click)="router.navigate(['/kanban'])">Kanban Board</a>
        <app-notification-bell />
        <button class="logout" (click)="logout()">Sign out</button>
      </div>
    </div>

    <main class="stage">
      <div class="page-header">
        <h1 class="page-title">Supervisor Dashboard</h1>
      </div>

      <div class="tab-bar">
        <button class="tab-btn" [class.tab-active]="activeTab() === 'overview'" (click)="activeTab.set('overview')">Overview</button>
        <button class="tab-btn" [class.tab-active]="activeTab() === 'reports'" (click)="activeTab.set('reports')">Reports</button>
        <button class="tab-btn" [class.tab-active]="activeTab() === 'scheduling'" (click)="activeTab.set('scheduling')">Scheduling</button>
        @if (isDrafter()) {
          <button class="tab-btn" (click)="router.navigate(['/drafter'])">Drafter Workspace</button>
        }
        @if (isAdmin()) {
          <button class="tab-btn" (click)="router.navigate(['/admin'])">Admin</button>
        }
      </div>

      @if (activeTab() === 'overview') {

      @if (loadError()) {
        <div class="alert-error">Could not load dashboard data. Retrying…</div>
      }

      <!-- KPI Row -->
      <div class="kpi-row">
        <div class="kpi-card">
          <div class="kpi-icon">📋</div>
          <div class="kpi-value">{{ kpis()?.activeRos ?? 0 }}</div>
          <div class="kpi-label">Active ROs</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon">⚡</div>
          <div class="kpi-value">{{ (kpis()?.utilisationPct ?? 0) | number:'1.1-1' }}%</div>
          <div class="kpi-label">Utilisation</div>
        </div>
        <div class="kpi-card" [class.kpi-alert]="(kpis()?.inHospitalCount ?? 0) > 0">
          <div class="kpi-icon">🏥</div>
          <div class="kpi-value">{{ kpis()?.inHospitalCount ?? 0 }}</div>
          <div class="kpi-label">In Hospital</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon">✅</div>
          <div class="kpi-value">{{ (kpis()?.onTimePct ?? 100) | number:'1.1-1' }}%</div>
          <div class="kpi-label">On Time</div>
        </div>
        @if ((kpis()?.overdueCount ?? 0) > 0) {
          <div class="kpi-card kpi-alert">
            <div class="kpi-icon">⚠️</div>
            <div class="kpi-value">{{ kpis()?.overdueCount }}</div>
            <div class="kpi-label">Overdue</div>
          </div>
        }
      </div>

      <!-- Station Load + Top Variance -->
      <div class="two-col">

        <!-- Station Load -->
        <section class="panel">
          <h2 class="panel-title">Station Load</h2>
          @for (s of stationLoad(); track s.stationId) {
            <div class="station-row">
              <div class="station-meta">
                <span class="station-name">{{ s.stationName }}</span>
                <span class="station-owner">{{ s.ownerName ?? 'Unassigned' }}</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill" [class]="barClass(s.hoursRemaining)"
                     [style.width.%]="barWidth(s.hoursRemaining)"></div>
              </div>
              <div class="station-stats">
                <span class="hours-num">{{ (s.hoursRemaining ?? 0) | number:'1.0-1' }}h</span>
                <span class="tasks-num">{{ s.openTasks }} tasks</span>
              </div>
            </div>
          }
        </section>

        <!-- Top Variance -->
        <section class="panel">
          <h2 class="panel-title">Top Variance <span class="panel-sub">(last 7 days)</span></h2>
          @if (topVariance().length === 0) {
            <p class="empty-panel">No variance data this week.</p>
          }
          @for (v of topVariance(); track v.taskId) {
            <div class="variance-row">
              <div class="variance-info">
                <span class="variance-op">{{ v.operationName }}</span>
                <span class="variance-meta">{{ v.roNumber }}@if (v.technicianName) { · {{ v.technicianName }} }</span>
              </div>
              <div class="variance-right">
                <span class="delta-badge" [class.delta-over]="v.deltaHours > 0" [class.delta-under]="v.deltaHours < 0">
                  {{ v.deltaHours > 0 ? '+' : '' }}{{ v.deltaHours | number:'1.1-1' }}h
                </span>
                <span class="reason-chip">{{ v.reasonName }}</span>
              </div>
            </div>
          }
        </section>

      </div>

      <!-- Active ROs Table -->
      <section class="panel mt-16">
        <h2 class="panel-title">Active Repair Orders</h2>
        <app-active-ros-table [rows]="activeRos()" />
      </section>

      } @else if (activeTab() === 'reports') {
        <div class="reports-wrap">
          <app-reports />
        </div>
      } @else {
        <div class="scheduling-wrap">
          <app-scheduling />
        </div>
      }

    </main>
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
    .role  { opacity: 0.65; }
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

    /* Stage */
    .stage { background: var(--paper); min-height: calc(100vh - 57px); padding-bottom: 40px; position: relative; z-index: 1; }

    /* Page header */
    .page-header { padding: 24px 28px 0; margin-bottom: 20px; }
    .page-title { font-family: var(--display); font-size: 28px; font-weight: 500; color: var(--ink);
                  letter-spacing: -0.02em; margin: 0; }

    /* Tab bar */
    .tab-bar { display: flex; gap: 2px; padding: 0 28px; border-bottom: 1px solid var(--rule);
               margin-bottom: 20px; }
    .tab-btn { background: none; border: none; padding: 10px 18px; font-size: 13px; color: var(--ink-3);
               cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color 0.15s, border-color 0.15s; }
    .tab-btn:hover { color: var(--ink); }
    .tab-active { color: var(--ink) !important; border-bottom-color: var(--ink) !important; font-weight: 500; }

    /* Reports wrapper */
    .reports-wrap { padding: 0 28px 28px; display: flex; flex-direction: column; }

    /* Scheduling wrapper */
    .scheduling-wrap { padding: 0 28px 28px; }

    .alert-error { background: #fef2f2; color: var(--bad); border-left: 4px solid var(--bad);
                   border-radius: 6px; padding: 10px 16px; margin: 0 28px 16px; font-size: 13px; }

    /* KPI Row */
    .kpi-row { display: flex; gap: 14px; padding: 0 28px; flex-wrap: wrap; }
    .kpi-card { flex: 1; min-width: 130px; padding: 20px 20px; border: 0.5px solid var(--rule);
                border-radius: 12px; background: white; text-align: center; }
    .kpi-card.kpi-alert { border-color: rgba(185,28,28,0.3); background: #fef2f2; }
    .kpi-icon  { font-size: 20px; margin-bottom: 6px; }
    .kpi-value { font-family: var(--display); font-size: 32px; font-weight: 500; color: var(--ink); line-height: 1; }
    .kpi-label { font-family: var(--mono); font-size: 11px; color: var(--ink-3); margin-top: 6px;
                 text-transform: uppercase; letter-spacing: 0.1em; }

    /* Two-column panels */
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 28px 0; }
    @media (max-width: 800px) { .two-col { grid-template-columns: 1fr; } }
    .panel { background: white; border: 0.5px solid var(--rule); border-radius: 12px; padding: 24px; }
    .panel-title { font-family: var(--mono); font-size: 11px; font-weight: 500; text-transform: uppercase;
                   letter-spacing: 0.12em; color: var(--ink-3); margin: 0 0 16px; }
    .panel-sub { font-weight: 400; color: var(--ink-3); opacity: 0.7; font-size: 10px; }
    .mt-16 { margin: 16px 28px 28px; }
    .empty-panel { color: var(--ink-3); font-size: 13px; }

    /* Station Load */
    .station-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .station-row:last-child { margin-bottom: 0; }
    .station-meta { width: 160px; flex-shrink: 0; }
    .station-name { display: block; font-size: 13px; font-weight: 600; color: var(--ink); }
    .station-owner { display: block; font-size: 11px; color: var(--ink-3); margin-top: 1px; }
    .bar-track { flex: 1; height: 5px; background: var(--paper-3); border-radius: 3px; overflow: hidden; }
    .bar-fill  { height: 100%; border-radius: 3px; transition: width 0.4s ease; min-width: 2px; }
    .load-low  { background: var(--good); }
    .load-mid  { background: var(--warn); }
    .load-high { background: var(--bad); }
    .load-zero { background: var(--paper-3); }
    .station-stats { width: 80px; text-align: right; flex-shrink: 0; }
    .hours-num  { display: block; font-family: var(--mono); font-size: 12px; font-weight: 500; color: var(--ink); }
    .tasks-num  { display: block; font-size: 11px; color: var(--ink-3); }

    /* Variance */
    .variance-row { display: flex; justify-content: space-between; align-items: flex-start;
                    padding: 8px 0; border-bottom: 0.5px solid var(--rule); }
    .variance-row:last-child { border-bottom: none; }
    .variance-op   { display: block; font-size: 13px; font-weight: 500; color: var(--ink); }
    .variance-meta { display: block; font-family: var(--mono); font-size: 11px; color: var(--ink-3); margin-top: 2px; }
    .variance-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .delta-badge   { font-family: var(--mono); font-size: 11px; font-weight: 500; padding: 2px 7px; border-radius: 4px; }
    .delta-over    { background: #fee2e2; color: var(--bad); }
    .delta-under   { background: #dcfce7; color: var(--good); }
    .reason-chip   { font-family: var(--mono); font-size: 10px; background: var(--paper-2); color: var(--ink-3); padding: 2px 6px; border-radius: 3px; }
  `],
})
export class DashboardComponent implements OnInit {
  private auth = inject(AuthService);
  router       = inject(Router);
  private svc = inject(DashboardService);
  private destroyRef = inject(DestroyRef);

  user = this.auth.user;
  isAdmin   = computed(() => this.auth.hasRole('ADMIN'));
  isDrafter = computed(() => this.auth.hasRole('DRAFTER') || this.auth.hasRole('ADMIN'));
  activeTab = signal<'overview' | 'reports' | 'scheduling'>('overview');
  kpis = signal<KpiData | null>(null);
  stationLoad = signal<StationLoad[]>([]);
  topVariance = signal<TopVarianceItem[]>([]);
  activeRos = signal<ActiveRo[]>([]);
  isRefreshing = signal(false);
  lastUpdated = signal<Date | null>(null);
  loadError = signal(false);

  private maxHours = 0;

  ngOnInit() {
    // 30s poll: KPIs + station load + variance
    interval(30_000).pipe(
      startWith(0),
      switchMap(() => {
        this.isRefreshing.set(true);
        return forkJoin([
          this.svc.getKpis(),
          this.svc.getStationLoad(),
          this.svc.getTopVariance(),
        ]).pipe(catchError(() => { this.loadError.set(true); return of(null); }));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(result => {
      this.isRefreshing.set(false);
      if (!result) return;
      this.loadError.set(false);
      this.kpis.set(result[0] as KpiData);
      const sl = result[1] as StationLoad[];
      this.maxHours = Math.max(...sl.map(s => s.hoursRemaining ?? 0), 1);
      this.stationLoad.set(sl);
      this.topVariance.set(result[2] as TopVarianceItem[]);
      this.lastUpdated.set(new Date());
    });

    // 60s poll: active ROs table
    interval(60_000).pipe(
      startWith(0),
      switchMap(() => this.svc.getActiveRos().pipe(catchError(() => of([])))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(ros => this.activeRos.set(ros));
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  barWidth(h: number | null) {
    if (!h || this.maxHours === 0) return 0;
    return Math.min((h / this.maxHours) * 100, 100);
  }

  barClass(h: number | null) {
    if (!h || h === 0) return 'load-zero';
    return h < 20 ? 'load-low' : h <= 40 ? 'load-mid' : 'load-high';
  }
}
