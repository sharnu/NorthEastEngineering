import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { DashboardService, ForecastReport, ForecastRow } from './dashboard.service';

@Component({
  selector: 'app-forecast-widget',
  standalone: true,
  imports: [CommonModule, DatePipe],
  template: `
    <section class="panel mt-16">
      <div class="report-header">
        <div>
          <h2 class="panel-title">Strategic Forecast — ROs at Risk</h2>
          <p class="report-desc">
            Risk score blends capacity, recent variance, blocker frequency,
            and projected days-late. See <code>docs/forecasting-formula.md</code>.
          </p>
        </div>
      </div>

      @if (loading()) {
        <div class="loading-row">Computing risk…</div>
      } @else if (error()) {
        <div class="error-row">Could not load forecast.</div>
      } @else if (atRisk().length === 0) {
        <p class="empty-panel">No at-risk ROs in the next 30 days. Nice.</p>
      } @else {
        <table class="fc-table">
          <thead><tr>
            <th>Risk</th><th>RO</th><th>Customer</th><th>Bottleneck</th>
            <th class="num-col">Late</th><th>Required</th><th>Projected</th><th>Why</th>
          </tr></thead>
          <tbody>
            @for (r of atRisk(); track r.roId) {
              <tr (click)="goToRo(r.roId)" class="fc-row">
                <td>
                  <span class="fc-tier" [class]="'tier-' + r.riskTier.toLowerCase()">
                    {{ r.riskTier }} · {{ r.riskScore }}
                  </span>
                </td>
                <td class="mono">{{ r.roNumber }}</td>
                <td>{{ r.customerName }}</td>
                <td>{{ r.bottleneckStationName ?? '—' }}</td>
                <td class="mono num-col">
                  @if (r.daysAtRisk > 0) { +{{ r.daysAtRisk }}d } @else { — }
                </td>
                <td class="mono">{{ r.requiredDate ? (r.requiredDate | date:'dd MMM') : '—' }}</td>
                <td class="mono">{{ r.projectedCompletionDate | date:'dd MMM' }}</td>
                <td>
                  <button class="fc-why-btn" (click)="$event.stopPropagation(); toggleFactors(r.roId)">
                    {{ openRoId() === r.roId ? 'Hide' : 'Show' }} factors
                  </button>
                </td>
              </tr>
              @if (openRoId() === r.roId) {
                <tr class="fc-factors-row">
                  <td colspan="8">
                    @if (r.factors.length === 0) {
                      <span class="fc-factors-empty">No contributing factors — RO is on track.</span>
                    } @else {
                      <ul class="fc-factors">
                        @for (f of r.factors; track f.key) {
                          <li>
                            <span class="fc-factor-weight">+{{ f.weight }}</span>
                            <span class="fc-factor-key">{{ f.key }}</span>
                            <span class="fc-factor-desc">{{ f.description }}</span>
                          </li>
                        }
                      </ul>
                    }
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      }
    </section>
  `,
  styles: [`
    .panel { background: white; border: 0.5px solid var(--rule); border-radius: 12px; padding: 18px 20px; }
    .mt-16 { margin-top: 16px; }
    .panel-title { font-family: var(--display); font-size: 18px; font-weight: 500; margin: 0 0 4px;
                   color: var(--ink); letter-spacing: -0.01em; }
    .report-desc { font-size: 12px; color: var(--ink-3); margin: 0; }
    .report-desc code { background: var(--paper-3); padding: 1px 4px; border-radius: 3px; font-family: var(--mono); font-size: 11px; }
    .report-header { margin-bottom: 14px; }
    .loading-row, .error-row, .empty-panel { padding: 20px 0; text-align: center; color: var(--ink-3); font-size: 13px; }
    .error-row { color: var(--bad); }

    .fc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .fc-table th { text-align: left; padding: 8px; font-size: 10px; font-weight: 600;
                   color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.05em;
                   border-bottom: 0.5px solid var(--rule-strong); }
    .fc-table td { padding: 10px 8px; border-bottom: 0.5px solid var(--rule); vertical-align: top; }
    .fc-row { cursor: pointer; }
    .fc-row:hover { background: var(--paper-2); }

    .fc-tier { display: inline-block; padding: 3px 8px; border-radius: 4px;
               font-family: var(--mono); font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
               white-space: nowrap; }
    .tier-low  { background: var(--paper-3); color: var(--ink-3); }
    .tier-med  { background: rgba(217,119,6,0.12); color: var(--warn); }
    .tier-high { background: rgba(185,28,28,0.12); color: var(--bad); }

    .num-col { text-align: right; }
    .mono { font-family: var(--mono); font-size: 12px; }

    .fc-why-btn { background: transparent; border: 0.5px solid var(--rule-strong); border-radius: 4px;
                  padding: 3px 8px; font-size: 11px; color: var(--ink-2); cursor: pointer; font-family: var(--sans); }
    .fc-factors-row td { background: var(--paper-2); padding: 12px 16px; }
    .fc-factors { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
    .fc-factors li { display: grid; grid-template-columns: 60px 160px 1fr; gap: 12px; align-items: center;
                     font-size: 12px; }
    .fc-factor-weight { font-family: var(--mono); font-weight: 600; color: var(--bad); }
    .fc-factor-key    { font-family: var(--mono); color: var(--ink-3); font-size: 11px; }
    .fc-factor-desc   { color: var(--ink-2); }
    .fc-factors-empty { font-size: 12px; color: var(--ink-3); font-style: italic; }
  `],
})
export class ForecastWidgetComponent implements OnInit {
  private svc    = inject(DashboardService);
  private router = inject(Router);

  loading = signal(true);
  error   = signal(false);
  report  = signal<ForecastReport | null>(null);
  openRoId = signal<string | null>(null);

  /** Top 5 non-LOW rows. */
  atRisk = computed<ForecastRow[]>(() => {
    const rows = this.report()?.rows ?? [];
    return rows.filter(r => r.riskTier !== 'LOW').slice(0, 5);
  });

  ngOnInit(): void {
    this.svc.getForecast().subscribe({
      next: r => { this.report.set(r); this.loading.set(false); },
      error: () => { this.error.set(true); this.loading.set(false); },
    });
  }

  goToRo(roId: string): void {
    this.router.navigate(['/sales/ro', roId]);
  }

  toggleFactors(roId: string): void {
    this.openRoId.update(curr => curr === roId ? null : roId);
  }
}
