import {
  Component, Input, Output, EventEmitter, OnChanges, OnDestroy, SimpleChanges,
  inject, signal, computed, HostListener,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { KanbanTaskDto, KanbanService, StationTechnicianDto } from './kanban.service';
import { AuthService } from '../core/auth.service';

interface RoDetail {
  id: string;
  roNumber: string;
  status: string;
  rego: string | null;
  make: string | null;
  model: string | null;
  requiredDate: string | null;
  totalEstimatedHours: number;
  customer: { name: string };
  notes: string | null;
}

@Component({
  selector: 'app-task-drawer',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule],
  template: `
    @if (isOpen && task) {
      <!-- Backdrop -->
      <div class="drawer-backdrop" (click)="closed.emit()"></div>

      <!-- Panel -->
      <div class="drawer-panel">
        <div class="drawer-header">
          <div>
            <h2 class="drawer-title">{{ task.operationName }}</h2>
            <span class="drawer-sub">{{ task.roNumber }} · {{ task.customerName }}</span>
          </div>
          <button class="drawer-close" (click)="closed.emit()">✕</button>
        </div>

        <div class="drawer-body">

          <!-- Task details -->
          <section class="drawer-section">
            <h3 class="section-title">Task</h3>
            <dl class="detail-grid">
              <dt>Status</dt>
              <dd><span class="pill" [class]="statusClass(task.status)">{{ task.status }}</span></dd>
              <dt>Priority</dt>
              <dd>{{ priorityLabel(task.priority) }}</dd>
              <dt>Estimated</dt>
              <dd>{{ task.estimatedHours }}h</dd>
              <dt>Actual</dt>
              <dd>{{ task.actualHours }}h</dd>
              <dt>Sequence</dt>
              <dd>#{{ task.sequence }}</dd>
              <dt>Station</dt>
              <dd>{{ task.stationName }}</dd>
              <dt>Job code</dt>
              <dd class="mono">{{ task.jobCodeLine }}</dd>
            </dl>
          </section>

          <!-- RO context -->
          @if (roDetail()) {
            <section class="drawer-section">
              <h3 class="section-title">Repair Order</h3>
              <dl class="detail-grid">
                <dt>Customer</dt>
                <dd>{{ roDetail()!.customer.name }}</dd>
                <dt>Rego</dt>
                <dd>{{ roDetail()!.rego ?? '—' }}</dd>
                <dt>Make / Model</dt>
                <dd>{{ roDetail()!.make ?? '—' }} {{ roDetail()!.model ?? '' }}</dd>
                <dt>Required by</dt>
                <dd>{{ roDetail()!.requiredDate ? (roDetail()!.requiredDate | date:'dd MMM yyyy') : '—' }}</dd>
                <dt>RO status</dt>
                <dd>{{ roDetail()!.status }}</dd>
              </dl>
            </section>
          }

          <!-- Notes -->
          @if (task.notes || (roDetail() && roDetail()!.notes)) {
            <section class="drawer-section">
              <h3 class="section-title">Notes</h3>
              @if (task.notes) {
                <p class="notes-text"><strong>Task:</strong> {{ task.notes }}</p>
              }
              @if (roDetail()?.notes) {
                <p class="notes-text"><strong>RO:</strong> {{ roDetail()!.notes }}</p>
              }
            </section>
          }

          <!-- Assign technician -->
          <section class="drawer-section">
            <h3 class="section-title">Assign Technician</h3>
            @if (loadingTechs()) {
              <p class="muted">Loading technicians…</p>
            } @else if (technicians().length === 0) {
              <p class="muted">No technicians rostered to {{ task.stationName }}.</p>
            } @else {
              <select class="tech-select" [(ngModel)]="selectedUserId" (change)="assignTechnician()">
                <option value="">Unassign</option>
                @for (t of technicians(); track t.userId) {
                  <option [value]="t.userId">
                    {{ t.fullName }}{{ t.isPrimary ? ' ★' : '' }}
                  </option>
                }
              </select>
              @if (assignSuccess()) {
                <p class="assign-success">{{ assignSuccess() }}</p>
              }
              @if (assignError()) {
                <p class="assign-error">{{ assignError() }}</p>
              }
            }
          </section>

          <!-- QC quick-launch (station 90 only) -->
          @if (canStartQc()) {
            <section class="drawer-section">
              <h3 class="section-title">Quality Control</h3>
              <button class="btn-qc" (click)="startQc()">Start QC &rarr;</button>
            </section>
          }

        </div>
      </div>
    }
  `,
  styles: [`
    .drawer-backdrop {
      position: fixed; inset: 0; background: rgba(10,14,15,0.4); z-index: 99;
    }
    .drawer-panel {
      position: fixed; right: 0; top: 0; height: 100vh; width: 390px;
      background: white; z-index: 100; box-shadow: -4px 0 24px rgba(10,14,15,0.12);
      display: flex; flex-direction: column; animation: slideIn 0.25s ease;
    }
    @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }

    .drawer-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      padding: 20px 20px 16px; border-bottom: 0.5px solid var(--rule);
    }
    .drawer-title { font-size: 16px; font-weight: 600; color: var(--ink); margin: 0 0 4px; }
    .drawer-sub   { font-family: var(--mono); font-size: 11px; color: var(--ink-3); }
    .drawer-close {
      background: none; border: none; font-size: 16px; cursor: pointer;
      color: var(--ink-3); padding: 4px 6px; line-height: 1;
    }
    .drawer-close:hover { color: var(--ink); }

    .drawer-body { flex: 1; overflow-y: auto; padding: 0 20px 24px; }

    .drawer-section { margin-top: 20px; }
    .section-title  { font-family: var(--mono); font-size: 10px; font-weight: 500; text-transform: uppercase;
                      letter-spacing: 0.12em; color: var(--ink-3); margin: 0 0 10px; }

    .detail-grid { display: grid; grid-template-columns: 120px 1fr; gap: 6px 12px;
                   margin: 0; font-size: 13px; }
    .detail-grid dt { color: var(--ink-3); }
    .detail-grid dd { margin: 0; color: var(--ink); font-weight: 500; }
    .mono { font-family: var(--mono); font-size: 12px; }

    .pill { font-size: 10px; font-weight: 500; padding: 2px 8px; border-radius: 3px; }
    .pill-pending    { background: var(--paper-3); color: var(--ink-3); }
    .pill-assigned   { background: #e0e7ff; color: #3730a3; }
    .pill-inprogress { background: #dbeafe; color: var(--info); }
    .pill-paused     { background: #fef9c3; color: var(--warn); }
    .pill-blocked    { background: #fee2e2; color: var(--bad); }

    .tech-select { width: 100%; padding: 8px 10px; border: 0.5px solid var(--rule-strong);
                   border-radius: 6px; font-size: 13px; background: var(--paper); color: var(--ink); }
    .assign-success { font-size: 12px; color: var(--good); margin-top: 6px; }
    .assign-error   { font-size: 12px; color: var(--bad); margin-top: 6px; }
    .muted { font-size: 13px; color: var(--ink-3); }

    .btn-qc {
      display: inline-block;
      width: 100%;
      padding: 12px 16px;
      background: #7c3aed;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-qc:hover { background: #6d28d9; }
  `],
})
export class TaskDrawerComponent implements OnChanges, OnDestroy {
  @Input() task: KanbanTaskDto | null = null;
  @Input() isOpen = false;
  @Output() closed = new EventEmitter<void>();
  @Output() taskUpdated = new EventEmitter<Partial<KanbanTaskDto>>();

