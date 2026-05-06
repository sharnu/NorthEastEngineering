import {
  Component, OnInit, inject, signal, input, output,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AdminService, CustomerDetail, CustomerRoSummary, VehicleEntry,
} from './admin.service';
import { CustomerFormComponent } from './customer-form.component';

type Tab = 'active' | 'completed' | 'cancelled' | 'vehicles';

@Component({
  selector: 'app-customer-detail',
  standalone: true,
  imports: [CommonModule, DatePipe, CustomerFormComponent],
  template: `
    <!-- Full-screen overlay + right-side panel -->
    <div class="overlay" (click)="closed.emit()">
      <div class="panel" (click)="$event.stopPropagation()">

        @if (!editMode()) {
          <!-- ── View mode ─────────────────────────────────────────── -->
          <div class="panel-header">
            <div>
              <div class="customer-name">{{ detail()?.name }}</div>
              @if (detail()?.code) {
                <span class="customer-code mono">{{ detail()!.code }}</span>
              }
            </div>
            <div class="header-actions">
              <button class="btn-sm" (click)="editMode.set(true)">Edit</button>
              <button class="close-btn" (click)="closed.emit()">✕</button>
            </div>
          </div>

          @if (detail(); as d) {
            <!-- Summary card -->
            <div class="summary-grid">
              @if (d.customerNo) {
                <div class="summary-item">
                  <span class="summary-lbl">Customer No</span>
                  <span class="summary-val mono">{{ d.customerNo }}</span>
                </div>
              }
              @if (d.abn) {
                <div class="summary-item">
                  <span class="summary-lbl">ABN</span>
                  <span class="summary-val mono">{{ d.abn }}</span>
                </div>
              }
              @if (d.contactEmail) {
                <div class="summary-item">
                  <span class="summary-lbl">Email</span>
                  <span class="summary-val">{{ d.contactEmail }}</span>
                </div>
              }
              @if (d.contactPhone) {
                <div class="summary-item">
                  <span class="summary-lbl">Phone</span>
                  <span class="summary-val">{{ d.contactPhone }}</span>
                </div>
              }
              @if (d.emailDl) {
                <div class="summary-item summary-full">
                  <span class="summary-lbl">Email DL</span>
                  <span class="summary-val mono small">{{ d.emailDl }}</span>
                </div>
              }
            </div>

            <!-- RO count badges -->
            <div class="ro-counts">
              <div class="count-badge" [class.tab-selected]="tab() === 'active'" (click)="switchTab('active')">
                <span class="count-num">{{ d.activeRoCount }}</span>
                <span class="count-lbl">Active ROs</span>
              </div>
              <div class="count-badge" [class.tab-selected]="tab() === 'completed'" (click)="switchTab('completed')">
                <span class="count-num">{{ d.completedRoCount }}</span>
                <span class="count-lbl">Completed</span>
              </div>
              <div class="count-badge" [class.tab-selected]="tab() === 'cancelled'" (click)="switchTab('cancelled')">
                <span class="count-num">{{ d.cancelledRoCount }}</span>
                <span class="count-lbl">Cancelled</span>
              </div>
              <div class="count-badge" [class.tab-selected]="tab() === 'vehicles'" (click)="switchTab('vehicles')">
                <span class="count-num">{{ vehicleCount() }}</span>
                <span class="count-lbl">Vehicles</span>
              </div>
            </div>

            <!-- Tab content -->
            @if (tab() !== 'vehicles') {
              <!-- RO history table -->
              @if (rosLoading()) {
                <div class="tab-empty">Loading…</div>
              } @else if (ros().length === 0) {
                <div class="tab-empty">No {{ tab() }} repair orders.</div>
              } @else {
                <table class="ro-table">
                  <thead>
                    <tr>
                      <th>RO #</th>
                      <th>Template</th>
                      <th>Rego</th>
                      <th>Stage</th>
                      <th>Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (ro of ros(); track ro.id) {
                      <tr class="ro-row" (click)="openRo(ro.id)">
                        <td class="mono">{{ ro.roNumber }}</td>
                        <td class="mono small">{{ ro.templateCode }}</td>
                        <td class="mono">{{ ro.rego ?? '—' }}</td>
                        <td>
                          @if (ro.kanbanStage) {
                            <span class="stage-pill">{{ ro.kanbanStage }}</span>
                          } @else {
                            <span class="stage-pill stage-draft">{{ ro.status }}</span>
                          }
                        </td>
                        <td class="small-date">{{ ro.requiredDate ? (ro.requiredDate | date:'dd MMM yy') : '—' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>

                <!-- Pagination for ROs -->
                @if (roTotalPages() > 1) {
                  <div class="tab-pagination">
                    <button [disabled]="roPage() <= 1" (click)="prevRoPage()">‹</button>
                    <span>{{ roPage() }} / {{ roTotalPages() }}</span>
                    <button [disabled]="roPage() >= roTotalPages()" (click)="nextRoPage()">›</button>
                  </div>
                }
              }
            } @else {
              <!-- Vehicles tab -->
              @if (vehiclesLoading()) {
                <div class="tab-empty">Loading…</div>
              } @else if (vehicles().length === 0) {
                <div class="tab-empty">No vehicles on record.</div>
              } @else {
                <table class="ro-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Rego</th>
                      <th>VIN / Chassis</th>
                      <th>Make / Model</th>
                      <th>Last seen</th>
                      <th>ROs</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (v of vehicles(); track $index; let vi = $index) {
                      <tr class="ro-row" (click)="toggleVehicle(vi)">
                        <td class="chevron-cell">{{ expandedVehicle() === vi ? '▾' : '▸' }}</td>
                        <td class="mono">{{ v.rego ?? '—' }}</td>
                        <td class="mono small">{{ v.vin ?? v.chassisNumber ?? '—' }}</td>
                        <td>{{ v.make ?? '' }}{{ v.make && v.model ? ' ' : '' }}{{ v.model ?? '' }}</td>
                        <td class="small-date">{{ v.lastSeenAt ? (v.lastSeenAt | date:'dd MMM yy') : '—' }}</td>
                        <td class="count-cell">{{ v.roCount }}</td>
                      </tr>
                      @if (expandedVehicle() === vi) {
                        <tr class="expand-row">
                          <td colspan="6">
                            <div class="expand-body">
                              @if (vehicleRos(v).length === 0) {
                                <span class="no-ros">No matching ROs loaded — visit Active or Completed tab first.</span>
                              } @else {
                                <div class="ro-chips">
                                  @for (ro of vehicleRos(v); track ro.id) {
                                    <span class="ro-chip" (click)="$event.stopPropagation(); openRo(ro.id)">
                                      {{ ro.roNumber }}
                                    </span>
                                  }
                                </div>
                              }
                            </div>
                          </td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              }
            }
          }
        } @else {
          <!-- ── Edit mode ─────────────────────────────────────────── -->
          <app-customer-form
            [editId]="customerId()"
            (saved)="onFormSaved()"
            (closed)="editMode.set(false)" />
        }
      </div>
    </div>
  `,
  styles: [`
    .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 500;
               display: flex; justify-content: flex-end; }
    .panel   { width: 480px; max-width: 95vw; background: white; height: 100%;
               overflow-y: auto; padding: 24px; box-shadow: -4px 0 20px rgba(0,0,0,0.12); }
    .panel-header { display: flex; justify-content: space-between; align-items: flex-start;
                    margin-bottom: 16px; }
    .customer-name { font-family: var(--display); font-size: 20px; font-weight: 500; }
    .customer-code { font-size: 12px; color: var(--ink-3); }
    .header-actions { display: flex; align-items: center; gap: 8px; }
    .close-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--ink-3); }
    .btn-sm  { font-size: 12px; padding: 4px 12px; border-radius: 5px; border: 1px solid var(--rule);
               background: white; cursor: pointer; }
    .btn-sm:hover { background: var(--paper-2); }
    .mono { font-family: var(--mono); }
    .small { font-size: 11px; }
    .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin-bottom: 20px; }
    .summary-full { grid-column: 1 / -1; }
    .summary-item { display: flex; flex-direction: column; gap: 2px; }
    .summary-lbl  { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
                    color: var(--ink-3); font-family: var(--mono); }
    .summary-val  { font-size: 13px; color: var(--ink); }
    .ro-counts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 20px; }
    .count-badge { text-align: center; border: 1px solid var(--rule); border-radius: 8px;
                   padding: 10px 6px; cursor: pointer; }
    .count-badge:hover { background: var(--paper-2); }
    .count-badge.tab-selected { border-color: var(--ink); background: var(--paper-2); }
    .count-num { display: block; font-family: var(--display); font-size: 22px; font-weight: 500; }
    .count-lbl { display: block; font-size: 10px; font-family: var(--mono); text-transform: uppercase;
                 letter-spacing: 0.06em; color: var(--ink-3); margin-top: 2px; }
    .tab-empty  { padding: 28px; text-align: center; color: var(--ink-3); font-size: 13px; }
    .ro-table {width: 100%; border-collapse: collapse; font-size: 12px; }
    .ro-table th { text-align: left; font-family: var(--mono); font-size: 10px; text-transform: uppercase;
                   letter-spacing: 0.08em; color: var(--ink-3); border-bottom: 1px solid var(--rule);
                   padding: 6px 8px; }
    .ro-table td { padding: 8px 8px; border-bottom: 0.5px solid var(--rule); }
    .stage-pill { font-size: 10px; padding: 2px 7px; border-radius: 10px;
                  background: #e0f2fe; color: #0369a1; font-family: var(--mono); }
    .stage-draft { background: #f1f5f9; color: var(--ink-3); }
    .small-date { font-family: var(--mono); font-size: 11px; color: var(--ink-3); }
    .count-cell { text-align: center; font-family: var(--mono); }
    .tab-pagination { display: flex; align-items: center; gap: 10px; justify-content: center;
                      margin-top: 12px; font-size: 12px; }
    .tab-pagination button { border: 1px solid var(--rule); background: white; border-radius: 5px;
                              padding: 3px 10px; cursor: pointer; }
    .tab-pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
    .ro-row { cursor: pointer; }
    .ro-row:hover td { background: var(--paper-2); }
    .chevron-cell { width: 20px; color: var(--ink-3); font-size: 10px; }
    .expand-row td { padding: 0; }
    .expand-body { padding: 8px 20px 12px; background: var(--paper-2); }
    .no-ros { font-size: 11px; color: var(--ink-3); }
    .ro-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .ro-chip { display: inline-block; background: white; border: 1px solid var(--rule); border-radius: 4px;
               padding: 2px 8px; font-size: 11px; font-family: var(--mono); cursor: pointer; }
    .ro-chip:hover { border-color: var(--ink); }
  `],
})
export class CustomerDetailComponent implements OnInit {
  private svc    = inject(AdminService);
  private router = inject(Router);

