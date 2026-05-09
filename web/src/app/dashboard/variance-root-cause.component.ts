import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap, tap } from 'rxjs';
import {
  DashboardService, VarianceFilters, VarianceGroupBy,
  VarianceReport, VarianceRecordsPage,
} from './dashboard.service';
import { saveBlob } from './save-blob.util';

const GROUPS: { value: VarianceGroupBy; label: string }[] = [
  { value: 'reason',     label: 'Reason' },
  { value: 'station',    label: 'Station' },
  { value: 'template',   label: 'Template' },
  { value: 'technician', label: 'Technician' },
];

@Component({
  selector: 'app-variance-root-cause',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, DecimalPipe],
  template: `
    <section class="panel mt-16">
      <div class="report-header">
        <div>
          <h2 class="panel-title">Variance Root Cause</h2>
          <p class="report-desc">Variance hours sliced by reason · station · template · technician</p>
        </div>
        <button class="btn-export"
                [disabled]="loading() || !report() || (report()?.rows?.length ?? 0) === 0"
                (click)="downloadCsv()">
          Export CSV
        </button>
      </div>

      <div class="vr-filters">
        <div class="vr-group-pills">
          @for (g of groups; track g.value) {
            <button class="vr-pill"
                    [class.vr-pill-active]="groupBy() === g.value"
                    (click)="groupBy.set(g.value)">{{ g.label }}</button>
          }
        </div>
        <div class="vr-dates">
          <label>From <input type="date" [value]="from()" (change)="from.set($any($event.target).value)" /></label>
          <label>To <input type="date" [value]="to()" (change)="to.set($any($event.target).value)" /></label>
          <label>Min size <input type="number" min="1" [value]="minSampleSize()"
                                 (change)="minSampleSize.set(+$any($event.target).value || 1)" /></label>
        </div>
      </div>

      @if (loading()) {
        <div class="loading-row">Loading…</div>
      } @else if (error()) {
        <div class="error-row">Could not load variance data.</div>
      } @else if ((report()?.rows?.length ?? 0) === 0) {
        <p class="empty-panel">No variance records in this range. Try widening the date range.</p>
      } @else {
        <div class="vr-summary">
          <span><strong>{{ report()!.totalSampleSize }}</strong> records</span>
          <span><strong>{{ report()!.totalDeltaHours | number:'1.1-1' }}</strong> total Δ h</span>
        </div>
        <div class="vr-rows">
          @for (row of report()!.rows; track row.groupKey) {
            <div class="vr-row" [class.vr-row-open]="selectedKey() === row.groupKey"
                 (click)="toggleRow(row.groupKey)">
              <div class="vr-row-label">{{ row.groupLabel }}</div>
              <div class="vr-row-bar">
                @for (b of row.byReason; track b.reasonCode) {
                  <span class="vr-seg" [class.vr-seg-overrun]="b.isOverrun"
                        [style.width.%]="segPct(row.totalDeltaHours, b.deltaHours)"
                        [title]="b.reasonName + ' · ' + b.deltaHours + ' h · ' + b.count + ' records'"></span>
                }
              </div>
              <div class="vr-row-totals">
                {{ row.totalDeltaHours | number:'1.1-1' }} h · {{ row.sampleSize }} rec
              </div>
            </div>
            @if (selectedKey() === row.groupKey && records()) {
              <div class="vr-records">
                @if (records()!.totalCount === 0) {
                  <p class="empty-panel">No records.</p>
                } @else {
                  <table class="vr-records-table">
                    <thead><tr>
                      <th>Recorded</th><th>RO</th><th>Operation</th><th>Station</th>
                      <th>Template</th><th>Tech</th>
                      <th class="num-col">Est</th><th class="num-col">Act</th>
                      <th class="num-col">Δ h</th><th class="num-col">Δ %</th>
                      <th>Reason</th>
                    </tr></thead>
                    <tbody>
                      @for (r of records()!.items; track r.recordId) {
                        <tr>
                          <td class="mono">{{ r.recordedAt | date:'dd MMM' }}</td>
                          <td class="mono">{{ r.roNumber }}</td>
                          <td>{{ r.operationName }}</td>
                          <td>{{ r.stationName }}</td>
                          <td class="mono">{{ r.templateCode }}</td>
                          <td>{{ r.technicianName ?? '—' }}</td>
                          <td class="mono num-col">{{ r.estimatedHours | number:'1.1-1' }}</td>
                          <td class="mono num-col">{{ r.actualHours | number:'1.1-1' }}</td>
                          <td class="mono num-col" [class.over]="r.deltaHours > 0">{{ r.deltaHours | number:'1.1-1' }}</td>
                          <td class="mono num-col">{{ r.deltaPercent !== null ? (r.deltaPercent | number:'1.0-0') + '%' : '—' }}</td>
                          <td>{{ r.reasonName }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                  <div class="vr-pager">
                    <button [disabled]="recordsPage() === 1" (click)="changeRecordsPage(-1)">‹ Prev</button>
                    <span class="mono">Page {{ recordsPage() }} of {{ totalRecordsPages() }}</span>
                    <button [disabled]="recordsPage() === totalRecordsPages()" (click)="changeRecordsPage(1)">Next ›</button>
                  </div>
                }
              </div>
            }
          }
        </div>
      }
    </section>
  `,
  styles: [`
    .panel { background: white; border: 0.5px solid var(--rule); border-radius: 12px;
             padding: 18px 20px; }
    .mt-16 { margin-top: 16px; }
    .panel-title { font-family: var(--display); font-size: 18px; font-weight: 500; margin: 0 0 4px;
                   color: var(--ink); letter-spacing: -0.01em; }
    .report-desc { font-size: 12px; color: var(--ink-3); margin: 0; }
    .report-header { display: flex; justify-content: space-between; align-items: flex-start;
                     gap: 12px; margin-bottom: 14px; }
    .btn-export { background: transparent; border: 0.5px solid var(--rule-strong); border-radius: 6px;
                  padding: 6px 14px; font-size: 12px; color: var(--ink-2); cursor: pointer; font-family: var(--sans); }
    .btn-export:hover:not(:disabled) { border-color: var(--ink-3); }
    .btn-export:disabled { opacity: 0.4; cursor: not-allowed; }
    .loading-row, .error-row, .empty-panel { padding: 20px 0; text-align: center; color: var(--ink-3); font-size: 13px; }
    .error-row { color: var(--bad); }

    .vr-filters { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 14px;
                  padding-bottom: 12px; border-bottom: 0.5px solid var(--rule); }
    .vr-group-pills { display: flex; gap: 6px; flex-wrap: wrap; }
    .vr-pill { padding: 5px 12px; border-radius: 999px; border: 0.5px solid var(--rule-strong);
               background: var(--paper-2); color: var(--ink-2); font-size: 12px; cursor: pointer;
               font-family: var(--sans); }
    .vr-pill-active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    .vr-dates { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .vr-dates label { font-size: 11px; color: var(--ink-3); display: flex; gap: 4px; align-items: center; }
    .vr-dates input { padding: 4px 8px; border: 0.5px solid var(--rule-strong); border-radius: 5px;
                      font-size: 12px; font-family: var(--sans); }
    .vr-summary { display: flex; gap: 18px; font-size: 12px; color: var(--ink-2); margin-bottom: 10px; }

    .vr-rows { display: flex; flex-direction: column; gap: 4px; }
    .vr-row { display: grid; grid-template-columns: minmax(140px, 200px) 1fr auto;
              align-items: center; gap: 12px; padding: 8px 6px; border-radius: 6px; cursor: pointer;
              transition: background 0.1s; }
    .vr-row:hover, .vr-row-open { background: var(--paper-2); }
    .vr-row-label { font-size: 13px; color: var(--ink); font-weight: 500; }
    .vr-row-bar { height: 18px; display: flex; gap: 1px; background: var(--paper-3); border-radius: 3px;
                  overflow: hidden; }
    .vr-seg { background: var(--ink-3); }
    .vr-seg-overrun { background: var(--bad); }
    .vr-row-totals { font-family: var(--mono); font-size: 11px; color: var(--ink-3); white-space: nowrap; }

    .vr-records { padding: 12px; background: var(--paper-2); border-radius: 6px; margin-bottom: 4px; }
    .vr-records-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .vr-records-table th { text-align: left; padding: 6px 8px; font-size: 10px; font-weight: 600;
                            color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.05em;
                            border-bottom: 0.5px solid var(--rule); }
    .vr-records-table td { padding: 6px 8px; border-bottom: 0.5px solid var(--rule); }
    .num-col { text-align: right; }
    .mono { font-family: var(--mono); font-size: 11px; }
    .over { color: var(--bad); font-weight: 600; }
    .vr-pager { display: flex; justify-content: center; align-items: center; gap: 12px;
                margin-top: 10px; font-size: 12px; }
    .vr-pager button { padding: 4px 10px; border: 0.5px solid var(--rule-strong); border-radius: 5px;
                       background: white; cursor: pointer; }
    .vr-pager button:disabled { opacity: 0.4; cursor: not-allowed; }
  `],
})
export class VarianceRootCauseComponent implements OnInit {
  private svc = inject(DashboardService);

