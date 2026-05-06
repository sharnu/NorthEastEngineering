import {
  Component, OnInit, inject, signal, computed,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AdminService, AdminUserSummary, ALL_ROLES, ActivityResponse, StationInfo } from './admin.service';
import { UserFormComponent } from './user-form.component';

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, UserFormComponent],
  template: `
    <div class="page-header">
      <h1 class="page-title">User Management</h1>
      <button class="btn-primary" (click)="openCreate()">+ New User</button>
    </div>

    <!-- Filters -->
    <div class="filters">
      <input class="search-input" [(ngModel)]="searchQ"
             (ngModelChange)="onSearchChange()"
             placeholder="Search name, username or email…" />
      <select [(ngModel)]="filterRole" (ngModelChange)="onFilterChange()">
        <option value="">All roles</option>
        @for (r of allRoles; track r.id) {
          <option [value]="r.code">{{ r.label }}</option>
        }
      </select>
      <select [(ngModel)]="filterActive" (ngModelChange)="onFilterChange()">
        <option value="">All statuses</option>
        <option value="true">Active</option>
        <option value="false">Inactive</option>
      </select>
      <select [(ngModel)]="filterStation" (ngModelChange)="onFilterChange()">
        <option value="">All stations</option>
        @for (s of stations(); track s.id) {
          <option [value]="s.id">{{ s.name }}</option>
        }
      </select>
    </div>

    <!-- Table -->
    @if (loading()) {
      <div class="loading">Loading…</div>
    } @else if (users().length === 0) {
      <div class="empty">No users found.</div>
    } @else {
      <table class="user-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Username</th>
            <th>Email</th>
            <th>Roles</th>
            <th>Stations</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (u of users(); track u.id) {
            <tr [class.inactive-row]="!u.isActive" (click)="openDetail(u)">
              <td class="name-cell">{{ u.fullName }}</td>
              <td class="mono">{{ u.username }}</td>
              <td class="email-cell">{{ u.email ?? '—' }}</td>
              <td>
                <div class="pill-list">
                  @for (r of u.roles; track r) {
                    <span class="pill pill-role">{{ r }}</span>
                  }
                </div>
              </td>
              <td>
                <div class="pill-list">
                  @for (s of u.stations; track s) {
                    <span class="pill pill-station">{{ s }}</span>
                  }
                </div>
              </td>
              <td>
                <span class="status-badge" [class.active]="u.isActive">
                  {{ u.isActive ? 'Active' : 'Inactive' }}
                </span>
              </td>
              <td class="action-cell" (click)="$event.stopPropagation()">
                <button class="btn-sm" (click)="openEdit(u)">Edit</button>
                @if (u.isActive) {
                  <button class="btn-sm btn-danger" (click)="deactivate(u)">Deactivate</button>
                } @else {
                  <button class="btn-sm" (click)="activate(u)">Activate</button>
                }
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

    <!-- Detail panel -->
    @if (detailUser()) {
      <div class="detail-overlay" (click)="detailUser.set(null)">
        <div class="detail-panel" (click)="$event.stopPropagation()">
          <div class="detail-header">
            <div>
              <h2 class="detail-name">{{ detailUser()!.fullName }}</h2>
              <span class="detail-username">{{ detailUser()!.username }}</span>
            </div>
            <button class="close-btn" (click)="detailUser.set(null)">✕</button>
          </div>

          @if (activity()) {
            <div class="activity-counts">
              <div class="count-item">
                <span class="count-val">{{ activity()!.counts.tasksCompleted }}</span>
                <span class="count-lbl">Tasks (30d)</span>
              </div>
              <div class="count-item">
                <span class="count-val">{{ activity()!.counts.rosCreated }}</span>
                <span class="count-lbl">ROs created (30d)</span>
              </div>
              <div class="count-item">
                <span class="count-val">{{ activity()!.counts.lastLoginAt ? (activity()!.counts.lastLoginAt | date:'dd MMM') : '—' }}</span>
                <span class="count-lbl">Last login</span>
              </div>
            </div>

            <h3 class="timeline-title">Recent Activity</h3>
            @if (activity()!.events.length === 0) {
              <p class="no-activity">No activity in the last 30 days.</p>
            }
            <div class="timeline">
              @for (ev of activity()!.events; track ev.occurredAt) {
                <div class="timeline-item">
                  <div class="timeline-dot"></div>
                  <div class="timeline-content">
                    <span class="ev-type">{{ ev.eventType }}</span>
                    <span class="ev-date">{{ ev.occurredAt | date:'dd MMM HH:mm' }}</span>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      </div>
    }

    <!-- Create / Edit form -->
    @if (showForm()) {
      <app-user-form
        [editId]="editingId()"
        [showReset]="true"
        (saved)="onFormSaved()"
        (closed)="showForm.set(false)" />
    }

    @if (actionError()) {
      <div class="toast-error">{{ actionError() }}</div>
    }
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .page-title { font-family: var(--display); font-size: 24px; font-weight: 500; color: var(--ink); margin: 0; }
    .filters { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
    .search-input { flex: 1; min-width: 200px; border: 1px solid var(--rule); border-radius: 6px;
                    padding: 8px 12px; font-size: 13px; }
    .filters select { border: 1px solid var(--rule); border-radius: 6px; padding: 8px 12px; font-size: 13px; }
    .loading, .empty { padding: 40px; text-align: center; color: var(--ink-3); font-size: 14px; }
    .user-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .user-table th { text-align: left; font-family: var(--mono); font-size: 11px; text-transform: uppercase;
                     letter-spacing: 0.08em; color: var(--ink-3); border-bottom: 1px solid var(--rule);
                     padding: 8px 12px; font-weight: 500; }
    .user-table td { padding: 10px 12px; border-bottom: 0.5px solid var(--rule); vertical-align: middle; }
    .user-table tr:hover td { background: var(--paper-2); cursor: pointer; }
    .inactive-row td { opacity: 0.55; }
    .name-cell { font-weight: 500; color: var(--ink); }
    .mono { font-family: var(--mono); font-size: 12px; }
    .email-cell { color: var(--ink-3); }
    .pill-list { display: flex; flex-wrap: wrap; gap: 4px; }
    .pill { font-size: 10px; padding: 2px 7px; border-radius: 10px; font-family: var(--mono); }
    .pill-role { background: #ede9fe; color: #5b21b6; }
    .pill-station { background: #e0f2fe; color: #0369a1; }
    .status-badge { font-size: 11px; padding: 3px 8px; border-radius: 10px;
                    background: #fee2e2; color: var(--bad); font-family: var(--mono); }
    .status-badge.active { background: #dcfce7; color: var(--good); }
    .action-cell { white-space: nowrap; }
    .btn-sm { font-size: 12px; padding: 4px 10px; border-radius: 5px; border: 1px solid var(--rule);
              background: white; cursor: pointer; margin-left: 4px; }
    .btn-sm:hover { background: var(--paper-2); }
    .btn-danger { border-color: rgba(185,28,28,0.3); color: var(--bad); }
    .btn-danger:hover { background: #fef2f2; }
    .pagination { display: flex; align-items: center; gap: 12px; justify-content: flex-end;
                  margin-top: 16px; font-size: 13px; }
    .pagination button { border: 1px solid var(--rule); background: white; border-radius: 5px;
                         padding: 5px 12px; cursor: pointer; font-size: 13px; }
    .pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-primary { background: var(--ink); color: var(--paper); border: none; border-radius: 6px;
                   padding: 9px 18px; font-size: 13px; cursor: pointer; }
    .btn-primary:hover { opacity: 0.85; }

    /* Detail panel */
    .detail-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 500;
                      display: flex; justify-content: flex-end; }
    .detail-panel { width: 380px; background: white; height: 100%; overflow-y: auto;
                    padding: 28px; box-shadow: -4px 0 20px rgba(0,0,0,0.12); }
    .detail-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
    .detail-name { font-family: var(--display); font-size: 20px; font-weight: 500; margin: 0 0 4px; }
    .detail-username { font-family: var(--mono); font-size: 12px; color: var(--ink-3); }
    .close-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--ink-3); }
    .activity-counts { display: flex; gap: 16px; margin-bottom: 24px; }
    .count-item { flex: 1; text-align: center; border: 0.5px solid var(--rule);
                  border-radius: 8px; padding: 12px 8px; }
    .count-val { display: block; font-family: var(--display); font-size: 24px; font-weight: 500; }
    .count-lbl { display: block; font-family: var(--mono); font-size: 10px; text-transform: uppercase;
                 letter-spacing: 0.08em; color: var(--ink-3); margin-top: 4px; }
    .timeline-title { font-family: var(--mono); font-size: 11px; text-transform: uppercase;
                      letter-spacing: 0.1em; color: var(--ink-3); margin: 0 0 12px; }
    .no-activity { font-size: 13px; color: var(--ink-3); }
    .timeline { display: flex; flex-direction: column; gap: 0; }
    .timeline-item { display: flex; gap: 12px; align-items: flex-start; padding: 8px 0;
                     border-bottom: 0.5px solid var(--rule); }
    .timeline-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ink-3);
                    flex-shrink: 0; margin-top: 4px; }
    .timeline-content { display: flex; justify-content: space-between; flex: 1; }
    .ev-type { font-size: 13px; color: var(--ink); }
    .ev-date { font-family: var(--mono); font-size: 11px; color: var(--ink-3); }

    .toast-error { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                   background: var(--bad); color: white; padding: 10px 20px; border-radius: 6px;
                   font-size: 13px; z-index: 2000; }
  `],
})
export class AdminUsersComponent implements OnInit {
  private svc = inject(AdminService);

