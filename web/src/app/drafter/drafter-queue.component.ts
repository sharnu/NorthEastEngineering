import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { DrafterService, QueueItem, DRAFTER_STATUS_LABELS } from './drafter.service';

type StatusFilter = 'ALL' | 'NOT_STARTED' | 'IN_PROGRESS' | 'ON_HOLD';

@Component({
  selector: 'app-drafter-queue',
  standalone: true,
  imports: [CommonModule, DatePipe],
  template: `
    <div class="queue-header">
      <div>
        <h2 class="queue-title">Drafting Queue</h2>
        @if (!loading()) {
          <span class="queue-count">{{ filteredItems().length }} RO{{ filteredItems().length !== 1 ? 's' : '' }} awaiting drafting</span>
        }
      </div>
      <button class="btn-refresh" (click)="load()">Refresh</button>
    </div>

    <div class="filter-chips">
      @for (f of filters; track f.value) {
        <button class="chip" [class.chip-active]="statusFilter() === f.value" (click)="statusFilter.set(f.value)">
          {{ f.label }}
        </button>
      }
    </div>

    @if (loading()) {
      <div class="loading">Loading queue…</div>
    } @else if (error()) {
      <div class="error-state">{{ error() }}</div>
    } @else if (filteredItems().length === 0) {
      <div class="empty-state">
        <p>No ROs match the current filter.</p>
      </div>
    } @else {
      <table class="queue-table">
        <thead>
          <tr>
            <th>RO Number</th>
            <th>Customer</th>
            <th>Template</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Required Date</th>
            <th>Days Until</th>
          </tr>
        </thead>
        <tbody>
          @for (item of filteredItems(); track item.id) {
            <tr class="queue-row" (click)="open(item.id)">
              <td class="ro-link">{{ item.roNumber }}</td>
              <td>{{ item.customerName }}</td>
              <td>{{ item.templateName }}</td>
              <td><span class="pill" [class]="'status-' + item.draftingStatus">{{ label(item.draftingStatus) }}</span></td>
              <td class="priority">P{{ item.priority }}</td>
              <td>{{ item.requiredDate ? (item.requiredDate | date:'dd MMM yyyy') : '—' }}</td>
              <td [class.overdue]="daysUntil(item) !== null && daysUntil(item)! < 7">
                {{ daysUntil(item) !== null ? daysUntil(item) + 'd' : '—' }}
              </td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
  styles: [`
    .queue-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
    .queue-title  { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
    .queue-count  { font-size: 13px; color: var(--ink-3); }
    .btn-refresh  { background: none; border: 1px solid var(--rule); border-radius: 6px;
                    padding: 5px 12px; cursor: pointer; font-size: 12px; color: var(--ink-3); }
    .btn-refresh:hover { color: var(--ink); border-color: var(--ink-3); }
    .filter-chips { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
    .chip         { background: var(--rule); border: none; border-radius: 20px; padding: 5px 14px;
                    font-size: 12px; cursor: pointer; color: var(--ink-3); }
    .chip:hover   { background: #ddd; color: var(--ink); }
    .chip-active  { background: var(--ink); color: var(--paper); }
    .queue-table  { width: 100%; border-collapse: collapse; font-size: 13px; }
    .queue-table th { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--rule);
                      font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
                      color: var(--ink-3); font-weight: 500; }
    .queue-row    { cursor: pointer; }
    .queue-row:hover { background: var(--rule); }
    .queue-row td { padding: 10px 12px; border-bottom: 1px solid var(--rule); }
    .ro-link      { color: var(--accent); font-weight: 500; }
    .priority     { font-family: var(--mono); font-size: 12px; }
    .pill         { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; }
    .status-NOT_STARTED { background: #f0f0f0; color: #555; }
    .status-IN_PROGRESS { background: #e8f4fd; color: #1a6bb5; }
    .status-ON_HOLD     { background: #fff3cd; color: #856404; }
    .status-COMPLETED   { background: #d4edda; color: #155724; }
    .overdue      { color: #c0392b; font-weight: 600; }
    .loading, .empty-state, .error-state { text-align: center; padding: 48px 0; color: var(--ink-3); font-size: 14px; }
    .error-state  { color: #c0392b; }
  `],
})
export class DrafterQueueComponent implements OnInit {
  private svc   = inject(DrafterService);
  private router = inject(Router);

  items        = signal<QueueItem[]>([]);
  loading      = signal(true);
  error        = signal<string | null>(null);
  statusFilter = signal<StatusFilter>('ALL');

  filters: { label: string; value: StatusFilter }[] = [
    { label: 'All', value: 'ALL' },
    { label: 'Not Started', value: 'NOT_STARTED' },
    { label: 'In Progress', value: 'IN_PROGRESS' },
    { label: 'On Hold', value: 'ON_HOLD' },
  ];

  filteredItems = computed(() => {
    const f = this.statusFilter();
    return f === 'ALL' ? this.items() : this.items().filter(i => i.draftingStatus === f);
  });

  ngOnInit() { this.load(); }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const items = await this.svc.getQueue();
      this.items.set(items);
    } catch {
      this.error.set('Failed to load queue. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  label(status: string) { return DRAFTER_STATUS_LABELS[status] ?? status; }

  daysUntil(item: QueueItem): number | null {
    if (!item.requiredDate) return null;
    const diff = new Date(item.requiredDate).getTime() - Date.now();
    return Math.ceil(diff / 86_400_000);
  }

  open(id: string) { this.router.navigate(['/drafter/ros', id]); }
}