  readonly groups = GROUPS;
  loading = signal(false);
  error   = signal(false);

  groupBy       = signal<VarianceGroupBy>('reason');
  from          = signal<string>(this.daysAgo(90));
  to            = signal<string>(this.today());
  minSampleSize = signal<number>(1);

  selectedKey   = signal<string | null>(null);
  records       = signal<VarianceRecordsPage | null>(null);
  recordsPage   = signal(1);

  /**
   * Single combined filter signal. Driving the fetch through toObservable +
   * switchMap means rapid filter changes cancel any in-flight request, and
   * Angular's takeUntilDestroyed equivalent (toSignal) cleans up subscription
   * lifetime — replaces the previous `effect()` that subscribed inline and
   * leaked overlapping HTTP requests when the user typed in the date inputs.
   */
  private filters = computed<VarianceFilters>(() => ({
    from:          this.from(),
    to:            this.to(),
    groupBy:       this.groupBy(),
    minSampleSize: this.minSampleSize(),
  }));

  report = toSignal<VarianceReport | null>(
    toObservable(this.filters).pipe(
      debounceTime(300),
      distinctUntilChanged((a, b) =>
        a.from === b.from && a.to === b.to &&
        a.groupBy === b.groupBy && a.minSampleSize === b.minSampleSize),
      tap(() => {
        this.loading.set(true);
        this.error.set(false);
        // Filter change always invalidates an open drill-through
        this.selectedKey.set(null);
        this.records.set(null);
      }),
      switchMap(f => this.svc.getVarianceRootCause(f).pipe(
        tap(() => this.loading.set(false)),
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return of(null);
        }),
      )),
    ),
    { initialValue: null },
  );

  totalRecordsPages = computed(() => {
    const p = this.records();
    if (!p || p.totalCount === 0) return 1;
    return Math.max(1, Math.ceil(p.totalCount / p.pageSize));
  });

  ngOnInit(): void {}

  segPct(total: number, segment: number): number {
    if (total === 0) return 0;
    const pct = Math.abs(segment) / Math.max(0.01, Math.abs(total)) * 100;
    return Math.max(2, Math.min(100, pct));
  }

  toggleRow(groupKey: string): void {
    if (this.selectedKey() === groupKey) {
      this.selectedKey.set(null);
      this.records.set(null);
      return;
    }
    this.selectedKey.set(groupKey);
    this.recordsPage.set(1);
    this.loadRecords(groupKey, 1);
  }

  changeRecordsPage(delta: number): void {
    const newPage = this.recordsPage() + delta;
    if (newPage < 1 || newPage > this.totalRecordsPages()) return;
    this.recordsPage.set(newPage);
    if (this.selectedKey()) this.loadRecords(this.selectedKey()!, newPage);
  }

  downloadCsv(): void {
    this.svc.downloadVarianceRootCauseCsv({
      from: this.from(), to: this.to(),
      groupBy: this.groupBy(), minSampleSize: this.minSampleSize(),
    }).subscribe(blob => {
      const fname = `variance-root-cause-${this.from()}_${this.to()}.csv`;
      saveBlob(blob, fname);
    });
  }

  private loadRecords(groupKey: string, page: number): void {
    this.svc.getVarianceRootCauseRecords({
      from: this.from(), to: this.to(),
      groupBy: this.groupBy(), groupKey, page, pageSize: 25,
    }).subscribe({
      next: p => this.records.set(p),
      error: () => this.records.set(null),
    });
  }

  private today(): string  { return new Date().toISOString().slice(0, 10); }
  private daysAgo(n: number): string {
    const d = new Date(); d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }
}