  customerId = input.required<string>();
  closed     = output<void>();
  refresh    = output<void>();

  detail          = signal<CustomerDetail | null>(null);
  tab             = signal<Tab>('active');
  editMode        = signal(false);

  ros             = signal<CustomerRoSummary[]>([]);
  rosLoading      = signal(false);
  roPage          = signal(1);
  roTotalPages    = signal(1);

  vehicles        = signal<VehicleEntry[]>([]);
  vehiclesLoading = signal(false);
  vehicleCount    = signal(0);
  expandedVehicle = signal<number | null>(null);

  private roPageSize = 20;
  private allRosCache: CustomerRoSummary[] = [];

  ngOnInit() {
    this.loadDetail();
    this.loadRos();
    this.loadVehicles();
  }

  switchTab(tab: Tab) {
    this.tab.set(tab);
    if (tab === 'vehicles') {
      this.loadVehicles();
    } else {
      this.roPage.set(1);
      this.loadRos();
    }
  }

  prevRoPage() { this.roPage.update(p => p - 1); this.loadRos(); }
  nextRoPage()  { this.roPage.update(p => p + 1); this.loadRos(); }

  toggleVehicle(index: number) {
    this.expandedVehicle.set(this.expandedVehicle() === index ? null : index);
  }

  vehicleRos(v: VehicleEntry): CustomerRoSummary[] {
    if (this.allRosCache.length === 0) return [];
    return this.allRosCache.filter(ro =>
      (v.rego && ro.rego === v.rego) ||
      (v.chassisNumber && ro.chassisNumber === v.chassisNumber));
  }

