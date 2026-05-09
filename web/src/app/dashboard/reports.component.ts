import {
  Component, OnInit, inject, signal, computed,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { DashboardService, ThroughputWeek, CalibrationRow } from './dashboard.service';
import { catchError, of } from 'rxjs';
import { VarianceRootCauseComponent } from './variance-root-cause.component';
import { CustomerConcentrationComponent } from './customer-concentration.component';
import { ForecastWidgetComponent } from './forecast-widget.component';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [
    CommonModule, DecimalPipe,
    VarianceRootCauseComponent, CustomerConcentrationComponent, ForecastWidgetComponent,
  ],
  template: `
    <!-- Throughput Report -->
    <section class="panel">
      <div class="report-header">
        <div>
          <h2 class="panel-title">Throughput</h2>
          <p class="report-desc">Repair orders by week · last 12 weeks · grouped by creation date</p>
        </div>
        <button class="btn-export"
                (click)="downloadThroughputCsv()"
                [disabled]="throughputLoading() || throughput().length === 0">
          Export CSV
        </button>
      </div>

      @if (throughputLoading()) {
        <div class="loading-row">Loading…</div>
      } @else if (throughputError()) {
        <div class="error-row">Could not load throughput data.</div>
      } @else if (throughput().length === 0 || maxWeekTotal() === 0) {
        <p class="empty-panel">No repair orders in the last 12 weeks.</p>
      } @else {
        <div class="chart-area">
          @for (w of throughput(); track w.weekStart) {
            <div class="bar-col">
              <div class="seg-blocked"    [style.height.px]="barPx(w.blocked)"></div>
              <div class="seg-active"     [style.height.px]="barPx(w.inProgress)"></div>
              <div class="seg-completed"  [style.height.px]="barPx(w.completed)"></div>
            </div>
          }
        </div>
        <div class="chart-labels">
          @for (w of throughput(); track w.weekStart) {
            <span class="bar-label">{{ weekLabel(w.weekStart) }}</span>
          }
        </div>
        <div class="chart-legend">
          <span class="legend-swatch swatch-completed"></span><span class="legend-text">Completed</span>
          <span class="legend-swatch swatch-active"></span><span class="legend-text">Active</span>
          <span class="legend-swatch swatch-blocked"></span><span class="legend-text">Blocked</span>
        </div>
      }
    </section>

    <!-- Calibration Report -->
    <section class="panel mt-16">
      <div class="report-header">
        <div>
          <h2 class="panel-title">Estimate Calibration</h2>
          <p class="report-desc">Template estimate vs actual hours · completed tasks only</p>
        </div>
        <div class="report-actions">
          @if (templateCodes().length > 1) {
            <select class="filter-select" (change)="onTemplateFilter($event)">
              <option value="">All templates</option>
              @for (code of templateCodes(); track code) {
                <option [value]="code">{{ code }}</option>
              }
            </select>
          }
          <button class="btn-export"
                  (click)="downloadCalibrationCsv()"
                  [disabled]="calibrationLoading() || filteredCalibration().length === 0">
            Export CSV
          </button>
        </div>
      </div>

      @if (calibrationLoading()) {
        <div class="loading-row">Loading…</div>
      } @else if (calibrationError()) {
        <div class="error-row">Could not load calibration data.</div>
      } @else if (filteredCalibration().length === 0) {
        <p class="empty-panel">No calibration data available.</p>
      } @else {
        <table class="calib-table">
          <thead>
            <tr>
              <th>Template</th>
              <th>Operation</th>
              <th class="num-col">Estimate</th>
              <th class="num-col">Avg Actual</th>
              <th class="num-col">Delta</th>
              <th class="bar-col-th">Actual vs Estimate</th>
              <th class="num-col">Samples</th>
            </tr>
          </thead>
          <tbody>
            @for (row of filteredCalibration(); track row.templateCode + row.operationName) {
              <tr>
                <td class="code-cell">{{ row.templateCode }}</td>
                <td>{{ row.operationName }}</td>
                <td class="num-col">{{ row.templateEstimate | number:'1.1-1' }}h</td>
                <td class="num-col">
                  @if (row.avgActual !== null) {
                    {{ row.avgActual | number:'1.1-1' }}h
                  } @else {
                    <span class="no-data">—</span>
                  }
                </td>
                <td class="num-col">
                  @if (row.avgDelta !== null) {
                    <span class="delta-badge"
                          [class.delta-over]="row.avgDelta > 0"
                          [class.delta-under]="row.avgDelta < 0">
                      {{ row.avgDelta > 0 ? '+' : '' }}{{ row.avgDelta | number:'1.1-1' }}h
                    </span>
                  } @else {
                    <span class="no-data">—</span>
                  }
                </td>
                <td class="bar-col-th">
                  @if (row.avgActual !== null) {
                    <div class="calib-bar-track">
                      <div class="calib-bar-estimate" [style.width.%]="estimatePct(row)"></div>
                      <div class="calib-bar-actual"
                           [class.actual-over]="(row.avgDelta ?? 0) > 0"
                           [class.actual-under]="(row.avgDelta ?? 0) <= 0"
                           [style.width.%]="actualPct(row)"></div>
                    </div>
                  }
                </td>
                <td class="num-col">
                  @if (row.sampleSize > 0) {
                    {{ row.sampleSize }}
                  } @else {
                    <span class="no-data">No data</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>

    <!-- E17 -->
    <app-variance-root-cause />

    <!-- E18 -->
    <app-customer-concentration />

    <!-- E20 -->
    <app-forecast-widget />
  `,
  styles: [`
    .panel { background: white; border: 0.5px solid var(--rule); border-radius: 12px; padding: 24px; }
    .mt-16 { margin-top: 16px; }

    /* Report header */
    .report-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; gap: 16px; }
    .panel-title { font-family: var(--mono); font-size: 11px; font-weight: 500; text-transform: uppercase;
                   letter-spacing: 0.12em; color: var(--ink-3); margin: 0 0 4px; }
    .report-desc { font-size: 12px; color: var(--ink-3); margin: 0; }
    .report-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .btn-export { font-family: var(--mono); font-size: 11px; color: var(--ink-3); text-decoration: none;
                  border: 0.5px solid var(--rule); border-radius: 5px; padding: 5px 10px; cursor: pointer;
                  white-space: nowrap; }
    .btn-export:hover { color: var(--ink); border-color: var(--ink-3); }
    .filter-select { font-size: 12px; padding: 5px 8px; border: 0.5px solid var(--rule); border-radius: 5px;
                     background: white; color: var(--ink); cursor: pointer; }

    /* Loading / error states */
    .loading-row { font-size: 13px; color: var(--ink-3); padding: 12px 0; }
    .error-row   { font-size: 13px; color: var(--bad); padding: 12px 0; }
    .empty-panel { color: var(--ink-3); font-size: 13px; margin: 0; }

    /* ── Throughput chart ── */
    .chart-area { display: flex; align-items: flex-end; gap: 4px; height: 160px;
                  border-bottom: 1px solid var(--rule); }
    .bar-col { flex: 1; display: flex; flex-direction: column-reverse; min-width: 0; border-radius: 2px 2px 0 0; overflow: hidden; }
    .seg-completed { background: var(--good); }
    .seg-active    { background: var(--warn); }
    .seg-blocked   { background: var(--bad);  }

    .chart-labels { display: flex; gap: 4px; margin-top: 6px; }
    .bar-label { flex: 1; font-family: var(--mono); font-size: 9px; color: var(--ink-3);
                 text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .chart-legend { display: flex; align-items: center; gap: 16px; margin-top: 12px; }
    .legend-swatch { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
    .swatch-completed { background: var(--good); }
    .swatch-active    { background: var(--warn); }
    .swatch-blocked   { background: var(--bad);  }
    .legend-text { font-family: var(--mono); font-size: 11px; color: var(--ink-3); margin-left: 4px; }

    /* ── Calibration table ── */
    .calib-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .calib-table th { font-family: var(--mono); font-size: 10px; text-transform: uppercase;
                      letter-spacing: 0.1em; color: var(--ink-3); font-weight: 500;
                      padding: 0 12px 10px 0; text-align: left; border-bottom: 1px solid var(--rule); }
    .calib-table td { padding: 10px 12px 10px 0; border-bottom: 0.5px solid var(--rule); vertical-align: middle; }
    .calib-table tr:last-child td { border-bottom: none; }
    .num-col { text-align: right; white-space: nowrap; }
    .bar-col-th { width: 120px; }
    .code-cell { font-family: var(--mono); font-size: 11px; color: var(--ink-3); }

    .delta-badge { font-family: var(--mono); font-size: 11px; font-weight: 500;
                   padding: 2px 7px; border-radius: 4px; }
    .delta-over  { background: #fee2e2; color: var(--bad); }
    .delta-under { background: #dcfce7; color: var(--good); }
    .no-data { color: var(--ink-3); opacity: 0.5; }

    /* Calibration inline bars */
    .calib-bar-track { position: relative; height: 6px; background: var(--paper-3); border-radius: 3px;
                       width: 100%; overflow: visible; }
    .calib-bar-estimate { position: absolute; top: 0; left: 0; height: 100%; background: rgba(0,0,0,0.15);
                          border-radius: 3px; }
    .calib-bar-actual { position: absolute; top: -2px; left: 0; height: 10px; border-radius: 3px;
                        opacity: 0.7; }
    .actual-over  { background: var(--bad); }
    .actual-under { background: var(--good); }

    /* ── Phase 2 placeholders ── */
    .placeholder-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    @media (max-width: 800px) { .placeholder-grid { grid-template-columns: 1fr; } }
    .placeholder-card { background: white; border: 0.5px dashed var(--rule); border-radius: 12px;
                        padding: 24px; text-align: center; position: relative; }
    .ph-badge { position: absolute; top: 16px; right: 16px; font-family: var(--mono); font-size: 9px;
                text-transform: uppercase; letter-spacing: 0.1em; background: var(--paper-3);
                color: var(--ink-3); padding: 3px 8px; border-radius: 20px; }
    .ph-icon  { font-size: 28px; margin-bottom: 10px; }
    .ph-title { font-family: var(--display); font-size: 16px; font-weight: 500; color: var(--ink);
                margin: 0 0 8px; letter-spacing: -0.01em; }
    .ph-desc  { font-size: 12px; color: var(--ink-3); margin: 0; line-height: 1.5; }
  `],
})
export class ReportsComponent implements OnInit {
  private svc = inject(DashboardService);

