import {
  Component, OnInit, inject, signal, computed, DestroyRef,
} from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { ThemeSwitcherComponent } from '../core/theme-switcher.component';
import { NotificationBellComponent } from '../core/notification-bell.component';
import {
  DashboardService, ArchiveRo, JobTypeRef,
} from './dashboard.service';
import { bodyTypeLabel } from '../kanban/body-type.util';

type SortField = 'completedAt' | 'roNumber' | 'rego' | 'customerName' | 'roDate';

@Component({
  selector: 'app-archive',
  standalone: true,
  imports: [CommonModule, DatePipe, DecimalPipe, RouterLink, NotificationBellComponent, ThemeSwitcherComponent],
  template: `
    <!-- Topbar -->
    <div class="topbar">
      <div class="brand">
        <img class="brand-logo" src="assets/nee-logo.png" alt="North East Engineering" />
        <span class="brand-sub">Production Platform</span>
      </div>
      <div class="topbar-right">
        @if (user(); as u) {
          <span class="user-label">{{ u.fullName }} · <span class="role">{{ u.roles.join(', ') }}</span></span>
        }
        <a class="nav-link" (click)="router.navigate(['/dashboard'])">Dashboard</a>
        <a class="nav-link" (click)="router.navigate(['/kanban'])">Kanban Board</a>
        <app-notification-bell />
        <app-theme-switcher />
        <button class="logout" (click)="logout()">Sign out</button>
      </div>
    </div>

    <!-- Page header -->
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Completed ROs</h1>
        @if (totalCount() > 0) {
          <span class="result-count">{{ totalCount() }} total</span>
        }
      </div>
      <button class="export-btn" (click)="exportCsv()" [disabled]="totalCount() === 0 || exporting()">
        {{ exporting() ? 'Exporting…' : '↓ Export CSV' }}
      </button>
    </div>

    <!-- Filters -->
    <div class="filter-bar">
      <input class="filter-search" type="search" placeholder="Search RO, rego, source RO, customer…"
             (input)="onSearchInput($any($event.target).value)" />
      <div class="filter-dates">
        <label class="filter-label">Completed from</label>
        <input class="filter-date" type="date"
               (change)="onFromChange($any($event.target).value)" />
        <label class="filter-label">to</label>
        <input class="filter-date" type="date"
               (change)="onToChange($any($event.target).value)" />
      </div>
      <select class="filter-select" (change)="onJobTypeChange($any($event.target).value)">
        <option value="">All job types</option>
        @for (jt of jobTypes(); track jt.id) {
          <option [value]="jt.id">{{ jt.name }}</option>
        }
      </select>
    </div>

    <!-- Table -->
    <div class="table-wrap">
      @if (loading()) {
        <div class="state-msg">Loading…</div>
      } @else if (rows().length === 0) {
        <div class="state-msg">No completed ROs match the current filters.</div>
      } @else {
        <table class="archive-table">
          <thead>
            <tr>
              <th class="sortable" (click)="sort('roNumber')">
                RO # <span class="sort-icon">{{ sortIcon('roNumber') }}</span>
              </th>
              <th>Source RO</th>
              <th class="sortable" (click)="sort('rego')">
                Rego <span class="sort-icon">{{ sortIcon('rego') }}</span>
              </th>
              <th class="sortable" (click)="sort('customerName')">
                Customer <span class="sort-icon">{{ sortIcon('customerName') }}</span>
              </th>
              <th>Job Type</th>
              <th>Body Type</th>
              <th class="sortable" (click)="sort('roDate')">
                RO Date <span class="sort-icon">{{ sortIcon('roDate') }}</span>
              </th>
              <th class="sortable" (click)="sort('completedAt')">
                Completed <span class="sort-icon">{{ sortIcon('completedAt') }}</span>
              </th>
              <th class="num-col">Est. h</th>
              <th class="num-col">Act. h</th>
              <th class="num-col">Variance</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.id) {
              <tr class="data-row" [routerLink]="['/sales/ro', row.id]">
                <td class="ro-num">{{ row.roNumber }}</td>
                <td class="mono-cell">{{ row.sourceRoNumber ?? '—' }}</td>
                <td class="mono-cell">{{ row.rego ?? '—' }}</td>
                <td>{{ row.customerName }}</td>
                <td>{{ row.jobTypeName }}</td>
                <td>{{ bodyTypeLabel(row.bodyType ?? '') }}</td>
                <td class="mono-cell">{{ row.roDate | date:'dd MMM yyyy' }}</td>
                <td class="mono-cell">{{ row.completedAt | date:'dd MMM yyyy' }}</td>
                <td class="num-cell">{{ row.estimatedHours | number:'1.1-1' }}</td>
                <td class="num-cell">{{ row.actualHours | number:'1.1-1' }}</td>
                <td class="num-cell">
                  <span class="variance-chip"
                        [class.over]="row.actualHours - row.estimatedHours > 0"
                        [class.under]="row.actualHours - row.estimatedHours < 0">
                    {{ varianceDisplay(row) }}
                  </span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>

    <!-- Pagination -->
    @if (totalPages() > 1) {
      <div class="pagination">
        <button class="page-btn" [disabled]="page() === 1" (click)="goPage(page() - 1)">← Prev</button>
        <span class="page-indicator">Page {{ page() }} of {{ totalPages() }}</span>
        <button class="page-btn" [disabled]="page() === totalPages()" (click)="goPage(page() + 1)">Next →</button>
      </div>
    }
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

    /* Page header */
    .page-header { display: flex; align-items: baseline; justify-content: space-between;
                   padding: 24px 28px 0; }
    .page-header-left { display: flex; align-items: baseline; gap: 14px; }
    .page-title { font-family: var(--display); font-size: 28px; font-weight: 500; color: var(--ink);
                  letter-spacing: -0.02em; margin: 0; }
    .result-count { font-family: var(--mono); font-size: 12px; color: var(--ink-3); }
    .export-btn { padding: 8px 16px; border: 0.5px solid var(--rule-strong); border-radius: 999px;
                  font-size: 13px; font-weight: 500; background: transparent; color: var(--ink); cursor: pointer;
                  transition: background 0.15s, color 0.15s; }
    .export-btn:hover:not(:disabled) { background: var(--topbar-bg); color: var(--topbar-text); border-color: var(--ink); }
    .export-btn:disabled { opacity: 0.4; cursor: default; }

    /* Filter bar */
    .filter-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
                  padding: 18px 28px 0; }
    .filter-search { flex: 1; min-width: 220px; padding: 8px 10px;
                     border: 0.5px solid var(--rule-strong); border-radius: 6px;
                     font-size: 13px; background: var(--paper); color: var(--ink); }
    .filter-dates { display: flex; align-items: center; gap: 6px; }
    .filter-label { font-family: var(--mono); font-size: 11px; color: var(--ink-3);
                    text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap; }
    .filter-date { padding: 7px 8px; border: 0.5px solid var(--rule-strong); border-radius: 6px;
                   font-size: 12px; background: var(--paper); color: var(--ink); }
    .filter-select { padding: 8px 10px; border: 0.5px solid var(--rule-strong); border-radius: 6px;
                     font-size: 13px; background: var(--paper); color: var(--ink); }

    /* Table */
    .table-wrap { overflow-x: auto; padding: 16px 28px 0; }
    .state-msg { font-family: var(--mono); font-size: 13px; color: var(--ink-3);
                 text-align: center; padding: 48px 0; }

    .archive-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .archive-table th {
      font-family: var(--mono); font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.1em; color: var(--ink-3); font-weight: 500;
      padding: 8px 12px; border-bottom: 1px solid var(--rule); text-align: left;
      white-space: nowrap; background: var(--paper);
    }
    .archive-table th.sortable { cursor: pointer; user-select: none; }
    .archive-table th.sortable:hover { color: var(--ink); }
    .archive-table th.num-col { text-align: right; }
    .sort-icon { opacity: 0.5; font-size: 9px; }

    .data-row { cursor: pointer; transition: background 0.1s; }
    .data-row:hover { background: var(--paper-2); }
    .data-row td { padding: 10px 12px; border-bottom: 0.5px solid var(--rule); vertical-align: middle; }

    .ro-num { font-family: var(--mono); font-weight: 500; font-size: 13px; color: var(--accent); white-space: nowrap; }
    .mono-cell { font-family: var(--mono); font-size: 12px; color: var(--ink-2); white-space: nowrap; }
    .num-cell { font-family: var(--mono); font-size: 12px; text-align: right; color: var(--ink-2); }

    .variance-chip { font-family: var(--mono); font-size: 11px; font-weight: 500;
                     padding: 2px 7px; border-radius: 4px;
                     background: var(--paper-3); color: var(--ink-3); }
    .variance-chip.over  { background: #fee2e2; color: var(--bad); }
    .variance-chip.under { background: #dcfce7; color: var(--good); }

    /* Pagination */
    .pagination { display: flex; align-items: center; justify-content: center; gap: 16px;
                  padding: 20px 28px 40px; }
    .page-btn { padding: 7px 16px; border: 0.5px solid var(--rule-strong); border-radius: 6px;
                font-size: 13px; background: transparent; color: var(--ink); cursor: pointer; }
    .page-btn:hover:not(:disabled) { background: var(--topbar-bg); color: var(--topbar-text); }
    .page-btn:disabled { opacity: 0.35; cursor: default; }
    .page-indicator { font-family: var(--mono); font-size: 12px; color: var(--ink-3); }
  `],
})
export class ArchiveComponent implements OnInit {
  private svc        = inject(DashboardService);
  private auth       = inject(AuthService);
  private destroyRef = inject(DestroyRef);
  router             = inject(Router);

