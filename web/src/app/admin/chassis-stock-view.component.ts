import { Component, inject, signal, computed, effect, untracked, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ThemeSwitcherComponent } from '../core/theme-switcher.component';
import { ChassisStockService, ChassisRecord } from './chassis-stock.service';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-chassis-stock-view',
  standalone: true,
  imports: [CommonModule, DatePipe, ThemeSwitcherComponent],
  template: `
    <div class="page-wrap">
      <header class="topbar">
        <div class="brand">
          <img class="brand-logo" src="assets/nee-logo.png" alt="North East Engineering" />
          <span class="brand-sub">Chassis Stock</span>
        </div>
        <div class="topbar-right">
          @if (user(); as u) {
            <span class="user-label">{{ u.fullName }}</span>
          }
          <a class="nav-link" (click)="router.navigate(['/admin'])">Admin</a>
          <app-theme-switcher />
          <button class="logout" (click)="logout()">Sign out</button>
        </div>
      </header>

      <div class="sub-tab-bar">
        <button class="sub-tab" (click)="router.navigate(['/admin/chassis-stock'])">Upload</button>
        <button class="sub-tab sub-tab-active">View Records</button>
      </div>

      <main class="stage">
        <!-- Filter bar -->
        <div class="summary-bar">
          @for (s of statusFilters; track s.value) {
            <button
              class="chip"
              [class.chip-active]="statusFilter() === s.value"
              (click)="statusFilter.set(s.value)"
            >
              <span class="chip-dot dot-{{ s.value.toLowerCase() }}"></span>
              {{ s.label }}
              <span class="chip-count">{{ countFor(s.value) }}</span>
            </button>
          }

          <div class="search-wrap">
            <svg class="search-icon" width="14" height="14" viewBox="0 0 20 20" fill="none"
                 stroke="currentColor" stroke-width="1.8">
              <circle cx="8.5" cy="8.5" r="5.5"/><path d="M15 15l3.5 3.5"/>
            </svg>
            <input
              class="search-input"
              type="text"
              placeholder="Search chassis #, description…"
              [value]="search()"
              (input)="search.set($any($event.target).value)"
            />
          </div>
        </div>

        <!-- Table -->
        @if (loading()) {
          <p class="empty-msg">Loading…</p>
        } @else if (filtered().length === 0) {
          <p class="empty-msg">No chassis records match the current filter.</p>
        } @else {
          <div class="table-wrap">
            <table class="chassis-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Chassis #</th>
                  <th>Description</th>
                  <th>Class</th>
                  <th>Body Type</th>
                  <th>Colour</th>
                  <th>Tag #</th>
                  <th>Arrival</th>
                  <th>Last Seen</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                @for (row of page(); track row.id) {
                  <tr>
                    <td>
                      <span class="status-badge badge-{{ row.status.toLowerCase() }}">
                        {{ row.status }}
                      </span>
                    </td>
                    <td class="mono">{{ row.chassisNumber }}</td>
                    <td>{{ row.description }}</td>
                    <td>{{ row.chassisClass }}</td>
                    <td>{{ row.bodyType ?? '—' }}</td>
                    <td>{{ row.colour ?? '—' }}</td>
                    <td class="mono">{{ row.tagNumber ?? '—' }}</td>
                    <td class="mono">{{ row.arrivalDate ? (row.arrivalDate | date:'dd MMM yyyy') : '—' }}</td>
                    <td class="mono">{{ row.lastSeenAt ? (row.lastSeenAt | date:'dd MMM yyyy') : '—' }}</td>
                    <td class="notes-cell">{{ row.notes ?? '' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- Pagination footer -->
          <div class="pagination">
            <span class="page-info">
              Showing {{ rangeStart() }}–{{ rangeEnd() }} of {{ filtered().length }} record{{ filtered().length === 1 ? '' : 's' }}
            </span>

            <div class="page-controls">
              <button class="page-btn" [disabled]="currentPage() === 1" (click)="goTo(currentPage() - 1)">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M10 3L5 8l5 5"/>
                </svg>
              </button>

              @for (p of pageNumbers(); track $index) {
                @if (p === '...') {
                  <span class="page-ellipsis">…</span>
                } @else {
                  <button
                    class="page-btn"
                    [class.page-btn-active]="p === currentPage()"
                    (click)="goTo(+p)"
                  >{{ p }}</button>
                }
              }

              <button class="page-btn" [disabled]="currentPage() === totalPages()" (click)="goTo(currentPage() + 1)">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M6 3l5 5-5 5"/>
                </svg>
              </button>
            </div>
          </div>
        }
      </main>
    </div>
  `,
  styles: [`
    .page-wrap { min-height: 100vh; display: flex; flex-direction: column; background: var(--paper); }

    /* Topbar */
    .topbar { display: flex; justify-content: space-between; align-items: center;
              padding: 14px 28px; background: var(--topbar-bg); color: var(--topbar-text); }
    .brand  { display: flex; align-items: center; gap: 12px; }
    .brand-logo { height: 48px; width: auto; filter: var(--logo-filter); }
    .brand-sub  { font-family: var(--mono); font-size: 11px; text-transform: uppercase;
                  letter-spacing: 0.12em; color: var(--topbar-sub); }
    .topbar-right { display: flex; align-items: center; gap: 16px; }
    .user-label { font-size: 13px; color: var(--topbar-muted); }
    .nav-link { font-size: 13px; color: var(--topbar-muted); cursor: pointer;
                text-decoration: none; padding-bottom: 1px; border-bottom: 1px solid transparent; }
    .nav-link:hover { color: var(--topbar-text); border-bottom-color: var(--topbar-border); }
    .logout { background: transparent; border: 0.5px solid var(--topbar-border);
              color: var(--topbar-text); padding: 6px 14px; border-radius: 6px;
              font-size: 13px; cursor: pointer; }
    .logout:hover { background: var(--topbar-hover); }

    /* Sub-tabs */
    .sub-tab-bar { display: flex; gap: 2px; padding: 0 28px;
                   border-bottom: 1px solid var(--rule); background: var(--paper); }
    .sub-tab { background: none; border: none; padding: 10px 18px; font-size: 13px;
               color: var(--ink-3); cursor: pointer; border-bottom: 2px solid transparent;
               margin-bottom: -1px; transition: color 0.15s; }
    .sub-tab:hover { color: var(--ink); }
    .sub-tab-active { color: var(--ink) !important; border-bottom-color: var(--ink) !important;
                      font-weight: 500; }

    .stage { padding: 24px 28px; flex: 1; }

    /* Filter bar */
    .summary-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
    .chip { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 20px;
            border: 0.5px solid var(--rule-strong); background: var(--paper-2);
            font-size: 12px; color: var(--ink-2); cursor: pointer;
            transition: background 0.15s, border-color 0.15s; }
    .chip:hover { background: var(--paper-3); }
    .chip-active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    .chip-active .chip-dot { border-color: var(--paper-2); }
    .chip-count { font-family: var(--mono); font-size: 11px; opacity: 0.75; }
    .chip-dot { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--paper); }
    .dot-all       { background: var(--ink-3); }
    .dot-available { background: var(--good); }
    .dot-allocated { background: var(--warn); }
    .dot-delivered { background: var(--ink-3); }

    /* Search */
    .search-wrap { position: relative; margin-left: auto; }
    .search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
                   color: var(--ink-3); pointer-events: none; }
    .search-input { padding: 7px 12px 7px 30px; background: var(--paper-2);
                    border: 0.5px solid var(--rule-strong); border-radius: 20px;
                    font-size: 13px; font-family: var(--sans); color: var(--ink); outline: none;
                    min-width: 240px; transition: border-color 0.15s; }
    .search-input:focus { border-color: var(--accent); background: var(--paper); }

    /* Table */
    .table-wrap { overflow-x: auto; border: 0.5px solid var(--rule-strong);
                  border-radius: 8px; background: var(--paper); }
    .chassis-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .chassis-table th { padding: 10px 14px; text-align: left; font-size: 11px; font-weight: 600;
                        letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3);
                        border-bottom: 0.5px solid var(--rule-strong); white-space: nowrap; }
    .chassis-table td { padding: 10px 14px; border-bottom: 0.5px solid var(--rule);
                        color: var(--ink-2); white-space: nowrap; }
    .chassis-table tbody tr:last-child td { border-bottom: none; }
    .chassis-table tbody tr:hover td { background: var(--paper-2); }
    .mono { font-family: var(--mono); font-size: 12px; }
    .notes-cell { max-width: 200px; overflow: hidden; text-overflow: ellipsis;
                  white-space: nowrap; color: var(--ink-3); }

    /* Status badges */
    .status-badge { display: inline-block; padding: 2px 8px; border-radius: 10px;
                    font-size: 10px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
    .badge-available { background: rgba(22,163,74,0.12);  color: var(--good); }
    .badge-allocated  { background: rgba(217,119,6,0.12); color: var(--warn); }
    .badge-delivered  { background: var(--rule);           color: var(--ink-3); }

    /* Pagination */
    .pagination { display: flex; align-items: center; justify-content: space-between;
                  margin-top: 16px; padding-top: 16px; border-top: 0.5px solid var(--rule); }
    .page-info { font-size: 12px; color: var(--ink-3); font-family: var(--mono); }
    .page-controls { display: flex; align-items: center; gap: 4px; }
    .page-btn { min-width: 32px; height: 32px; padding: 0 6px; border-radius: 6px;
                background: none; border: 0.5px solid var(--rule-strong);
                color: var(--ink-2); font-size: 13px; font-family: var(--sans);
                cursor: pointer; display: flex; align-items: center; justify-content: center;
                transition: background 0.15s, border-color 0.15s, color 0.15s; }
    .page-btn:hover:not(:disabled) { background: var(--paper-2); border-color: var(--ink-3); color: var(--ink); }
    .page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .page-btn-active { background: var(--ink) !important; border-color: var(--ink) !important;
                       color: var(--paper) !important; font-weight: 600; }
    .page-ellipsis { min-width: 32px; text-align: center; color: var(--ink-3);
                     font-size: 13px; line-height: 32px; }

    .empty-msg { color: var(--ink-3); font-size: 13px; padding: 40px 0; text-align: center; }
  `],
})
export class ChassisStockViewComponent implements OnInit {
  router = inject(Router);
  private svc = inject(ChassisStockService);
  private auth = inject(AuthService);

