import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import {
  DashboardService, ConcentrationPeriod, CustomerConcentrationReport, CustomerTrend,
} from './dashboard.service';

const PERIODS: { value: ConcentrationPeriod; label: string }[] = [
  { value: 'last_quarter', label: 'Last quarter' },
  { value: 'last_year',    label: 'Last year' },
  { value: 'ytd',          label: 'YTD' },
];

@Component({
  selector: 'app-customer-concentration',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  template: `
    <section class="panel mt-16">
      <div class="report-header">
        <div>
          <h2 class="panel-title">Customer Concentration</h2>
          <p class="report-desc">
            Pareto distribution of work hours by customer · {{ periodLabel() }}
          </p>
        </div>
        <button class="btn-export"
                [disabled]="loading() || (report()?.rows?.length ?? 0) === 0"
                (click)="downloadCsv()">Export CSV</button>
      </div>

      <div class="cc-pills">
        @for (p of periods; track p.value) {
          <button class="cc-pill" [class.cc-pill-active]="period() === p.value"
                  (click)="period.set(p.value)">{{ p.label }}</button>
        }
      </div>

      @if (loading()) {
        <div class="loading-row">Loading…</div>
      } @else if (error()) {
        <div class="error-row">Could not load data.</div>
      } @else if ((report()?.rows?.length ?? 0) === 0) {
        <p class="empty-panel">No completed work in this period.</p>
      } @else {
        @if (top3OverThreshold()) {
          <div class="cc-banner">
            ⚠ {{ report()!.rows[2].cumulativePercent | number:'1.0-0' }}% of hours from top 3 customers
          </div>
        }
        <div class="cc-summary">
          <span><strong>{{ report()!.totalRoCount }}</strong> ROs</span>
          <span><strong>{{ report()!.totalHours | number:'1.1-1' }}</strong> hours</span>
          <span><strong>{{ report()!.rows.length }}</strong> customers</span>
        </div>
        <div class="cc-layout">
          <div class="cc-chart">
            @for (r of report()!.rows; track r.customerId) {
              <div class="cc-row" [class.cc-row-open]="selectedId() === r.customerId"
                   [class.cc-row-top]="r.topRanked"
                   (click)="toggleRow(r.customerId)">
                <div class="cc-row-name">
                  {{ r.customerName }}
                  @if (r.topRanked) { <span class="cc-top-badge">TOP {{ $index + 1 }}</span> }
                </div>
                <div class="cc-row-bar"><span class="cc-bar-fill"
                  [style.width.%]="barPct(r.totalHours)"></span></div>
                <div class="cc-row-totals">
                  <span class="cc-hours">{{ r.totalHours | number:'1.1-1' }}h</span>
                  <span class="cc-pct">{{ r.percentOfTotal | number:'1.1-1' }}%</span>
                  <span class="cc-cum">cum {{ r.cumulativePercent | number:'1.0-0' }}%</span>
                </div>
              </div>
            }
          </div>
          @if (selectedTrend(); as t) {
            <aside class="cc-trend-panel">
              <div class="cc-trend-header">
                <h3>{{ selectedName() }}</h3>
                <button class="cc-trend-close" (click)="closeTrend()">✕</button>
              </div>
              <p class="cc-trend-desc">8-quarter trend</p>
              @if (t.quarters.length === 0) {
                <p class="empty-panel">No history.</p>
              } @else {
                <svg class="cc-trend-chart" [attr.viewBox]="'0 0 ' + chartWidth + ' 100'" preserveAspectRatio="none">
                  <polyline class="cc-trend-line"
                            [attr.points]="trendPoints(t)"
                            fill="none" stroke="var(--accent)" stroke-width="2" />
                </svg>
                <table class="cc-trend-table">
                  <thead><tr><th>Quarter</th><th class="num-col">ROs</th><th class="num-col">Hours</th></tr></thead>
                  <tbody>
                    @for (q of t.quarters; track q.quarterLabel) {
                      <tr>
                        <td class="mono">{{ q.quarterLabel }}</td>
                        <td class="mono num-col">{{ q.roCount }}</td>
                        <td class="mono num-col">{{ q.totalHours | number:'1.1-1' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            </aside>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    .panel { background: white; border: 0.5px solid var(--rule); border-radius: 12px; padding: 18px 20px; }
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

    .cc-pills { display: flex; gap: 6px; margin-bottom: 12px; }
    .cc-pill { padding: 5px 12px; border-radius: 999px; border: 0.5px solid var(--rule-strong);
               background: var(--paper-2); color: var(--ink-2); font-size: 12px; cursor: pointer;
               font-family: var(--sans); }
    .cc-pill-active { background: var(--ink); color: var(--paper); border-color: var(--ink); }

    .cc-banner { padding: 8px 12px; border-radius: 6px; background: rgba(217,119,6,0.12);
                 color: var(--warn); font-size: 13px; font-weight: 500; margin-bottom: 12px; }

    .cc-summary { display: flex; gap: 18px; font-size: 12px; color: var(--ink-2); margin-bottom: 12px; }

    .cc-layout { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: start; }
    @media (min-width: 900px) {
      .cc-layout.has-trend { grid-template-columns: 2fr 1fr; }
    }
    .cc-chart { display: flex; flex-direction: column; gap: 4px; }
    .cc-row { display: grid; grid-template-columns: minmax(160px, 220px) 1fr auto;
              gap: 12px; align-items: center; padding: 6px; border-radius: 6px; cursor: pointer; }
    .cc-row:hover, .cc-row-open { background: var(--paper-2); }
    .cc-row-top { font-weight: 500; }
    .cc-row-name { font-size: 13px; color: var(--ink); display: flex; gap: 6px; align-items: center; }
    .cc-top-badge { padding: 1px 6px; border-radius: 3px; background: var(--accent); color: #fff;
                    font-family: var(--mono); font-size: 9px; font-weight: 600; letter-spacing: 0.05em; }
    .cc-row-bar { height: 18px; background: var(--paper-3); border-radius: 3px; overflow: hidden; }
    .cc-bar-fill { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
    .cc-row-totals { display: flex; gap: 8px; font-family: var(--mono); font-size: 11px; color: var(--ink-3);
                     white-space: nowrap; }
    .cc-hours { color: var(--ink-2); font-weight: 500; }
    .cc-pct { color: var(--ink-3); }
    .cc-cum { color: var(--accent); }

    .cc-trend-panel { background: var(--paper-2); border-radius: 8px; padding: 12px;
                      border: 0.5px solid var(--rule); }
    .cc-trend-header { display: flex; justify-content: space-between; align-items: center; }
    .cc-trend-header h3 { margin: 0; font-size: 14px; font-weight: 500; }
    .cc-trend-close { background: none; border: none; cursor: pointer; color: var(--ink-3); font-size: 16px; }
    .cc-trend-desc { font-size: 11px; color: var(--ink-3); margin: 2px 0 8px; }
    .cc-trend-chart { width: 100%; height: 80px; background: white; border-radius: 4px; }
    .cc-trend-line { stroke-linejoin: round; stroke-linecap: round; }
    .cc-trend-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px; }
    .cc-trend-table th { padding: 4px 6px; text-align: left; color: var(--ink-3); font-weight: 600;
                         border-bottom: 0.5px solid var(--rule); }
    .cc-trend-table td { padding: 4px 6px; border-bottom: 0.5px solid var(--rule); }
    .num-col { text-align: right; }
    .mono { font-family: var(--mono); }
  `],
  host: { '[class.has-trend]': '!!selectedTrend()' },
})
export class CustomerConcentrationComponent implements OnInit {
  private svc = inject(DashboardService);