  throughput          = signal<ThroughputWeek[]>([]);
  throughputLoading   = signal(true);
  throughputError     = signal(false);

  calibration         = signal<CalibrationRow[]>([]);
  calibrationLoading  = signal(true);
  calibrationError    = signal(false);

  selectedTemplate    = signal('');

  maxWeekTotal = computed(() =>
    Math.max(...this.throughput().map(w => w.completed + w.inProgress + w.blocked), 1)
  );

  templateCodes = computed(() =>
    [...new Set(this.calibration().map(r => r.templateCode))].sort()
  );

  filteredCalibration = computed(() => {
    const sel = this.selectedTemplate();
    return sel ? this.calibration().filter(r => r.templateCode === sel) : this.calibration();
  });

  readonly placeholders = [
    {
      icon: '📊',
      title: 'Variance Root Cause',
      desc: 'Aggregated variance reasons across operations and technicians.',
    },
    {
      icon: '🏢',
      title: 'Customer Concentration',
      desc: 'Revenue and volume distribution across customer accounts.',
    },
    {
      icon: '🔭',
      title: 'Strategic Forecasting',
      desc: 'Capacity outlook vs pipeline based on scheduled ROs.',
    },
  ];

  downloadThroughputCsv(): void {
    const rows = ['Week Start,Completed,In Progress,Blocked'];
    for (const w of this.throughput())
      rows.push(`${w.weekStart},${w.completed},${w.inProgress},${w.blocked}`);
    this.triggerDownload('throughput-report.csv', rows.join('\r\n'));
  }