  private http    = inject(HttpClient);
  private svc     = inject(KanbanService);
  private router  = inject(Router);
  private auth    = inject(AuthService);

  roDetail      = signal<RoDetail | null>(null);
  technicians   = signal<StationTechnicianDto[]>([]);
  loadingTechs  = signal(false);
  selectedUserId = '';
  assignSuccess = signal<string | null>(null);
  assignError   = signal<string | null>(null);

  // Show "Start QC →" when the task is at the QC station and the RO isn't terminal.
  isQcTask = computed(() => {
    const t = this.task;
    if (!t) return false;
    return t.stationId === 90 && t.status !== 'COMPLETED' && t.status !== 'CANCELLED';
  });

  canStartQc = computed(() => {
    if (!this.isQcTask()) return false;
    const roles = this.auth.user()?.roles ?? [];
    return roles.includes('QC') || roles.includes('SUPERVISOR') || roles.includes('ADMIN') || roles.includes('STATION_OWNER');
  });

  startQc() {
    if (!this.task) return;
    const roId = this.task.roId;
    this.closed.emit();
    this.router.navigate(['/tech/qc', roId]);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['isOpen']) {
      document.body.style.overflow = this.isOpen ? 'hidden' : '';
    }
    if (changes['task'] && this.task) {
      this.loadRoDetail(this.task.roId);
      this.loadTechnicians(this.task.stationId ?? 0);
      this.selectedUserId = this.task.assignedToUserId ?? '';
      this.assignSuccess.set(null);
      this.assignError.set(null);
    }
  }

  ngOnDestroy() {
    document.body.style.overflow = '';
  }

  @HostListener('document:keydown.escape')
  onEscape() { this.closed.emit(); }

  private loadRoDetail(roId: string) {
    this.roDetail.set(null);
    this.http.get<RoDetail>(`/api/repair-orders/${roId}`).subscribe({
      next: ro => this.roDetail.set(ro),
    });
  }

  private loadTechnicians(stationId: number) {
    this.loadingTechs.set(true);
    this.svc.getTechnicians(stationId).subscribe({
      next: techs => { this.technicians.set(techs); this.loadingTechs.set(false); },
      error: () => this.loadingTechs.set(false),
    });
  }

  assignTechnician() {
    if (!this.task) return;
    this.assignSuccess.set(null);
    this.assignError.set(null);

    const userId = this.selectedUserId || null;
    this.svc.assignTask(this.task.id, userId).subscribe({
      next: () => {
        const name = this.technicians().find(t => t.userId === userId)?.fullName ?? null;
        this.assignSuccess.set(userId ? `Assigned to ${name}` : 'Unassigned');
        this.taskUpdated.emit({
          assignedToUserId: userId,
          assignedToName: name,
          status: userId ? 'ASSIGNED' : 'PENDING',
        });
        setTimeout(() => this.assignSuccess.set(null), 3000);
      },
      error: (err) => {
        this.assignError.set(err.error?.message ?? 'Assignment failed.');
      },
    });
  }

  statusClass(s: string) {
    switch (s) {
      case 'PENDING':     return 'pill pill-pending';
      case 'ASSIGNED':    return 'pill pill-assigned';
      case 'IN_PROGRESS': return 'pill pill-inprogress';
      case 'PAUSED':      return 'pill pill-paused';
      case 'BLOCKED':     return 'pill pill-blocked';
      default:            return 'pill pill-pending';
    }
  }

  priorityLabel(p: number) {
    return p === 1 ? 'Urgent' : p === 2 ? 'High' : p === 3 ? 'Normal' : 'Low';
  }
}
