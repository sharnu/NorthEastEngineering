import { Component, OnInit, inject, signal, computed, output } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AdminService, CustomerSummary } from './admin.service';

@Component({
  selector: 'app-customers-list',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  template: `
    <div class="page-header">
      <h1 class="page-title">Customer Management</h1>
      <button class="btn-primary" (click)="openCreate.emit()">+ New Customer</button>
    </div>

    <!-- Filters -->
    <div class="filters">
      <input class="search-input" [(ngModel)]="searchQ"
             (ngModelChange)="onSearchChange()"
             placeholder="Search name, code or email…" />
      <select [(ngModel)]="filterActive" (ngModelChange)="onFilterChange()">
        <option value="">All statuses</option>
        <option value="true">Active</option>
        <option value="false">Inactive</option>
      </select>
    </div>

    <!-- Table -->
    @if (loading()) {
      <div class="loading">Loading…</div>
    } @else if (customers().length === 0) {
      <div class="empty">No customers found.</div>
    } @else {
      <table class="data-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Customer No</th>
            <th>Contact</th>
            <th>Active ROs</th>
            <th>Last RO</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (c of customers(); track c.id) {
            <tr [class.inactive-row]="!c.isActive" (click)="openDetail.emit(c)">
              <td class="mono">{{ c.code ?? '—' }}</td>
              <td class="name-cell">{{ c.name }}</td>
              <td class="mono">{{ c.customerNo ?? '—' }}</td>
              <td class="contact-cell">{{ c.contactEmail ?? c.contactPhone ?? '—' }}</td>
              <td class="count-cell">{{ c.activeRoCount }}</td>
              <td class="date-cell">{{ c.lastRoDate ? (c.lastRoDate | date:'dd MMM yy') : '—' }}</td>
              <td>
                <span class="status-badge" [class.active]="c.isActive">
                  {{ c.isActive ? 'Active' : 'Inactive' }}
                </span>
              </td>
              <td class="action-cell" (click)="$event.stopPropagation()">
                <button class="btn-sm" (click)="openDetail.emit(c)">View</button>
              </td>
            </tr>
          }
        </tbody>
      </table>

      <!-- Pagination -->
      <div class="pagination">
        <button [disabled]="page() <= 1" (click)="prevPage()">‹ Prev</button>
        <span>Page {{ page() }} of {{ totalPages() }}</span>
        <button [disabled]="page() >= totalPages()" (click)="nextPage()">Next ›</button>
      </div>
    }
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .page-title  { font-family: var(--display); font-size: 24px; font-weight: 500; color: var(--ink); margin: 0; }
    .filters { display: flex; gap: 10px; margin-bottom: 16px; }
    .search-input { flex: 1; min-width: 200px; border: 1px solid var(--rule); border-radius: 6px;
                    padding: 8px 12px; font-size: 13px; }
    .filters select { border: 1px solid var(--rule); border-radius: 6px; padding: 8px 12px; font-size: 13px; }
    .loading, .empty { padding: 40px; text-align: center; color: var(--ink-3); font-size: 14px; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .data-table th { text-align: left; font-family: var(--mono); font-size: 11px; text-transform: uppercase;
                     letter-spacing: 0.08em; color: var(--ink-3); border-bottom: 1px solid var(--rule);
                     padding: 8px 12px; font-weight: 500; }
    .data-table td { padding: 10px 12px; border-bottom: 0.5px solid var(--rule); vertical-align: middle; }
    .data-table tr:hover td { background: var(--paper-2); cursor: pointer; }
    .inactive-row td { opacity: 0.55; }
    .mono  { font-family: var(--mono); font-size: 12px; }
    .name-cell { font-weight: 500; color: var(--ink); }
    .contact-cell { color: var(--ink-3); font-size: 12px; }
    .count-cell { text-align: center; font-family: var(--mono); }
    .date-cell  { color: var(--ink-3); font-size: 12px; font-family: var(--mono); }
    .status-badge { font-size: 11px; padding: 3px 8px; border-radius: 10px;
                    background: #fee2e2; color: var(--bad); font-family: var(--mono); }
    .status-badge.active { background: #dcfce7; color: var(--good); }
    .action-cell { white-space: nowrap; }
    .btn-sm { font-size: 12px; padding: 4px 10px; border-radius: 5px; border: 1px solid var(--rule);
              background: white; cursor: pointer; margin-left: 4px; }
    .btn-sm:hover { background: var(--paper-2); }
    .pagination { display: flex; align-items: center; gap: 12px; justify-content: flex-end;
                  margin-top: 16px; font-size: 13px; }
    .pagination button { border: 1px solid var(--rule); background: white; border-radius: 5px;
                         padding: 5px 12px; cursor: pointer; font-size: 13px; }
    .pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-primary { background: var(--ink); color: var(--paper); border: none; border-radius: 6px;
                   padding: 9px 18px; font-size: 13px; cursor: pointer; }
    .btn-primary:hover { opacity: 0.85; }
  `],
})
export class CustomersListComponent implements OnInit {
  private svc = inject(AdminService);

  openCreate = output<void>();
  openDetail = output<CustomerSummary>();

  searchQ      = '';
  filterActive = '';
  page         = signal(1);
  pageSize     = 50;

  customers  = signal<CustomerSummary[]>([]);
  totalCount = signal(0);
  loading    = signal(true);

  totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize)));

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit() { this.load(); }

  onSearchChange() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.page.set(1); this.load(); }, 250);
  }

  onFilterChange() { this.page.set(1); this.load(); }

  prevPage() { this.page.update(p => p - 1); this.load(); }
  nextPage()  { this.page.update(p => p + 1); this.load(); }

  load() {
    this.loading.set(true);
    this.svc.listCustomers(this.searchQ, this.filterActive, this.page(), this.pageSize)
      .subscribe({
        next: res => {
          this.customers.set(res.items);
          this.totalCount.set(res.totalCount);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }
}