  downloadCalibrationCsv(): void {
    const rows = ['Template,Operation,Estimate (h),Avg Actual (h),Avg Delta (h),Sample Size'];
    for (const r of this.filteredCalibration()) {
      const avgActual = r.avgActual !== null ? r.avgActual.toFixed(2) : '';
      const avgDelta  = r.avgDelta  !== null ? r.avgDelta.toFixed(2)  : '';
      rows.push(`${r.templateCode},${r.operationName},${r.templateEstimate.toFixed(2)},${avgActual},${avgDelta},${r.sampleSize}`);
    }
    this.triggerDownload('calibration-report.csv', rows.join('\r\n'));
  }

  private triggerDownload(filename: string, csv: string): void {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  ngOnInit() {
    this.svc.getThroughput().pipe(
      catchError(() => { this.throughputError.set(true); return of([]); }),
    ).subscribe(data => { this.throughput.set(data); this.throughputLoading.set(false); });

    this.svc.getCalibration().pipe(
      catchError(() => { this.calibrationError.set(true); return of([]); }),
    ).subscribe(data => { this.calibration.set(data); this.calibrationLoading.set(false); });
  }

  barPx(count: number): number {
    const max = this.maxWeekTotal();
    return max === 0 ? 0 : Math.round((count / max) * 156);
  }

  weekLabel(dateStr: string): string {
    const parts = dateStr.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${parts[2]} ${months[parts[1] - 1]}`;
  }

  onTemplateFilter(event: Event) {
    this.selectedTemplate.set((event.target as HTMLSelectElement).value);
  }

  private maxEstimate = computed(() =>
    Math.max(...this.filteredCalibration().map(r => r.templateEstimate), 1)
  );

  estimatePct(row: CalibrationRow): number {
    return Math.round((row.templateEstimate / this.maxEstimate()) * 100);
  }

  actualPct(row: CalibrationRow): number {
    if (row.avgActual === null) return 0;
    return Math.min(Math.round((row.avgActual / this.maxEstimate()) * 100), 150);
  }
}
