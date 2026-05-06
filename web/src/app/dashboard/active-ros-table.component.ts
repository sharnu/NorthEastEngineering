import { Component, Input, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ActiveRo } from './dashboard.service';

type SortField = 'priority' | 'requiredDate' | 'status' | 'completionPct';

@Component({
  selector: 'app-active-ros-table',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule],
  template: `
    <div class="table-filters">
      <input class="filter-input" [(ngModel)]="filterCustomer" placeholder="Filter by customer…" />
      <select class="filter-select" [(ngModel)]="filterStatus">
        <option value="">All statuses</option>
        <option value="DRAFT">Draft</option>
        <option value="APPROVED">Approved</option>
        <option value="IN_PROGRESS">In Progress</option>
        <option value="ON_HOLD">On Hold</option>
      </select>
    </div>

    @if (visibleRows().length === 0) {
      <p class="empty-table">No active repair orders.</p>
    } @else {
      <div class="table-wrap">
        <table class="ro-table">
          <thead>
            <tr>
              <th (click)="sort('priority')" class="sortable">Priority {{ sortIcon('priority') }}</th>
              <th>RO #</th>
              <th>Customer</th>
              <th>Template</th>
              <th>Stage</th>
              <th (click)="sort('status')" class="sortable">Status {{ sortIcon('status') }}</th>
              <th (click)="sort('requiredDate')" class="sortable">Due {{ sortIcon('requiredDate') }}</th>
              <th (click)="sort('completionPct')" class="sortable">Progress {{ sortIcon('completionPct') }}</th>
              <th>Hours</th>
            </tr>
          </thead>
          <tbody>
            @for (row of visibleRows(); track row.id) {
              <tr (click)="navigate(row.id)" class="ro-row">
                <td><span class="priority-badge" [class]="priorityClass(row.priority)">{{ priorityLabel(row.priority) }}</span></td>
                <td class="mono">{{ row.roNumber }}</td>
                <td>{{ row.customerName }}</td>
                <td class="mono">{{ row.templateCode }} · {{ row.bodyType }}</td>
                <td>{{ row.currentStage ?? '—' }}</td>
                <td><span class="status-pill" [class]="statusClass(row.status)">{{ row.status }}</span></td>
                <td>{{ row.requiredDate ? (row.requiredDate | date:'dd MMM yy') : '—' }}</td>
                <td>
                  <div class="progress-cell">
                    <div class="prog-track"><div class="prog-fill" [style.width.%]="row.completionPct"></div></div>
                    <span class="prog-text">{{ row.tasksCompleted }}/{{ row.taskCount }}</span>
                  </div>
                </td>
                <td>{{ (row.hoursScheduled - row.hoursUtilised).toFixed(1) }}h left</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: [`
    .table-filters { display: flex; gap: 10px; margin-bottom: 12px; }
    .filter-input, .filter-select { padding: 7px 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; }
    .filter-input { flex: 1; }
    .table-wrap { overflow-x: auto; }
    .ro-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .ro-table th { text-align: left; padding: 8px 12px; border-bottom: 2px solid #e2e8f0; color: #718096; font-weight: 600; white-space: nowrap; }
    .ro-table td { padding: 10px 12px; border-bottom: 1px solid #f0f4f8; }
    .ro-row { cursor: pointer; transition: background 0.1s; }
    .ro-row:hover { background: #f7fafc; }
    .sortable { cursor: pointer; user-select: none; }
    .mono { font-family: monospace; }
    .empty-table { color: #a0aec0; padding: 24px 0; text-align: center; }

    .priority-badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .pri-urgent { background: #fed7d7; color: #c53030; }
    .pri-high   { background: #feebc8; color: #c05621; }
    .pri-normal { background: #bee3f8; color: #2b6cb0; }
    .pri-low    { background: #e2e8f0; color: #4a5568; }

    .status-pill { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .pill-green  { background: #c6f6d5; color: #276749; }
    .pill-amber  { background: #feebc8; color: #c05621; }
    .pill-blue   { background: #bee3f8; color: #2b6cb0; }
    .pill-grey   { background: #e2e8f0; color: #4a5568; }

    .progress-cell { display: flex; align-items: center; gap: 8px; }
    .prog-track { width: 60px; height: 6px; background: #e2e8f0; border-radius: 3px; }
    .prog-fill  { height: 100%; background: #48bb78; border-radius: 3px; }
    .prog-text  { font-size: 11px; color: #718096; }
  `],
})
export class ActiveRosTableComponent {
  @Input() set rows(val: ActiveRo[]) { this._rows.set(val); }

  private _rows = signal<ActiveRo[]>([]);
  filterCustomer = '';
  filterStatus = '';
  sortField = signal<SortField>('priority');
  sortDir = signal<1 | -1>(1);

  visibleRows = computed(() => {
    let r = this._rows();
    if (this.filterCustomer) r = r.filter(x => x.customerName.toLowerCase().includes(this.filterCustomer.toLowerCase()));
    if (this.filterStatus) r = r.filter(x => x.status === this.filterStatus);
    const f = this.sortField(), d = this.sortDir();
    return [...r].sort((a, b) => {
      const av = a[f] ?? '', bv = b[f] ?? '';
      return av < bv ? -d : av > bv ? d : 0;
    });
  });

  constructor(private router: Router) {}

  sort(f: SortField) {
    if (this.sortField() === f) this.sortDir.update(d => (d === 1 ? -1 : 1));
    else { this.sortField.set(f); this.sortDir.set(1); }
  }

  sortIcon(f: SortField) { return this.sortField() === f ? (this.sortDir() === 1 ? '↑' : '↓') : ''; }

  navigate(id: string) { this.router.navigate(['/sales/ro', id]); }

  priorityClass(p: number) { return p === 1 ? 'pri-urgent' : p === 2 ? 'pri-high' : p <= 3 ? 'pri-normal' : 'pri-low'; }
  priorityLabel(p: number) { return p === 1 ? 'Urgent' : p === 2 ? 'High' : p === 3 ? 'Normal' : 'Low'; }
  statusClass(s: string) {
    return s === 'IN_PROGRESS' ? 'pill-green status-pill' : s === 'ON_HOLD' ? 'pill-amber status-pill'
         : s === 'APPROVED'   ? 'pill-blue status-pill'  : 'pill-grey status-pill';
  }
}