  openRo(id: string) {
    this.router.navigate(['/sales/ro', id]);
  }

  private loadDetail() {
    this.svc.getCustomer(this.customerId()).subscribe(d => this.detail.set(d));
  }

  private loadRos() {
    if (this.tab() === 'vehicles') return;
    this.rosLoading.set(true);
    this.svc.getCustomerRos(this.customerId(), this.tab(), this.roPage(), this.roPageSize)
      .subscribe({
        next: res => {
          this.ros.set(res.items);
          this.roTotalPages.set(Math.max(1, Math.ceil(res.totalCount / this.roPageSize)));
          this.rosLoading.set(false);
          // Accumulate into cache for vehicle expand lookup
          const ids = new Set(this.allRosCache.map(r => r.id));
          res.items.forEach(r => { if (!ids.has(r.id)) this.allRosCache.push(r); });
        },
        error: () => this.rosLoading.set(false),
      });
  }

  private loadVehicles() {
    this.vehiclesLoading.set(true);
    this.svc.getCustomerVehicles(this.customerId()).subscribe({
      next: v => {
        this.vehicles.set(v);
        this.vehicleCount.set(v.length);
        this.vehiclesLoading.set(false);
      },
      error: () => this.vehiclesLoading.set(false),
    });
  }

  onFormSaved() {
    this.editMode.set(false);
    this.loadDetail();
    this.refresh.emit();
  }
}
