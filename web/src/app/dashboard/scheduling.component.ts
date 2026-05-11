import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ChassisSuggestModalComponent } from './chassis-suggest-modal.component';

interface GatesDto {
  draftingComplete: boolean;
  customerApproved: boolean;
  chassisAllocated: boolean;
  allGreen: boolean;
}

interface SchedulingRow {
  roId: string;
  roNumber: string;
  rego: string | null;
  sourceRoNumber: string | null;
  jobTypeName: string | null;
  bodyType: string | null;
  customerName: string;
  templateCode: string;
  priority: number;
  requiredDate: string | null;
  scheduledStartWeek: string | null;
  totalEstimatedHours: number;
  gates: GatesDto;
}

interface ChassisDto {
  id: string;
  chassisNumber: string;
  description: string;
  chassisClass: string;
}

interface StationCapacity {
  stationId: number;
  stationName: string;
  weeklyHours: number[];
  weeklyCapacityPct: number[];
}

interface CapacityResponse {
  weeks: string[];
  stations: StationCapacity[];
}

@Component({
  selector: 'app-scheduling',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, DecimalPipe, ChassisSuggestModalComponent],
  template: `
    @if (loading()) {
      <div class="sched-loading">Loading scheduling data…</div>
    } @else if (error()) {
      <div class="sched-error">{{ error() }}</div>
    } @else {

    <!-- Backlog table -->
    <div class="sched-section">
      <h2 class="section-title">Scheduling Backlog</h2>
      @if (backlog().length === 0) {
        <p class="empty-msg">No active repair orders.</p>
      } @else {
      <div class="table-wrap">
        <table class="sched-table">
          <thead>
            <tr>
              <th>RO</th>
              <th>Source RO #</th>
              <th>Rego</th>
              <th>Customer</th>
              <th>Job Type</th>
              <th>Body Type</th>
              <th>Template</th>
              <th>Priority</th>
              <th>Required</th>
              <th class="num-col">Est. h</th>
              <th>Draft</th>
              <th>Approval</th>
              <th>Chassis</th>
              <th>Week</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (row of backlog(); track row.roId) {
              <tr [class.all-green]="row.gates.allGreen">
                <td class="mono">{{ row.roNumber }}</td>
                <td class="mono">{{ row.sourceRoNumber ?? '—' }}</td>
                <td class="mono">{{ row.rego ?? '—' }}</td>
                <td>{{ row.customerName }}</td>
                <td>{{ row.jobTypeName ?? '—' }}</td>
                <td>{{ row.bodyType ?? '—' }}</td>
                <td class="mono">{{ row.templateCode }}</td>
                <td><span class="pill" [class]="priorityClass(row.priority)">{{ priorityLabel(row.priority) }}</span></td>
                <td class="mono">{{ row.requiredDate ? (row.requiredDate | date:'dd MMM yy') : '—' }}</td>
                <td class="mono num-col">{{ row.totalEstimatedHours | number:'1.1-1' }}</td>

                <!-- Drafting gate (read-only) -->
                <td class="gate-cell">
                  <button class="gate-pill" [class.gate-met]="row.gates.draftingComplete"
                    title="Update drafting status via the RO detail page">
                    {{ row.gates.draftingComplete ? '✓' : '✗' }} Draft
                  </button>
                </td>

                <!-- Customer approval gate -->
                <td class="gate-cell">
                  <button class="gate-pill" [class.gate-met]="row.gates.customerApproved"
                    (click)="!row.gates.customerApproved && togglePopover($event, row.roId, 'approve')">
                    {{ row.gates.customerApproved ? '✓' : '✗' }} Approval
                  </button>
                </td>

                <!-- Chassis gate -->
                <td class="gate-cell">
                  <button class="gate-pill" [class.gate-met]="row.gates.chassisAllocated"
                    (click)="!row.gates.chassisAllocated && togglePopover($event, row.roId, 'chassis')">
                    {{ row.gates.chassisAllocated ? '✓' : '✗' }} Chassis
                  </button>
                  @if (!row.gates.chassisAllocated) {
                    <button class="btn-suggest" (click)="openSuggest(row.roId)">Suggest →</button>
                  }
                </td>

                <!-- Scheduled week -->
                <td class="mono">{{ row.scheduledStartWeek ? (row.scheduledStartWeek | date:'dd MMM') : '—' }}</td>

                <!-- Schedule action -->
                <td style="white-space:nowrap">
                  <button class="btn-schedule" [disabled]="!row.gates.allGreen"
                    (click)="row.gates.allGreen && openSchedule($event, row.roId)">
                    {{ row.scheduledStartWeek ? 'Reschedule' : 'Schedule' }}
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      }
    </div>

    <!-- Capacity heatmap -->
    @if (heatmap()) {
    <div class="sched-section heatmap-section">
      <h2 class="section-title">4-Week Station Capacity</h2>
      <div class="table-wrap">
        <table class="heatmap-table">
          <thead>
            <tr>
              <th class="station-th">Station</th>
              @for (w of heatmap()!.weeks; track w) {
                <th>{{ w | date:'dd MMM' }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (s of heatmap()!.stations; track s.stationId) {
              <tr>
                <td class="station-label">{{ s.stationName }}</td>
                @for (pct of s.weeklyCapacityPct; track $index) {
                  <td class="heat-cell" [class]="heatClass(pct)"
                    [title]="s.weeklyHours[$index] + 'h planned (' + pct + '% capacity)'">
                    {{ s.weeklyHours[$index] | number:'1.0-1' }}h
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="heatmap-legend">
        <span class="legend-dot heat-green"></span> ≤70%
        <span class="legend-dot heat-amber"></span> 70–95%
        <span class="legend-dot heat-red"></span> &gt;95%
        · 40h capacity per station/week
      </p>
    </div>
    }

    }

    <!-- ── Fixed-position overlays (outside scroll/overflow context) ── -->

    @if (activePopover()?.type === 'approve' && popoverAnchor()) {
      <div class="gate-popover overlay-popover"
           [style.top.px]="popoverAnchor()!.bottom + 6"
           [style.left.px]="popoverAnchor()!.left">
        <p class="popover-label">Mark drawing approved</p>
        <input class="popover-input" [(ngModel)]="approveSignedBy"
          placeholder="Signed by (name)" autofocus />
        <input class="popover-input" [(ngModel)]="approveNotes"
          placeholder="Notes (optional)" />
        <div class="popover-actions">
          <button class="btn-primary-sm" (click)="approveRo(activePopover()!.roId)"
            [disabled]="!approveSignedBy.trim()">Mark approved</button>
          <button class="btn-ghost-sm" (click)="closePopover()">Cancel</button>
        </div>
      </div>
    }

    @if (activePopover()?.type === 'chassis' && popoverAnchor()) {
      <div class="gate-popover overlay-popover"
           [style.top.px]="popoverAnchor()!.bottom + 6"
           [style.left.px]="popoverAnchor()!.left">
        <p class="popover-label">Allocate chassis</p>
        @if (availableChassis().length === 0) {
          <p class="popover-empty">No chassis available.</p>
        }
        @for (ch of availableChassis(); track ch.id) {
          <div class="chassis-option" (click)="allocateChassis(ch.id, activePopover()!.roId)">
            <span class="chassis-num">{{ ch.chassisNumber }}</span>
            <span class="chassis-desc">{{ ch.description }} · Class {{ ch.chassisClass }}</span>
          </div>
        }
        <div class="popover-actions">
          <button class="btn-ghost-sm" (click)="closePopover()">Cancel</button>
        </div>
      </div>
    }

    <!-- Chassis suggestion modal (E28-S2) -->
    <app-chassis-suggest-modal
      [open]="!!suggestRoId()"
      [roId]="suggestRoId()"
      (closed)="suggestRoId.set(null)"
      (allocated)="onSuggestAllocated($event)">
    </app-chassis-suggest-modal>

    @if (suggestToast()) {
      <div class="suggest-toast">{{ suggestToast() }}</div>
    }

    @if (schedulePopoverRoId() && scheduleAnchor()) {
      <div class="gate-popover overlay-popover cal-popover"
           [style.top]="calPos().top"
           [style.left]="calPos().left"
           [style.right]="calPos().right">

        <!-- Month nav -->
        <div class="cal-nav">
          <button class="cal-nav-btn" [disabled]="!canGoPrev()" (click)="prevMonth()">‹</button>
          <span class="cal-month-label">{{ calViewDate() | date:'MMMM yyyy' }}</span>
          <button class="cal-nav-btn" (click)="nextMonth()">›</button>
        </div>

        <!-- Day-of-week headers (Mon → Sun) -->
        <div class="cal-grid">
          @for (h of dayHeaders; track h) {
            <div class="cal-dh">{{ h }}</div>
          }

          <!-- Leading blank cells so the 1st lands on the right column -->
          @for (b of calLeadBlanks(); track b) {
            <div class="cal-day cal-blank"></div>
          }

          @for (day of calDays(); track day.iso) {
            <div class="cal-day"
                 [class.cal-monday]="day.isMonday"
                 [class.cal-disabled]="day.disabled"
                 [class.cal-selected]="day.iso === currentScheduledWeek()"
                 [class.cal-today]="day.isToday"
                 (click)="!day.disabled && day.isMonday && scheduleRo(schedulePopoverRoId()!, day.iso)">
              {{ day.num }}
            </div>
          }
        </div>

        <p class="cal-hint">Only Mondays are selectable</p>

        @if (scheduleError()) {
          <p class="schedule-error">{{ scheduleError() }}</p>
        }
        <div class="popover-actions">
          <button class="btn-ghost-sm" (click)="closeSchedulePopover()">Cancel</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .sched-loading, .sched-error { padding: 40px 0; color: var(--ink-3); font-size: 14px; }
    .sched-error { color: var(--bad); }
    .schedule-error { color: var(--bad); font-size: 12px; margin: 6px 0 2px; }
    .empty-msg { color: var(--ink-3); font-size: 13px; padding: 16px 0; }

    .sched-section { margin-bottom: 32px; }
    .heatmap-section { margin-top: 8px; }
    .section-title { font-family: var(--mono); font-size: 11px; font-weight: 500; text-transform: uppercase;
                     letter-spacing: 0.12em; color: var(--ink-3); margin: 0 0 14px; }

    .table-wrap { overflow-x: auto; border: 0.5px solid var(--rule); border-radius: 10px;
                  background: white; }

    /* Backlog table */
    .sched-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .sched-table th { font-family: var(--mono); font-size: 10px; text-transform: uppercase;
                      letter-spacing: 0.08em; color: var(--ink-3);
                      border-bottom: 0.5px solid var(--rule); padding: 10px 12px;
                      text-align: left; white-space: nowrap; background: white; }
    .sched-table td { padding: 10px 12px; border-bottom: 0.5px solid var(--rule); color: var(--ink); }
    .sched-table tr:last-child td { border-bottom: none; }
    .sched-table tr.all-green td:first-child { border-left: 3px solid var(--good); }
    .mono { font-family: var(--mono); font-size: 12px; }
    .num-col { text-align: right; }

    /* Pill */
    .pill { padding: 2px 8px; border-radius: 3px; font-family: var(--mono); font-size: 10px; font-weight: 500; }
    .pri-urgent { background: #fee2e2; color: var(--bad); }
    .pri-high   { background: #fef9c3; color: var(--warn); }
    .pri-normal { background: #dbeafe; color: var(--info); }
    .pri-low    { background: var(--paper-3); color: var(--ink-3); }

    /* Suggest button */
    .btn-suggest { margin-left: 4px; padding: 3px 8px; border-radius: 4px;
                   border: .5px solid var(--accent); background: none; color: var(--accent);
                   font-size: 11px; cursor: pointer; font-family: var(--mono); white-space: nowrap; }
    .btn-suggest:hover { background: #e0e7ff; }

    /* Allocation success toast */
    .suggest-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                     background: #0a0e0f; color: white; padding: 10px 20px; border-radius: 8px;
                     font-size: 13px; z-index: 20000; box-shadow: 0 4px 16px rgba(10,14,15,.3);
                     pointer-events: none; }

    /* Gate pills */
    .gate-cell { white-space: nowrap; }
    .gate-pill { background: none; border: 0.5px solid var(--rule); border-radius: 4px;
                 padding: 3px 8px; font-size: 11px; cursor: pointer; color: var(--ink-3);
                 font-family: var(--mono); white-space: nowrap; }
    .gate-pill.gate-met { border-color: var(--good); color: var(--good); background: #dcfce7; cursor: default; }

    /* Fixed-position overlay popovers — escape table overflow clipping */
    .overlay-popover { position: fixed; z-index: 9999; }

    /* Popover shell (shared by overlay and heatmap future use) */
    .gate-popover { background: white; border: 0.5px solid var(--rule); border-radius: 10px;
                    padding: 14px; min-width: 240px;
                    box-shadow: 0 4px 20px rgba(10,14,15,0.14); }
    .popover-label { font-family: var(--mono); font-size: 10px; text-transform: uppercase;
                     letter-spacing: 0.1em; color: var(--ink-3); margin: 0 0 10px; }
    .popover-empty { font-size: 12px; color: var(--ink-3); margin: 4px 0 10px; }
    .popover-input { display: block; width: 100%; box-sizing: border-box; padding: 6px 10px;
                     border: 0.5px solid var(--rule); border-radius: 6px; font-size: 13px;
                     font-family: inherit; margin-bottom: 8px; outline: none; }
    .popover-input:focus { border-color: var(--accent); }
    .popover-actions { display: flex; gap: 8px; margin-top: 4px; }

    /* Chassis options */
    .chassis-option { padding: 8px 0; cursor: pointer; border-bottom: 0.5px solid var(--rule); }
    .chassis-option:last-of-type { border-bottom: none; }
    .chassis-option:hover { background: var(--paper); margin: 0 -14px; padding: 8px 14px; }
    .chassis-num { display: block; font-family: var(--mono); font-size: 12px; font-weight: 500; color: var(--ink); }
    .chassis-desc { display: block; font-size: 11px; color: var(--ink-3); margin-top: 1px; }

    /* Buttons */
    .btn-primary-sm { padding: 5px 12px; border-radius: 6px; border: none; font-size: 12px;
                      font-weight: 500; cursor: pointer; background: var(--accent); color: white; }
    .btn-primary-sm:disabled { background: var(--paper-3); color: var(--ink-3); cursor: not-allowed; }
    .btn-ghost-sm { padding: 5px 12px; border-radius: 6px; border: 0.5px solid var(--rule);
                    font-size: 12px; cursor: pointer; background: none; color: var(--ink-3); }
    .btn-ghost-sm:hover { background: var(--paper); }

    /* Schedule button */
    .btn-schedule { padding: 5px 14px; border-radius: 6px; border: none; font-size: 12px;
                    font-weight: 500; cursor: pointer; background: var(--accent); color: white; white-space: nowrap; }
    .btn-schedule:disabled { background: var(--paper-3); color: var(--ink-3); cursor: not-allowed; }

    /* Calendar picker — gate-popover supplies background/border/shadow/padding */
    .cal-popover { width: 290px; max-width: calc(100vw - 24px); box-sizing: border-box; }
    .cal-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .cal-month-label { font-size: 13px; font-weight: 600; color: var(--ink); }
    .cal-nav-btn { background: none; border: 0.5px solid var(--rule); border-radius: 4px;
                   width: 24px; height: 24px; cursor: pointer; font-size: 14px; line-height: 1;
                   color: var(--ink-3); display: flex; align-items: center; justify-content: center; }
    .cal-nav-btn:disabled { opacity: 0.3; cursor: not-allowed; }
    .cal-nav-btn:not(:disabled):hover { background: var(--paper); color: var(--ink); }
    .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 6px; }
    .cal-dh { text-align: center; font-size: 10px; font-family: var(--mono); color: var(--ink-3);
              font-weight: 600; padding: 4px 0 6px; text-transform: uppercase; letter-spacing: 0.05em; }
    .cal-day { height: 30px; display: flex; align-items: center; justify-content: center;
               font-size: 12px; border-radius: 4px; color: var(--ink-3); cursor: default; }
    .cal-blank { }
    .cal-disabled { opacity: 0.3; }
    .cal-monday:not(.cal-disabled) { color: var(--ink); font-weight: 500; cursor: pointer; }
    .cal-monday:not(.cal-disabled):hover { background: #e0e7ff; color: #3730a3; }
    .cal-selected { background: #3730a3 !important; color: #fff !important; font-weight: 600; }
    .cal-today.cal-monday:not(.cal-selected) { outline: 1.5px solid var(--accent); }
    .cal-hint { font-size: 10px; color: var(--ink-3); margin: 0 0 6px; font-family: var(--mono);
                text-transform: uppercase; letter-spacing: 0.05em; }

    /* Heatmap */
    .heatmap-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .heatmap-table th { font-family: var(--mono); font-size: 10px; color: var(--ink-3);
                        padding: 8px 14px; border-bottom: 0.5px solid var(--rule);
                        text-align: center; white-space: nowrap; }
    .station-th { text-align: left; }
    .station-label { font-weight: 500; color: var(--ink); padding: 10px 14px;
                     border-bottom: 0.5px solid var(--rule); white-space: nowrap; }
    .heat-cell { text-align: center; padding: 10px 14px; border-bottom: 0.5px solid var(--rule);
                 font-family: var(--mono); font-size: 12px; cursor: default; }
    .heatmap-table tr:last-child td { border-bottom: none; }
    .heat-green { background: #dcfce7; color: #166534; }
    .heat-amber { background: #fef9c3; color: var(--warn); }
    .heat-red   { background: #fee2e2; color: var(--bad); }
    .heat-zero  { background: transparent; color: var(--ink-3); }

    .heatmap-legend { font-family: var(--mono); font-size: 11px; color: var(--ink-3);
                      margin: 10px 0 0; display: flex; align-items: center; gap: 8px; }
    .legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
  `],
})
export class SchedulingComponent implements OnInit {
  private http = inject(HttpClient);