  readonly bodyTypeLabel = bodyTypeLabel;

  user = this.auth.user;

  rows       = signal<ArchiveRo[]>([]);
  totalCount = signal(0);
  loading    = signal(false);
  exporting  = signal(false);
  jobTypes   = signal<JobTypeRef[]>([]);

  private searchValue  = '';
  private fromValue    = '';
  private toValue      = '';
  private jobTypeValue = 0;

  sortBy$  = signal<SortField>('completedAt');
  sortDir$ = signal<'asc' | 'desc'>('desc');
  page     = signal(1);

  readonly pageSize  = 50;
  totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize)));

  private search$ = new Subject<string>();

  ngOnInit(): void {
    this.svc.getJobTypes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(jt => this.jobTypes.set(jt));

    this.search$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(v => { this.searchValue = v; this.page.set(1); this.load(); });

    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.svc.getArchive({
      search:    this.searchValue  || undefined,
      from:      this.fromValue    || undefined,
      to:        this.toValue      || undefined,
      jobTypeId: this.jobTypeValue || undefined,
      sortBy:    this.sortBy$(),
      sortDir:   this.sortDir$(),
      page:      this.page(),
      pageSize:  this.pageSize,
    }).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          this.rows.set(result.rows);
          this.totalCount.set(result.totalCount);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  onSearchInput(value: string): void  { this.search$.next(value); }
  onFromChange(value: string): void   { this.fromValue = value;    this.page.set(1); this.load(); }
  onToChange(value: string): void     { this.toValue = value;      this.page.set(1); this.load(); }
  onJobTypeChange(value: string): void {
    this.jobTypeValue = value ? Number(value) : 0;
    this.page.set(1);
    this.load();
  }

  sort(field: SortField): void {
    if (this.sortBy$() === field) {
      this.sortDir$.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortBy$.set(field);
      this.sortDir$.set(field === 'completedAt' ? 'desc' : 'asc');
    }
    this.page.set(1);
    this.load();
  }

  sortIcon(field: SortField): string {
    if (this.sortBy$() !== field) return '↕';
    return this.sortDir$() === 'asc' ? '↑' : '↓';
  }

  goPage(n: number): void { this.page.set(n); this.load(); }

  varianceDisplay(row: ArchiveRo): string {
    const v = row.actualHours - row.estimatedHours;
    if (v === 0) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + ' h';
  }

  exportCsv(): void {
    this.exporting.set(true);
    this.svc.getArchive({
      search:    this.searchValue  || undefined,
      from:      this.fromValue    || undefined,
      to:        this.toValue      || undefined,
      jobTypeId: this.jobTypeValue || undefined,
      sortBy:    this.sortBy$(),
      sortDir:   this.sortDir$(),
      page:      1,
      pageSize:  9999,
    }).subscribe({
      next: result => {
        const header = ['RO Number', 'Source RO', 'Rego', 'Customer', 'Job Type',
                        'Body Type', 'RO Date', 'Completed', 'Est h', 'Act h', 'Variance h'];
        const dataRows = result.rows.map(r => [
          r.roNumber,
          r.sourceRoNumber ?? '',
          r.rego ?? '',
          r.customerName,
          r.jobTypeName,
          bodyTypeLabel(r.bodyType ?? ''),
          r.roDate,
          r.completedAt ? r.completedAt.slice(0, 10) : '',
          r.estimatedHours.toFixed(1),
          r.actualHours.toFixed(1),
          (r.actualHours - r.estimatedHours).toFixed(1),
        ]);
        const csv = [header, ...dataRows]
          .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
          .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `completed-ros-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        this.exporting.set(false);
      },
      error: () => this.exporting.set(false),
    });
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
