import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { KanbanTaskDto } from './kanban.service';

@Component({
  selector: 'app-task-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="task-card" [class]="priorityClass()" (click)="cardClicked.emit(task)">
      <div class="task-card-body">
        <div class="card-top-row">
          <span class="op-name">{{ task.operationName }}</span>
          <div class="card-actions" (click)="$event.stopPropagation()">
            @if (task.hasManualOverride) {
              <span class="override-badge"
                    [title]="overrideTooltip()"
                    aria-label="Stage manually set">⚠</span>
            }
            @if (isSupervisor) {
              <button class="menu-btn" (click)="onMenuClick($event)" title="More actions">⋯</button>
            }
          </div>
        </div>
        <span class="ro-ref">{{ task.roNumber }} · {{ task.customerName }}</span>
        <div class="task-card-footer">
          <span class="hours">{{ task.estimatedHours }}h est.</span>
          <span class="pill" [class]="statusClass()">{{ statusLabel() }}</span>
          <span class="assignee">{{ task.assignedToName ?? 'Unassigned' }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .task-card {
      background: white;
      border: 0.5px solid var(--rule);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
      cursor: pointer;
      border-left: 4px solid var(--paper-3);
      transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
    }
    .task-card:hover {
      border-color: var(--accent);
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(10,14,15,0.06);
    }
    .priority-urgent { border-left-color: var(--bad); }
    .priority-high   { border-left-color: var(--warn); }
    .priority-normal { border-left-color: var(--info); }
    .priority-low    { border-left-color: var(--paper-3); }

    .card-top-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 4px; margin-bottom: 2px; }
    .op-name      { font-size: 13px; font-weight: 600; color: var(--ink); flex: 1; min-width: 0; }
    .card-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }

    .override-badge {
      font-size: 11px; color: var(--warn); cursor: help;
      line-height: 1; padding: 1px 2px;
    }
    .menu-btn {
      background: none; border: none; padding: 0 2px; font-size: 16px; line-height: 1;
      color: var(--ink-3); cursor: pointer; border-radius: 4px;
      transition: background 0.12s, color 0.12s;
    }
    .menu-btn:hover { background: var(--paper-2); color: var(--ink); }

    .ro-ref    { display: block; font-family: var(--mono); font-size: 10px; color: var(--ink-3); margin-bottom: 8px; }
    .task-card-footer { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .hours   { font-family: var(--mono); font-size: 11px; color: var(--ink-3); }
    .assignee { font-size: 11px; color: var(--ink-3); margin-left: auto; }

    .pill { font-size: 10px; font-weight: 500; padding: 2px 8px; border-radius: 3px; }
    .pill-pending    { background: var(--paper-3); color: var(--ink-3); }
    .pill-assigned   { background: #e0e7ff; color: #3730a3; }
    .pill-inprogress { background: #dbeafe; color: var(--info); }
    .pill-paused     { background: #fef9c3; color: var(--warn); }
    .pill-blocked    { background: #fee2e2; color: var(--bad); }
  `],
})
export class TaskCardComponent {
  @Input() task!: KanbanTaskDto;
  @Input() isSupervisor = false;
  @Output() cardClicked = new EventEmitter<KanbanTaskDto>();
  @Output() menuClicked = new EventEmitter<{ task: KanbanTaskDto; rect: DOMRect }>();

  onMenuClick(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menuClicked.emit({ task: this.task, rect });
  }

  overrideTooltip(): string {
    const parts: string[] = ['Stage manually set'];
    if (this.task.overrideByName) parts.push(`by ${this.task.overrideByName}`);
    if (this.task.overrideAt) {
      const d = new Date(this.task.overrideAt);
      parts.push(`on ${d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}`);
    }
    if (this.task.overrideReason) parts.push(`— ${this.task.overrideReason}`);
    return parts.join(' ');
  }

  priorityClass() {
    switch (this.task.priority) {
      case 1: return 'task-card priority-urgent';
      case 2: return 'task-card priority-high';
      case 3: return 'task-card priority-normal';
      default: return 'task-card priority-low';
    }
  }

  statusClass() {
    switch (this.task.status) {
      case 'PENDING':     return 'pill pill-pending';
      case 'ASSIGNED':    return 'pill pill-assigned';
      case 'IN_PROGRESS': return 'pill pill-inprogress';
      case 'PAUSED':      return 'pill pill-paused';
      case 'BLOCKED':     return 'pill pill-blocked';
      default:            return 'pill pill-pending';
    }
  }

  statusLabel() {
    switch (this.task.status) {
      case 'IN_PROGRESS': return 'In Progress';
      default: return this.task.status.charAt(0) + this.task.status.slice(1).toLowerCase();
    }
  }
}