  backlog = signal<SchedulingRow[]>([]);
  heatmap = signal<CapacityResponse | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  activePopover = signal<{ roId: string; type: 'approve' | 'chassis' } | null>(null);
  popoverAnchor = signal<DOMRect | null>(null);

  availableChassis = signal<ChassisDto[]>([]);
  approveSignedBy = '';
  approveNotes = '';

  schedulePopoverRoId = signal<string | null>(null);
  scheduleAnchor      = signal<DOMRect | null>(null);
  scheduleError       = signal<string | null>(null);

  suggestRoId  = signal<string | null>(null);
  suggestToast = signal<string | null>(null);
  private toastTimer: any;

  // Flip left→right when popover would overflow the viewport right edge
  calPos = computed(() => {
    const r = this.scheduleAnchor();
    if (!r) return {};
    const popoverW = 290;
    const vw = window.innerWidth;
    const top = r.bottom + 6;
    return r.left + popoverW + 8 > vw
      ? { top: `${top}px`, right: `${vw - r.right}px`, left: 'auto' }
      : { top: `${top}px`, left: `${r.left}px`,         right: 'auto' };
  });

  // Calendar state
  calViewDate = signal<Date>(this.firstOfCurrentMonth());
  readonly dayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Currently scheduled week for the RO whose schedule popover is open
  currentScheduledWeek = computed(() => {
    const roId = this.schedulePopoverRoId();
    if (!roId) return null;
    return this.backlog().find(r => r.roId === roId)?.scheduledStartWeek ?? null;
  });

