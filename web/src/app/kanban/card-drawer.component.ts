import {
  Component, HostListener, computed, effect, inject, input, output, signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { KanbanCardDto, KanbanCardTaskDto, KanbanService, StationTechnicianDto } from './kanban.service';
import { SafeResourcePipe } from '../core/safe-resource.pipe';
import { bodyTypeShortCode } from './body-type.util';
import { AuthService } from '../core/auth.service';
import { FlowRibbonComponent } from './flow-ribbon.component';

@Component({
  selector: 'app-card-drawer',
  standalone: true,
  imports: [RouterLink, SafeResourcePipe, FlowRibbonComponent],
  template: `
    @if (isOpen()) {
      <div class="drawer-bg" (click)="closed.emit()">
        <div class="drawer" (click)="$event.stopPropagation()">

          <!-- Head -->
          <div class="drawer-head">
            <div class="drawer-head-left">
              <div class="drawer-head-ro">{{ card()?.roNumber }}</div>
              <div class="drawer-head-meta">{{ headMeta() }}</div>
            </div>
            <button class="drawer-close" (click)="closed.emit()">×</button>
          </div>

          <!-- Tasks pane -->
          <div class="drawer-tasks">
            @if (card()?.roId; as roId) {
              <app-flow-ribbon [roId]="roId" [compact]="true" />
            }
            <div class="drawer-section-label">Station</div>
            <div class="drawer-station-title">
              {{ card()?.stationName }} · {{ trackLabel() }} track
            </div>
            <div class="drawer-station-meta">{{ stationMeta() }}</div>

            @if (card()?.gateState !== 'IN_PROGRESS') {
              <div class="gate-banner"
                   [class.gated]="card()?.gateState === 'GATED'"
                   [class.complete]="card()?.gateState === 'READY'">
                <div class="gate-banner-title">{{ gateBannerTitle() }}</div>
                @if (card()?.gateReason) {
                  <div class="gate-banner-detail">{{ card()!.gateReason }}</div>
                }
              </div>
            }

            <div class="drawer-section-label">
              Tasks at this station for {{ card()?.roNumber }}
            </div>
            <div class="task-list-full">
              @for (task of localTasks(); track task.id) {
                <div class="task-row-wrapper">
                  <div class="task-row"
                       [class.done]="task.status === 'COMPLETED'"
                       [class.progress]="task.status === 'ASSIGNED'"
                       [class.menu-open]="isSupervisor() && activeMenuTaskId() === task.id"
                       (click)="onTaskRowClick(task)">
                    <div class="task-row-check">{{ checkSymbol(task.status) }}</div>
                    <div class="task-row-body">
                      <div class="task-row-name">{{ task.operationName }}</div>
                      <div class="task-row-meta">{{ taskMeta(task) }}</div>
                    </div>
                    <div class="task-row-track"
                         [class.body]="task.flowTrack === 'BODY'"
                         [class.chassis]="task.flowTrack === 'CHASSIS'"
                         [class.subframe]="task.flowTrack === 'SUBFRAME'">
                      {{ trackChipLabel(task.flowTrack) }}
                    </div>
                    <div class="task-row-hours">{{ hoursDisplay(task) }}</div>
                  </div>
                  @if (isSupervisor() && activeMenuTaskId() === task.id) {
                    <div class="task-row-menu">
                      <a class="task-row-menu-item" [routerLink]="['/tech/tasks', task.id]">
                        View task detail →
                      </a>
                      <div class="task-row-menu-assign">
                        <span class="task-row-menu-label">Assign technician</span>
                        @if (loadingTechs()) {
                          <span class="task-row-menu-loading">Loading…</span>
                        } @else if (technicians().length === 0) {
                          <span class="task-row-menu-loading">No technicians at this station.</span>
                        } @else {
                          <select class="task-row-menu-select"
                                  (change)="assignTechnician(task, $any($event.target).value)">
                            <option value="" [selected]="!task.assignedToUserId">Unassign</option>
                            @for (t of technicians(); track t.userId) {
                              <option [value]="t.userId"
                                      [selected]="task.assignedToUserId === t.userId">
                                {{ t.fullName }}{{ t.isPrimary ? ' ★' : '' }}
                              </option>
                            }
                          </select>
                        }
                        @if (assignResult()?.taskId === task.id) {
                          <span class="task-row-menu-result"
                                [class.ok]="assignResult()!.ok"
                                [class.err]="!assignResult()!.ok">
                            {{ assignResult()!.msg }}
                          </span>
                        }
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          </div>

          <!-- PDF pane -->
          <div class="drawer-pdf">
            @if (card()?.sourcePdfUrl) {
              <div class="pdf-head">
                <span class="pdf-head-name">{{ pdfFilename() }}</span>
                <div class="pdf-head-actions">
                  <button class="pdf-head-btn" (click)="openPdfTab()">↗ Open in tab</button>
                  <a class="pdf-head-btn" [attr.href]="card()!.sourcePdfUrl" download>⤓ Download</a>
                </div>
              </div>
              @if (pdfReady()) {
                <iframe class="pdf-frame"
                        [src]="card()!.sourcePdfUrl! | safeResource"
                        title="Source PDF"></iframe>
              } @else {
                <div class="pdf-loading">Loading PDF…</div>
              }
            } @else {
              <div class="pdf-empty">
                <svg class="pdf-empty-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="8" y="4" width="28" height="40" rx="3" stroke-linejoin="round"/>
                  <path d="M28 4v12h12" stroke-linejoin="round"/>
                  <line x1="16" y1="26" x2="32" y2="26"/>
                  <line x1="16" y1="32" x2="28" y2="32"/>
                </svg>
                <p class="pdf-empty-title">No source PDF on file</p>
                <p class="pdf-empty-body">Sales hasn't uploaded the original RO document yet.</p>
                <a class="pdf-empty-link"
                   [routerLink]="['/sales/pdf-upload']"
                   [queryParams]="{ roId: card()?.roId }">
                  Upload now →
                </a>
              </div>
            }
          </div>

          <!-- Footer -->
          <div class="drawer-foot">
            @if (advanceConfirm()) {
              <div class="advance-modal">
                <span class="advance-modal-label">Reason for advance</span>
                <input class="advance-modal-input"
                       [value]="advanceReason()"
                       (input)="advanceReason.set($any($event.target).value)"
                       placeholder="Minimum 10 characters" />
                <div class="advance-modal-actions">
                  <button class="advance-modal-cancel" (click)="advanceConfirm.set(false)">Cancel</button>
                  <button class="advance-modal-confirm"
                          [disabled]="advancing() || advanceReason().length < 10"
                          (click)="doAdvance()">
                    {{ advancing() ? 'Advancing…' : 'Confirm advance →' }}
                  </button>
                </div>
                @if (advanceError()) {
                  <span class="advance-modal-error">{{ advanceError() }}</span>
                }
              </div>
            } @else {
              <span class="advance-hint">{{ advanceHintText() }}</span>
              <button class="advance-btn"
                      [disabled]="!canAdvance()"
                      [title]="advanceBtnTooltip()"
                      (click)="onAdvanceClick()">
                {{ advanceBtnLabel() }}
              </button>
            }
          </div>

        </div>
      </div>
    }
  `,
  styles: [`
    .drawer-bg {
      position: fixed;
      inset: 0;
      background: rgba(10,14,15,0.4);
      z-index: 200;
      display: flex;
      align-items: stretch;
      justify-content: flex-end;
    }
    .drawer {
      background: var(--paper);
      width: 1080px;
      max-width: 96vw;
      height: 100vh;
      overflow: hidden;
      display: grid;
      grid-template-columns: 1fr 1.05fr;
      grid-template-rows: auto 1fr auto;
      grid-template-areas:
        "head head"
        "tasks pdf"
        "foot foot";
      animation: slideIn 0.32s ease;
    }
    @keyframes slideIn {
      from { transform: translateX(40px); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }

    .drawer-head {
      grid-area: head;
      background: var(--ink);
      color: var(--paper);
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 18px;
    }
    .drawer-head-left { display: flex; align-items: baseline; gap: 12px; }
    .drawer-head-ro {
      font-family: var(--display);
      font-weight: 500;
      font-size: 22px;
      letter-spacing: -0.015em;
    }
    .drawer-head-meta {
      font-family: var(--mono);
      font-size: 11px;
      color: rgba(245,242,234,0.65);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .drawer-close {
      background: rgba(245,242,234,0.08);
      border: 0.5px solid rgba(245,242,234,0.2);
      color: var(--paper);
      border-radius: 6px;
      width: 32px;
      height: 32px;
      cursor: pointer;
      font-size: 16px;
      flex-shrink: 0;
    }

    .drawer-tasks {
      grid-area: tasks;
      overflow-y: auto;
      padding: 22px 24px;
    }
    .drawer-section-label {
      font-family: var(--mono);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--ink-3);
      margin-bottom: 10px;
    }
    .drawer-station-title {
      font-family: var(--display);
      font-weight: 500;
      font-size: 20px;
      letter-spacing: -0.01em;
      margin-bottom: 6px;
    }
    .drawer-station-meta {
      font-size: 12px;
      color: var(--ink-3);
      margin-bottom: 18px;
    }

    .gate-banner {
      background: white;
      border-left: 3px solid var(--good);
      border-radius: 0 8px 8px 0;
      padding: 12px 16px;
      margin-bottom: 18px;
    }
    .gate-banner.gated    { border-left-color: var(--warn); background: #fff8ef; }
    .gate-banner.complete { border-left-color: var(--good); background: #f0fdf4; }
    .gate-banner-title  { font-size: 13px; font-weight: 500; margin-bottom: 4px; }
    .gate-banner-detail { font-size: 12px; color: var(--ink-3); }

    .task-row-wrapper { }
    .task-row { cursor: pointer; }
    .task-row:not(.done):not(.progress):hover { background: var(--paper-2); }
    .task-row.done:hover     { background: rgba(220,252,231,0.55); }
    .task-row.progress:hover { background: rgba(219,234,254,0.6); }
    .task-row.menu-open { border-radius: 8px 8px 0 0; border-bottom-color: var(--rule-strong); }
    .task-row-menu {
      background: white;
      border: 0.5px solid var(--rule-strong);
      border-top: none;
      border-radius: 0 0 8px 8px;
      overflow: hidden;
      margin-bottom: 2px;
    }
    .task-row-menu-item {
      display: block;
      padding: 9px 14px;
      font-size: 12px;
      color: var(--accent);
      text-decoration: none;
      font-family: var(--sans);
    }
    .task-row-menu-item:hover { background: var(--paper-2); }
    .task-row-menu-assign {
      padding: 8px 14px 12px;
      border-top: 0.5px solid var(--rule);
    }
    .task-row-menu-label {
      display: block;
      font-family: var(--mono);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--ink-3);
      margin-bottom: 6px;
    }
    .task-row-menu-select {
      width: 100%;
      padding: 6px 8px;
      border: 0.5px solid var(--rule-strong);
      border-radius: 5px;
      font-size: 12px;
      background: var(--paper);
      color: var(--ink);
    }
    .task-row-menu-loading { font-size: 12px; color: var(--ink-3); font-family: var(--mono); }
    .task-row-menu-result  { display: block; font-size: 11px; margin-top: 5px; font-family: var(--mono); }
    .task-row-menu-result.ok  { color: var(--good); }
    .task-row-menu-result.err { color: var(--bad); }

    .task-list-full {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 22px;
    }
    .task-row {
      background: white;
      border: 0.5px solid var(--rule);
      border-radius: 8px;
      padding: 12px 14px;
      display: grid;
      grid-template-columns: 24px 1fr auto auto;
      gap: 12px;
      align-items: center;
    }
    .task-row.done     { background: rgba(220,252,231,0.35); border-color: #bbf7d0; }
    .task-row.progress { background: rgba(219,234,254,0.40); border-color: #93c5fd; }
    .task-row-check {
      width: 18px;
      height: 18px;
      border: 1px solid var(--rule-strong);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 11px;
    }
    .task-row.done     .task-row-check { background: var(--good); border-color: var(--good); }
    .task-row.progress .task-row-check { background: var(--info); border-color: var(--info); }
    .task-row-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .task-row-name { font-size: 13px; font-weight: 500; }
    .task-row.done .task-row-name { text-decoration: line-through; color: var(--ink-3); text-decoration-thickness: 0.5px; }
    .task-row-meta { font-size: 11px; color: var(--ink-3); font-family: var(--mono); }
    .task-row-hours {
      font-family: var(--mono);
      font-size: 12px;
      text-align: right;
      color: var(--ink-3);
      white-space: nowrap;
    }
    .task-row-track {
      font-size: 9.5px;
      padding: 2px 7px;
      border-radius: 3px;
      font-family: var(--mono);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      white-space: nowrap;
      background: var(--paper-3);
      color: var(--ink-3);
    }
    .task-row-track.body     { background: rgba(29,78,216,0.12);  color: var(--track-body); }
    .task-row-track.chassis  { background: rgba(180,83,9,0.12);   color: var(--track-chassis); }
    .task-row-track.subframe { background: rgba(124,58,237,0.12); color: var(--track-subframe); }

    /* PDF pane */
    .drawer-pdf {
      grid-area: pdf;
      background: #f7f4ec;
      padding: 22px 24px;
      overflow: hidden;
      border-left: 0.5px solid var(--rule);
      display: flex;
      flex-direction: column;
    }
    .pdf-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      flex-shrink: 0;
    }
    .pdf-head-name { font-family: var(--mono); font-size: 12px; color: var(--ink-2); }
    .pdf-head-actions { display: flex; gap: 6px; }
    .pdf-head-btn {
      background: white;
      border: 0.5px solid var(--rule);
      border-radius: 5px;
      padding: 4px 10px;
      font-size: 11px;
      font-family: var(--sans);
      cursor: pointer;
      color: var(--ink-2);
      text-decoration: none;
      display: inline-block;
    }
    .pdf-head-btn:hover { border-color: var(--accent); color: var(--accent); }
    .pdf-frame {
      flex: 1;
      border: none;
      min-height: 0;
      border-radius: 6px;
    }
    .pdf-loading {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--mono);
      font-size: 11px;
      color: var(--ink-3);
    }

    /* Empty state */
    .pdf-empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      text-align: center;
    }
    .pdf-empty-icon {
      width: 48px;
      height: 48px;
      color: var(--ink-3);
      opacity: 0.5;
    }
    .pdf-empty-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--ink-2);
      margin: 0;
    }
    .pdf-empty-body {
      font-size: 12px;
      color: var(--ink-3);
      margin: 0;
      max-width: 240px;
    }
    .pdf-empty-link {
      font-size: 13px;
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid transparent;
      transition: border-color 0.15s;
    }
    .pdf-empty-link:hover { border-bottom-color: var(--accent); }

    /* Footer */
    .drawer-foot {
      grid-area: foot;
      border-top: 0.5px solid var(--rule);
      background: white;
      padding: 14px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .advance-hint {
      font-size: 12px;
      color: var(--ink-3);
      max-width: 480px;
    }
    .advance-btn {
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 8px;
      padding: 12px 22px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      font-family: var(--sans);
    }
    .advance-btn:disabled {
      background: var(--paper-3);
      color: var(--ink-3);
      cursor: not-allowed;
    }
    .advance-modal {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .advance-modal-label {
      font-family: var(--mono);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--ink-3);
    }
    .advance-modal-input {
      padding: 8px 10px;
      border: 0.5px solid var(--rule-strong);
      border-radius: 6px;
      font-size: 13px;
      background: var(--paper);
      color: var(--ink);
      width: 100%;
      box-sizing: border-box;
      font-family: var(--sans);
    }
    .advance-modal-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .advance-modal-cancel {
      background: transparent;
      border: 0.5px solid var(--rule-strong);
      border-radius: 6px;
      padding: 7px 14px;
      font-size: 12px;
      cursor: pointer;
      color: var(--ink-3);
      font-family: var(--sans);
    }
    .advance-modal-confirm {
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 6px;
      padding: 7px 16px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      font-family: var(--sans);
    }
    .advance-modal-confirm:disabled { background: var(--paper-3); color: var(--ink-3); cursor: not-allowed; }
    .advance-modal-error { font-size: 11px; color: var(--bad); font-family: var(--mono); }
  `],
})
export class CardDrawerComponent {
  private auth   = inject(AuthService);
  private router = inject(Router);
  private svc    = inject(KanbanService);

  card   = input<KanbanCardDto | null>(null);
  isOpen = input<boolean>(false);
  closed = output<void>();

  pdfReady         = signal(false);
  activeMenuTaskId = signal<string | null>(null);
  technicians      = signal<StationTechnicianDto[]>([]);
  loadingTechs     = signal(false);
  assignResult     = signal<{ taskId: string; ok: boolean; msg: string } | null>(null);
  advanceConfirm   = signal(false);
  advanceReason    = signal('Manually confirmed by supervisor');
  advancing        = signal(false);
  advanceError     = signal<string | null>(null);
  private assignmentOverrides = signal<Record<string, Partial<KanbanCardTaskDto>>>({});
  // Computed so it reacts to both card input changes and local assignment patches immediately
  localTasks = computed<KanbanCardTaskDto[]>(() => {
    const tasks     = this.card()?.tasks ?? [];
    const overrides = this.assignmentOverrides();
    return tasks.map(t => {
      const o = overrides[t.id];
      return o ? { ...t, ...o } : t;
    });
  });
  private pdfTimer: ReturnType<typeof setTimeout> | null = null;

  isSupervisor = computed(() => {
    const roles = this.auth.user()?.roles ?? [];
    return roles.includes('SUPERVISOR') || roles.includes('ADMIN');
  });

  constructor() {
    effect(() => {
      const open = this.isOpen();
      if (this.pdfTimer) { clearTimeout(this.pdfTimer); this.pdfTimer = null; }
      if (open) {
        this.pdfTimer = setTimeout(() => this.pdfReady.set(true), 380);
        const card = this.card();
        if (card) this.loadTechnicians(card.stationId);
      } else {
        this.pdfReady.set(false);
        this.activeMenuTaskId.set(null);
        this.technicians.set([]);
        this.assignResult.set(null);
        this.assignmentOverrides.set({});
        this.advanceConfirm.set(false);
        this.advanceReason.set('Manually confirmed by supervisor');
        this.advanceError.set(null);
      }
    }, { allowSignalWrites: true });
  }

  private loadTechnicians(stationId: number): void {
    this.loadingTechs.set(true);
    this.svc.getTechnicians(stationId).subscribe({
      next:  techs => { this.technicians.set(techs); this.loadingTechs.set(false); },
      error: ()    => this.loadingTechs.set(false),
    });
  }

  assignTechnician(task: KanbanCardTaskDto, userId: string): void {
    const uid = userId || null;
    this.assignResult.set(null);
    this.svc.assignTask(task.id, uid).subscribe({
      next: () => {
        const name = this.technicians().find(t => t.userId === uid)?.fullName ?? null;
        // Optimistically patch so the drawer reflects the change immediately
        this.assignmentOverrides.update(m => ({
          ...m,
          [task.id]: { assignedToUserId: uid, assignedToName: name },
        }));
        this.assignResult.set({
          taskId: task.id,
          ok:     true,
          msg:    uid ? `Assigned to ${name}` : 'Unassigned',
        });
        setTimeout(() => this.assignResult.set(null), 3000);
      },
      error: (err: { error?: { message?: string } }) => {
        this.assignResult.set({
          taskId: task.id,
          ok:     false,
          msg:    err?.error?.message ?? 'Assignment failed.',
        });
      },
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (this.activeMenuTaskId()) {
      this.activeMenuTaskId.set(null);
    } else if (this.isOpen()) {
      this.closed.emit();
    }
  }

  onTaskRowClick(task: KanbanCardTaskDto): void {
    if (this.isSupervisor()) {
      this.activeMenuTaskId.update(id => id === task.id ? null : task.id);
    } else {
      this.router.navigate(['/tech/tasks', task.id]);
    }
  }

  headMeta = computed(() => {
    const c = this.card();
    if (!c) return '';
    const parts: string[] = [c.customerName];
    if (c.bodyType) parts.push(bodyTypeShortCode(c.bodyType));
    if (c.requiredDate) {
      const d = new Date(c.requiredDate);
      parts.push(`Due ${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`);
    }
    return parts.join(' · ');
  });

  stationMeta = computed(() => {
    const c = this.card();
    if (!c) return '';
    const n = c.totalTasks;
    return `Station ${c.stationId} · ${n} task${n !== 1 ? 's' : ''} · ${c.estimatedHours} h estimated`;
  });

  trackLabel = computed(() => {
    const t = this.card()?.track ?? 'BODY';
    return t === 'MIXED' ? 'mixed' : t.toLowerCase();
  });

  pendingCount = computed(() =>
    this.card()?.tasks.filter(t => t.status !== 'COMPLETED').length ?? 0,
  );

  advanceBtnLabel = computed(() => {
    const n = this.pendingCount();
    if (n === 0) return 'Advance →';
    return `Advance · ${n} task${n !== 1 ? 's' : ''} pending`;
  });

  canAdvance = computed(() =>
    this.isSupervisor() && this.card()?.gateState === 'COMPLETE',
  );

  advanceBtnTooltip = computed(() => {
    if (!this.isSupervisor()) return 'Only supervisors can advance';
    const state = this.card()?.gateState;
    if (state === 'COMPLETE') return 'Click to advance this card to the next stage';
    const n = this.pendingCount();
    return `${n} task${n !== 1 ? 's' : ''} must complete before advancing`;
  });

  advanceHintText = computed(() => {
    const c = this.card();
    if (!c) return '';
    switch (c.gateState) {
      case 'COMPLETE':    return 'All tasks complete. Card is ready to advance to the next stage.';
      case 'GATED':       return c.gateReason ?? 'Card is gated — upstream work not yet complete.';
      case 'READY':       return 'Upstream work complete. Card advances automatically when all tasks here complete.';
      default:            return 'Card advances automatically when all tasks at this station complete.';
    }
  });

  gateBannerTitle = computed(() => {
    switch (this.card()?.gateState) {
      case 'GATED': return 'Gated — prerequisite not met';
      case 'READY': return 'Ready to advance';
      default:      return '';
    }
  });

  pdfFilename = computed(() =>
    (this.card()?.sourcePdfUrl ?? '').split('/').pop() ?? 'source.pdf',
  );

  checkSymbol(status: string): string {
    if (status === 'COMPLETED') return '✓';
    if (status === 'ASSIGNED')  return '▶';
    return '';
  }

  trackChipLabel(flowTrack: string): string {
    const labels: Record<string, string> = {
      BODY: 'Body', CHASSIS: 'Chassis', SUBFRAME: 'Subframe', ANY: 'Any',
    };
    return labels[flowTrack] ?? flowTrack;
  }

  taskMeta(task: KanbanCardTaskDto): string {
    const who = task.assignedToName ?? 'Unassigned';
    return `${who} · seq ${String(task.sequence).padStart(2, '0')} · est ${task.estimatedHours} h`;
  }

  hoursDisplay(task: KanbanCardTaskDto): string {
    if (task.status === 'PENDING') return `— / ${task.estimatedHours} h`;
    return `${task.actualHours} / ${task.estimatedHours} h`;
  }

  onAdvanceClick(): void {
    if (!this.canAdvance()) return;
    this.advanceError.set(null);
    this.advanceConfirm.set(true);
  }

  doAdvance(): void {
    const card = this.card();
    if (!card) return;
    this.advancing.set(true);
    this.svc.forceAdvance(card.roId, card.stationId, this.advanceReason()).subscribe({
      next: () => {
        this.advancing.set(false);
        this.advanceConfirm.set(false);
        this.closed.emit();
      },
      error: (err: { error?: { message?: string } }) => {
        this.advancing.set(false);
        this.advanceError.set(err?.error?.message ?? 'Advance failed. Please try again.');
      },
    });
  }

  openPdfTab(): void {
    const url = this.card()?.sourcePdfUrl;
    if (url) window.open(url, '_blank');
  }
}