  readonly periods = PERIODS;
  readonly chartWidth = 200;

  loading = signal(false);
  error   = signal(false);
  report  = signal<CustomerConcentrationReport | null>(null);

  period         = signal<ConcentrationPeriod>('last_quarter');
  selectedId     = signal<string | null>(null);
  selectedTrend  = signal<CustomerTrend | null>(null);

  periodLabel = computed(() => this.periods.find(p => p.value === this.period())?.label ?? '');
  selectedName = computed(() => {
    const id = this.selectedId();
    return this.report()?.rows.find(r => r.customerId === id)?.customerName ?? '';
  });
  top3OverThreshold = computed(() => {
    const rows = this.report()?.rows ?? [];
    return rows.length >= 3 && rows[2].cumulativePercent > 60;
  });

  maxHours = computed(() =>
    Math.max(0, ...(this.report()?.rows.map(r => r.totalHours) ?? []))
  );

  constructor() {
    effect(() => { this.fetch(this.period()); });
  }

  ngOnInit(): void {}

  barPct(hours: number): number {
    const m = this.maxHours();
    return m === 0 ? 0 : Math.max(2, hours / m * 100);
  }

  toggleRow(customerId: string): void {
    if (this.selectedId() === customerId) {
      this.closeTrend();
      return;
    }
    this.selectedId.set(customerId);
    this.svc.getCustomerConcentrationTrend(customerId).subscribe({
      next: t => this.selectedTrend.set(t),
      error: () => this.selectedTrend.set(null),
    });
  }

  closeTrend(): void {
    this.selectedId.set(null);
    this.selectedTrend.set(null);
  }

  trendPoints(t: CustomerTrend): string {
    const points = t.quarters;
    if (points.length === 0) return '';
    const max = Math.max(1, ...points.map(p => p.totalHours));
    const stepX = this.chartWidth / Math.max(1, points.length - 1);
    return points.map((p, i) => {
      const x = i * stepX;
      const y = 100 - (p.totalHours / max) * 90 - 5;  // padded
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  downloadCsv(): void {
    const a = document.createElement('a');
    a.href = this.svc.customerConcentrationCsvUrl(this.period());
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  private fetch(period: ConcentrationPeriod): void {
    this.loading.set(true); this.error.set(false);
    this.svc.getCustomerConcentration(period).subscribe({
      next: r => { this.report.set(r); this.loading.set(false); this.closeTrend(); },
      error: () => { this.error.set(true); this.loading.set(false); },
    });
  }
}