  canGoPrev = computed(() => {
    const v = this.calViewDate();
    const now = this.firstOfCurrentMonth();
    return v.getFullYear() > now.getFullYear() || v.getMonth() > now.getMonth();
  });

  calLeadBlanks = computed(() => {
    const d = new Date(this.calViewDate());
    d.setDate(1);
    // getDay(): 0=Sun,1=Mon,...,6=Sat → convert to Mon-based index (Mon=0)
    const dow = (d.getDay() + 6) % 7;
    return Array.from({ length: dow }, (_, i) => i);
  });

  calDays = computed(() => {
    const view  = this.calViewDate();
    const year  = view.getFullYear();
    const month = view.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayIso = this.toLocalIso(new Date());
    // Earliest selectable Monday: next Monday from today
    const earliest = this.nextMonday(new Date());
    const earliestIso = this.toLocalIso(earliest);

    return Array.from({ length: daysInMonth }, (_, i) => {
      const date = new Date(year, month, i + 1);
      const iso  = this.toLocalIso(date);
      const dow  = date.getDay(); // 0=Sun, 1=Mon
      const isMonday = dow === 1;
      const disabled = iso < earliestIso;
      return { num: i + 1, iso, isMonday, disabled, isToday: iso === todayIso };
    });
  });

  ngOnInit() {
    this.loadAll();
  }