  user = this.auth.user;

  records     = signal<ChassisRecord[]>([]);
  loading     = signal(true);
  statusFilter = signal<string>('ALL');
  search      = signal('');
  currentPage = signal(1);

  statusFilters = [
    { value: 'ALL',       label: 'All' },
    { value: 'AVAILABLE', label: 'Available' },
    { value: 'ALLOCATED', label: 'Allocated' },
    { value: 'DELIVERED', label: 'Delivered' },
  ];

  filtered = computed(() => {
    const s = this.statusFilter();
    const q = this.search().toLowerCase().trim();
    return this.records().filter(r => {
      const matchStatus = s === 'ALL' || r.status === s;
      const matchSearch = !q ||
        r.chassisNumber.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        (r.bodyType?.toLowerCase().includes(q) ?? false) ||
        (r.colour?.toLowerCase().includes(q) ?? false) ||
        (r.tagNumber?.toLowerCase().includes(q) ?? false);
      return matchStatus && matchSearch;
    });
  });

  totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / PAGE_SIZE)));

  page = computed(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.filtered().slice(start, start + PAGE_SIZE);
  });

  rangeStart = computed(() => this.filtered().length === 0 ? 0 : (this.currentPage() - 1) * PAGE_SIZE + 1);
  rangeEnd   = computed(() => Math.min(this.currentPage() * PAGE_SIZE, this.filtered().length));

  pageNumbers = computed((): (number | '...')[] => {
    const total   = this.totalPages();
    const current = this.currentPage();
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages: (number | '...')[] = [1];
    if (current > 3) pages.push('...');
    const lo = Math.max(2, current - 1);
    const hi = Math.min(total - 1, current + 1);
    for (let p = lo; p <= hi; p++) pages.push(p);
    if (current < total - 2) pages.push('...');
    pages.push(total);
    return pages;
  });

  constructor() {
    // Reset to page 1 whenever the filter or search changes
    effect(() => {
      this.statusFilter();
      this.search();
      untracked(() => this.currentPage.set(1));
    });
  }

  countFor(status: string): number {
    if (status === 'ALL') return this.records().length;
    return this.records().filter(r => r.status === status).length;
  }

  goTo(p: number): void {
    this.currentPage.set(Math.max(1, Math.min(p, this.totalPages())));
  }

  ngOnInit(): void {
    this.svc.getChassisRecords().subscribe({
      next: rows => { this.records.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
