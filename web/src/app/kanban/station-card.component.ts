import {
  Component, computed, input, output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { KanbanCardDto, KanbanCardTaskDto } from './kanban.service';
import { bodyTypeShortCode } from './body-type.util';

@Component({
  selector: 'app-station-card',
  standalone: true,
  imports: [CommonModule],
  host: {
    '[class.stn-card]': 'true',
    '[class.gated]':    'card().gateState === "GATED"',
    '[class.ready]':    'card().gateState === "READY"',
    '[class.complete]': 'card().gateState === "COMPLETE"',
    '[class.hospital]': 'card().isHospital',
    '(click)': 'onCardClick()',
  },
  template: `
    <!-- Track stripe -->
    <div [class]="trackClass()"></div>

    <!-- Header -->
    <div class="stn-card-head">
      <div class="stn-card-ro">
        {{ card().roNumber }}
        <small>{{ card().customerName }} · {{ bodyTypeLabel() }}</small>
      </div>
      <div class="stn-card-tags">
        @if (card().isHospital) {
          <span class="stn-card-hospital" title="In HOSPITAL stage — surfaces in every week">HOSPITAL</span>
        }
        @if (weekBadge(); as w) {
          <span class="stn-card-week" [class.carryover]="isCarryover()" [title]="weekTooltip()">
            {{ w }}
          </span>
        }
        @if (card().bodyType) {
          <span class="stn-card-body-type">{{ bodyTypeCode() }}</span>
        }
      </div>
    </div>

    <!-- Progress row -->
    <div class="stn-card-progress">
      <span>
        <strong>{{ card().completedTasks }}</strong>/{{ card().totalTasks }} tasks ·
        <strong>{{ card().actualHours | number:'1.1-1' }}</strong>/{{ card().estimatedHours | number:'1.1-1' }} h
      </span>
      <span>{{ trackLabel() }}</span>
    </div>

    <!-- Progress bar -->
    <div class="stn-progress-bar">
      <div [class]="progressFillClass()" [style.width.%]="progressPct()"></div>
    </div>

    <!-- Mini task list -->
    <div class="stn-tasks-mini">
      @for (task of visibleTasks(); track task.id) {
        <div [class]="taskItemClass(task)">
          <span class="check">{{ task.status === 'COMPLETED' ? '✓' : '' }}</span>
          <span>{{ task.operationName }}</span>
          <span class="stn-task-mini-hours">{{ task.estimatedHours | number:'1.1-1' }}h</span>
        </div>
      }
      @if (extraTaskCount() > 0) {
        <div class="stn-task-mini stn-task-mini-more">
          <span class="check"></span>
          <span>+ {{ extraTaskCount() }} more</span>
        </div>
      }
    </div>

    <!-- Footer -->
    <div class="stn-card-foot">
      <button class="stn-pdf-btn" (click)="onPdfClick($event)" [disabled]="!card().sourcePdfUrl">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 13V3a1 1 0 011-1h6l3 3v8a1 1 0 01-1 1H4a1 1 0 01-1-1z" stroke-linejoin="round"/>
          <path d="M10 2v3h3"/>
        </svg>
        View PDF
      </button>
      <span [class]="gatePillClass()">{{ gatePillLabel() }}</span>
    </div>

    @if (card().gateState === 'GATED' && card().gateReason) {
      <div class="stn-gate-tip">{{ card().gateReason }}</div>
    }
  `,
  styles: [`
    :host { display: block; }

    .stn-card-track { height: 3px; background: var(--ink-3); }
    .stn-card-track.body    { background: var(--track-body); }
    .stn-card-track.chassis { background: var(--track-chassis); }
    .stn-card-track.subframe { background: var(--track-subframe); }
    .stn-card-track.split {
      background: linear-gradient(90deg, var(--track-body) 50%, var(--track-chassis) 50%);
    }

    .stn-card-head {
      padding: 10px 12px 6px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }
    .stn-card-ro {
      font-family: var(--mono);
      font-size: 12px;
      font-weight: 600;
      color: var(--ink);
      line-height: 1.2;
    }
    .stn-card-ro small {
      display: block;
      font-family: var(--sans);
      font-weight: 400;
      color: var(--ink-3);
      font-size: 10.5px;
      margin-top: 2px;
    }
    .stn-card-body-type {
      background: var(--paper-2);
      color: var(--ink-3);
      padding: 2px 7px;
      border-radius: 3px;
      font-size: 9.5px;
      font-family: var(--mono);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      white-space: nowrap;
      align-self: flex-start;
    }

    .stn-card-progress {
      padding: 4px 12px 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: var(--ink-3);
      font-family: var(--mono);
    }
    .stn-card-progress strong { color: var(--ink); font-weight: 500; }

    .stn-progress-bar {
      height: 3px;
      background: var(--paper-3);
      margin: 0 12px;
      border-radius: 2px;
      overflow: hidden;
    }
    .stn-progress-fill {
      height: 100%;
      background: var(--info);
      transition: width 0.4s ease;
    }
    .stn-progress-fill.complete { background: var(--good); }
    .stn-progress-fill.warn     { background: var(--warn); }

    .stn-tasks-mini {
      padding: 8px 12px 6px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .stn-task-mini {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 11px;
      color: var(--ink-2);
    }
    .stn-task-mini .check {
      width: 12px;
      height: 12px;
      border: 1px solid var(--rule-strong);
      border-radius: 3px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      color: white;
      flex-shrink: 0;
    }
    .stn-task-mini.done .check {
      background: var(--good);
      border-color: var(--good);
    }
    .stn-task-mini.progress .check {
      border-color: var(--info);
      background: white;
      position: relative;
    }
    .stn-task-mini.progress .check::after {
      content: '';
      width: 6px;
      height: 6px;
      background: var(--info);
      border-radius: 1px;
    }
    .stn-task-mini.done {
      color: var(--ink-3);
      text-decoration: line-through;
      text-decoration-thickness: 0.5px;
    }
    .stn-task-mini-hours {
      margin-left: auto;
      font-family: var(--mono);
      font-size: 10px;
      color: var(--ink-3);
    }
    .stn-task-mini-more { color: var(--ink-3); font-style: italic; }

    .stn-card-foot {
      border-top: 0.5px solid var(--rule);
      padding: 7px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--paper);
    }
    :host.complete .stn-card-foot { background: rgba(220,252,231,0.4); }

    .stn-pdf-btn {
      background: white;
      color: var(--ink-2);
      border: 0.5px solid var(--rule-strong);
      border-radius: 5px;
      padding: 4px 8px 4px 6px;
      font-size: 10.5px;
      font-family: var(--sans);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s;
    }
    .stn-pdf-btn:hover:not(:disabled) { background: var(--paper-2); border-color: var(--accent); color: var(--accent); }
    .stn-pdf-btn:disabled { opacity: 0.4; cursor: default; }
    .stn-pdf-btn svg { width: 11px; height: 11px; }

    .stn-gate-pill {
      font-size: 10px;
      padding: 3px 7px;
      border-radius: 3px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-family: var(--mono);
    }
    .stn-gate-pill.ready       { background: #dcfce7; color: var(--good); }
    .stn-gate-pill.gated       { background: var(--paper-3); color: var(--ink-3); }
    .stn-gate-pill.advance     { background: var(--accent); color: white; cursor: pointer; }
    .stn-gate-pill.in-progress { background: #dbeafe; color: var(--info); }

    .stn-card-tags { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .stn-card-week {
      font-family: var(--mono); font-size: 10px; font-weight: 600;
      letter-spacing: 0.04em;
      padding: 2px 6px; border-radius: 4px;
      background: var(--paper-3); color: var(--ink-3);
      border: 0.5px solid var(--rule);
    }
    .stn-card-week.carryover {
      background: rgba(217,119,6,0.12);
      color: var(--warn);
      border-color: rgba(217,119,6,0.3);
    }
    .stn-card-hospital {
      font-family: var(--mono); font-size: 10px; font-weight: 700;
      letter-spacing: 0.06em;
      padding: 2px 6px; border-radius: 4px;
      background: rgba(185,28,28,0.12);
      color: var(--bad);
      border: 0.5px solid rgba(185,28,28,0.3);
    }

    .stn-gate-tip {
      position: absolute;
      top: 100%;
      right: 8px;
      margin-top: 4px;
      background: var(--ink);
      color: var(--paper);
      padding: 8px 10px;
      border-radius: 6px;
      font-size: 11px;
      line-height: 1.4;
      width: 200px;
      z-index: 50;
      display: none;
      box-shadow: 0 4px 12px rgba(10,14,15,0.2);
    }
    :host.gated:hover .stn-gate-tip { display: block; }
  `],
})
export class StationCardComponent {
  card         = input.required<KanbanCardDto>();
  // Currently-selected week filter on the board ('' = all weeks, 'backlog' = unscheduled,
  // or yyyy-MM-dd Monday). Used to flag carryover ROs (scheduled for an earlier week).
  selectedWeek = input<string>('');
  cardClick    = output<void>();
  pdfClick     = output<void>();

  weekBadge = computed(() => {
    const w = this.card().scheduledStartWeek;
    if (!w) return null;
    return `W${this.isoWeekOf(w)}`;
  });

  isCarryover = computed(() => {
    const cardWeek = this.card().scheduledStartWeek;
    const sel      = this.selectedWeek();
    if (!cardWeek || !sel || sel === 'backlog') return false;
    return cardWeek < sel;  // lexicographic compare on yyyy-MM-dd works
  });

  weekTooltip = computed(() => {
    const w = this.card().scheduledStartWeek;
    if (!w) return '';
    return this.isCarryover()
      ? `Carryover · scheduled for week of ${w}`
      : `Scheduled for week of ${w}`;
  });

  private isoWeekOf(yyyymmdd: string): number {
    // Standard ISO 8601 week: Thursday of the week determines which week-of-year.
    const [y, m, d] = yyyymmdd.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  visibleTasks  = computed(() => this.card().tasks.slice(0, 4));
  extraTaskCount = computed(() => Math.max(0, this.card().tasks.length - 4));
  progressPct   = computed(() => {
    const c = this.card();
    return c.totalTasks > 0 ? Math.round((c.completedTasks / c.totalTasks) * 100) : 0;
  });

  bodyTypeCode  = computed(() => bodyTypeShortCode(this.card().bodyType ?? ''));
  bodyTypeLabel = computed(() => this.card().bodyType?.replace(/_/g, ' ') ?? '');

  trackClass = computed(() => {
    const t = this.card().track.toLowerCase();
    return t === 'mixed' ? 'stn-card-track split' : `stn-card-track ${t}`;
  });

  trackLabel = computed(() => {
    const t = this.card().track;
    if (t === 'MIXED') return 'Mixed';
    return t.charAt(0) + t.slice(1).toLowerCase();
  });

  progressFillClass = computed(() => {
    const c = this.card();
    if (c.gateState === 'COMPLETE') return 'stn-progress-fill complete';
    if (c.completedTasks > 0 && c.completedTasks === c.totalTasks) return 'stn-progress-fill complete';
    return 'stn-progress-fill';
  });

  gatePillClass = computed(() => {
    switch (this.card().gateState) {
      case 'READY':       return 'stn-gate-pill ready';
      case 'GATED':       return 'stn-gate-pill gated';
      case 'COMPLETE':    return 'stn-gate-pill advance';
      case 'IN_PROGRESS': return 'stn-gate-pill in-progress';
      default:            return 'stn-gate-pill';
    }
  });

  gatePillLabel = computed(() => {
    switch (this.card().gateState) {
      case 'READY':       return 'Ready';
      case 'GATED':       return 'Gated';
      case 'COMPLETE':    return 'Advance →';
      case 'IN_PROGRESS': return 'In progress';
      default:            return this.card().gateState;
    }
  });

  taskItemClass(task: KanbanCardTaskDto): string {
    if (task.status === 'COMPLETED')   return 'stn-task-mini done';
    if (task.status === 'IN_PROGRESS') return 'stn-task-mini progress';
    return 'stn-task-mini';
  }

  onCardClick(): void {
    this.cardClick.emit();
  }

  onPdfClick(event: Event): void {
    event.stopPropagation();
    this.pdfClick.emit();
  }
}