  private loadAll() {
    this.loading.set(true);
    this.error.set(null);

    this.http.get<SchedulingRow[]>('/api/scheduling/backlog').subscribe({
      next: rows => {
        this.backlog.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load scheduling backlog.');
        this.loading.set(false);
      },
    });

    this.http.get<CapacityResponse>('/api/scheduling/capacity?weeks=4').subscribe({
      next: data => this.heatmap.set(data),
      error: () => {},
    });
  }

  private refreshBacklog() {
    this.http.get<SchedulingRow[]>('/api/scheduling/backlog').subscribe({
      next: rows => this.backlog.set(rows),
    });
  }

  private refreshHeatmap() {
    this.http.get<CapacityResponse>('/api/scheduling/capacity?weeks=4').subscribe({
      next: data => this.heatmap.set(data),
    });
  }

  togglePopover(event: MouseEvent, roId: string, type: 'approve' | 'chassis') {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const cur = this.activePopover();

    if (cur?.roId === roId && cur.type === type) {
      this.closePopover();
      return;
    }

    this.popoverAnchor.set(rect);
    this.activePopover.set({ roId, type });
    this.schedulePopoverRoId.set(null);
    this.scheduleAnchor.set(null);

    if (type === 'chassis') {
      this.loadChassis();
    } else {
      this.approveSignedBy = '';
      this.approveNotes = '';
    }
  }