  allRoles = ALL_ROLES;

  // Filters (changes trigger reload)
  searchQ      = '';
  filterRole   = '';
  filterActive = '';
  filterStation = '';
  page         = signal(1);
  pageSize     = 20;

  stations = signal<{ id: number; name: string }[]>([]);

  users      = signal<AdminUserSummary[]>([]);
  totalCount = signal(0);
  loading    = signal(true);
  actionError = signal<string | null>(null);

  totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize)));

  showForm   = signal(false);
  editingId  = signal<string | null>(null);

  detailUser = signal<AdminUserSummary | null>(null);
  activity   = signal<ActivityResponse | null>(null);

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {}

  ngOnInit() {
    this.load();
    this.svc.listStations().subscribe(list =>
      this.stations.set(
        list.filter(s => s.id !== 95).map(s => ({ id: s.id, name: s.name }))
      )
    );
  }

  onSearchChange() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page.set(1);
      this.load();
    }, 250);
  }

  onFilterChange() {
    this.page.set(1);
    this.load();
  }

  prevPage() { this.page.update(p => p - 1); this.load(); }
  nextPage()  { this.page.update(p => p + 1); this.load(); }

  load() {
    this.loading.set(true);
    this.svc.listUsers(this.searchQ, this.filterRole, this.filterActive, this.filterStation, this.page(), this.pageSize)
      .subscribe({
        next: res => {
          this.users.set(res.items);
          this.totalCount.set(res.totalCount);
          this.loading.set(false);
        },
        error: () => { this.loading.set(false); },
      });
  }

  openCreate() {
    this.editingId.set(null);
    this.showForm.set(true);
  }

  openEdit(u: AdminUserSummary) {
    this.editingId.set(u.id);
    this.showForm.set(true);
  }

  async openDetail(u: AdminUserSummary) {
    this.detailUser.set(u);
    this.activity.set(null);
    const act = await firstValueFrom(this.svc.getActivity(u.id));
    this.activity.set(act);
  }

  onFormSaved() {
    this.showForm.set(false);
    this.load();
  }

  async deactivate(u: AdminUserSummary) {
    this.actionError.set(null);
    try {
      await firstValueFrom(this.svc.deactivate(u.id));
      this.load();
    } catch (e: any) {
      this.actionError.set(e?.error?.message ?? 'Deactivate failed.');
      setTimeout(() => this.actionError.set(null), 4000);
    }
  }

  async activate(u: AdminUserSummary) {
    this.actionError.set(null);
    try {
      await firstValueFrom(this.svc.activate(u.id));
      this.load();
    } catch {
      this.actionError.set('Activate failed.');
      setTimeout(() => this.actionError.set(null), 4000);
    }
  }
}