  closePopover() {
    this.activePopover.set(null);
    this.popoverAnchor.set(null);
  }

  private loadChassis() {
    this.http.get<ChassisDto[]>('/api/scheduling/chassis?available=true').subscribe({
      next: list => this.availableChassis.set(list),
    });
  }

  approveRo(roId: string) {
    this.http.post(`/api/scheduling/ros/${roId}/approve`, {
      signedByName: this.approveSignedBy,
      notes: this.approveNotes || null,
    }).subscribe({
      next: () => {
        this.closePopover();
        this.refreshBacklog();
      },
    });
  }

  allocateChassis(chassisId: string, roId: string) {
    this.http.post(`/api/scheduling/chassis/${chassisId}/allocate`, { roId }).subscribe({
      next: () => {
        this.closePopover();
        this.refreshBacklog();
      },
    });
  }

  openSchedule(event: MouseEvent, roId: string) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();

    if (this.schedulePopoverRoId() === roId) {
      this.closeSchedulePopover();
      return;
    }

    this.scheduleAnchor.set(rect);
    this.schedulePopoverRoId.set(roId);
    this.scheduleError.set(null);
    // Jump calendar to the month containing the already-scheduled week (if any),
    // otherwise show the current month.
    const existing = this.backlog().find(r => r.roId === roId)?.scheduledStartWeek;
    const jumpTo = existing ? new Date(existing + 'T00:00:00') : new Date();
    this.calViewDate.set(new Date(jumpTo.getFullYear(), jumpTo.getMonth(), 1));
    this.closePopover();
  }

  closeSchedulePopover() {
    this.schedulePopoverRoId.set(null);
    this.scheduleAnchor.set(null);
    this.scheduleError.set(null);
  }

  prevMonth() {
    const d = new Date(this.calViewDate());
    d.setMonth(d.getMonth() - 1);
    this.calViewDate.set(d);
  }

  nextMonth() {
    const d = new Date(this.calViewDate());
    d.setMonth(d.getMonth() + 1);
    this.calViewDate.set(d);
  }

  scheduleRo(roId: string, week: string) {
    this.scheduleError.set(null);
    this.http.put(`/api/scheduling/ros/${roId}/schedule`, { startWeek: week }).subscribe({
      next: () => {
        this.closeSchedulePopover();
        this.refreshBacklog();
        this.refreshHeatmap();
      },
      error: (err) => {
        const msg = err?.error?.message ?? 'Scheduling failed. Please try again.';
        this.scheduleError.set(msg);
      },
    });
  }

  openSuggest(roId: string) {
    this.closePopover();
    this.closeSchedulePopover();
    this.suggestRoId.set(roId);
  }

  onSuggestAllocated(e: { chassisId: string; chassisNumber: string; roId: string }) {
    // Patch the row in-place — no full backlog refetch needed
    this.backlog.update(rows => rows.map(r => r.roId !== e.roId ? r : {
      ...r,
      gates: {
        ...r.gates,
        chassisAllocated: true,
        allGreen: r.gates.draftingComplete && r.gates.customerApproved,
      },
    }));
    this.suggestRoId.set(null);
    clearTimeout(this.toastTimer);
    this.suggestToast.set(`Chassis ${e.chassisNumber} allocated`);
    this.toastTimer = setTimeout(() => this.suggestToast.set(null), 4000);
  }

  heatClass(pct: number) {
    if (pct === 0) return 'heat-zero';
    if (pct <= 70) return 'heat-green';
    if (pct <= 95) return 'heat-amber';
    return 'heat-red';
  }

  priorityClass(p: number) {
    return p === 1 ? 'pill pri-urgent'
         : p === 2 ? 'pill pri-high'
         : p <= 3  ? 'pill pri-normal'
         :           'pill pri-low';
  }

  priorityLabel(p: number) {
    return p === 1 ? 'Urgent' : p === 2 ? 'High' : p === 3 ? 'Normal' : 'Low';
  }

  private toLocalIso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private firstOfCurrentMonth(): Date {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  }

  private nextMonday(from: Date): Date {
    const d = new Date(from);
    const day = d.getDay(); // 0=Sun, 1=Mon
    const daysAhead = day === 1 ? 0 : (8 - day) % 7;
    d.setDate(d.getDate() + daysAhead);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
