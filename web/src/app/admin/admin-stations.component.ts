import {
  Component, OnInit, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AdminService, AdminUserSummary, StationInfo } from './admin.service';

@Component({
  selector: 'app-admin-stations',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page-header">
      <h1 class="page-title">Station Rosters</h1>
    </div>

    @if (loading()) {
      <div class="loading">Loading…</div>
    } @else {
      <div class="station-grid">
        @for (s of stations(); track s.id) {
          <div class="station-card" [class.editing]="editingId() === s.id">
            <div class="card-header">
              <div>
                <div class="station-name">{{ s.name }}</div>
                <div class="station-code">{{ s.code }}</div>
              </div>
              @if (editingId() !== s.id) {
                <button class="btn-sm" (click)="startEdit(s)">Edit</button>
              } @else {
                <div class="edit-actions">
                  <button class="btn-sm" (click)="saveEdit(s)">Save</button>
                  <button class="btn-sm" (click)="cancelEdit()">Cancel</button>
                </div>
              }
            </div>

            <!-- Owner row -->
            <div class="owner-row">
              <span class="label">Owner</span>
              @if (editingId() === s.id) {
                <select [(ngModel)]="draftOwner" class="owner-select">
                  <option [value]="null">— Unassigned —</option>
                  @for (u of allUsers(); track u.id) {
                    <option [value]="u.id">{{ u.fullName }}</option>
                  }
                </select>
              } @else {
                <span class="owner-name">{{ s.ownerName ?? 'Unassigned' }}</span>
              }
            </div>

            <!-- Technicians -->
            <div class="tech-section">
              <span class="label">Technicians</span>
              <div class="tech-list">
                @for (t of s.technicians; track t.userId) {
                  <div class="tech-chip">
                    <span>{{ t.fullName }}</span>
                    @if (t.isPrimary) { <span class="primary-badge">Primary</span> }
                    @if (editingId() === s.id) {
                      <button class="remove-btn" (click)="removeTech(s, t.userId)">✕</button>
                    }
                  </div>
                }
              </div>

              @if (editingId() === s.id) {
                <div class="add-tech-row">
                  <select [(ngModel)]="addUserId" class="add-select">
                    <option value="">Add technician…</option>
                    @for (u of eligibleUsers(s); track u.id) {
                      <option [value]="u.id">{{ u.fullName }}</option>
                    }
                  </select>
                  <label class="primary-check">
                    <input type="checkbox" [(ngModel)]="addIsPrimary" />
                    Primary
                  </label>
                  <button class="btn-sm" (click)="addTech(s)" [disabled]="!addUserId">Add</button>
                </div>
              }
            </div>

            @if (stationError() === s.id) {
              <div class="card-error">Save failed. Check console.</div>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .page-header { margin-bottom: 20px; }
    .page-title { font-family: var(--display); font-size: 24px; font-weight: 500; color: var(--ink); margin: 0; }
    .loading { padding: 40px; text-align: center; color: var(--ink-3); }
    .station-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
    .station-card { background: white; border: 0.5px solid var(--rule); border-radius: 12px; padding: 20px; }
    .station-card.editing { border-color: var(--ink); box-shadow: 0 0 0 2px rgba(26,26,26,0.1); }
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
    .station-name { font-size: 15px; font-weight: 600; color: var(--ink); }
    .station-code { font-family: var(--mono); font-size: 11px; color: var(--ink-3); margin-top: 2px; }
    .edit-actions { display: flex; gap: 6px; }
    .btn-sm { font-size: 12px; padding: 4px 10px; border-radius: 5px; border: 1px solid var(--rule);
              background: white; cursor: pointer; }
    .btn-sm:hover { background: var(--paper-2); }
    .btn-sm:disabled { opacity: 0.4; cursor: not-allowed; }
    .owner-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .label { font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
             color: var(--ink-3); flex-shrink: 0; width: 70px; }
    .owner-name { font-size: 13px; color: var(--ink); }
    .owner-select, .add-select { border: 1px solid var(--rule); border-radius: 5px; padding: 5px 8px;
                                  font-size: 12px; flex: 1; }
    .tech-section { margin-top: 8px; }
    .tech-list { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 10px; }
    .tech-chip { display: flex; align-items: center; gap: 4px; background: var(--paper-2);
                 border-radius: 6px; padding: 4px 8px; font-size: 12px; }
    .primary-badge { background: #fef9c3; color: #713f12; font-size: 10px; padding: 1px 5px;
                     border-radius: 3px; font-family: var(--mono); }
    .remove-btn { background: none; border: none; cursor: pointer; color: var(--ink-3); font-size: 12px;
                  padding: 0 2px; }
    .remove-btn:hover { color: var(--bad); }
    .add-tech-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    .primary-check { display: flex; align-items: center; gap: 4px; font-size: 12px; flex-shrink: 0; }
    .card-error { margin-top: 8px; font-size: 12px; color: var(--bad); }
  `],
})
export class AdminStationsComponent implements OnInit {
  private svc = inject(AdminService);

  stations   = signal<StationInfo[]>([]);
  allUsers   = signal<AdminUserSummary[]>([]);
  loading    = signal(true);

  editingId   = signal<number | null>(null);
  draftOwner  = signal<string | null>(null);
  addUserId   = '';
  addIsPrimary = false;
  stationError = signal<number | null>(null);

  async ngOnInit() {
    const [stationsRaw, usersRes] = await Promise.all([
      firstValueFrom(this.svc.listStations()),
      firstValueFrom(this.svc.listUsers('', '', 'true', '', 1, 200)),
    ]);
    // Filter out station 95 (internal/system station) per backlog spec
    this.stations.set((stationsRaw as any[]).filter((s: any) => s.id !== 95).map((s: any) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      ownerUserId: s.ownerUserId ?? null,
      ownerName: s.ownerName ?? null,
      technicians: (s.technicians ?? []).map((t: any) => ({
        userId: t.userId,
        fullName: t.fullName,
        isPrimary: t.isPrimary,
        skillLevel: t.skillLevel,
      })),
    })));
    this.allUsers.set(usersRes.items);
    this.loading.set(false);
  }

  startEdit(s: StationInfo) {
    this.editingId.set(s.id);
    this.draftOwner.set(s.ownerUserId);
    this.addUserId = '';
    this.addIsPrimary = false;
    this.stationError.set(null);
  }

  cancelEdit() {
    this.editingId.set(null);
  }

  eligibleUsers(s: StationInfo): AdminUserSummary[] {
    const assigned = new Set(s.technicians.map(t => t.userId));
    return this.allUsers().filter(u => !assigned.has(u.id));
  }

  async addTech(s: StationInfo) {
    if (!this.addUserId) return;
    try {
      await firstValueFrom(this.svc.addTechnician(s.id, this.addUserId, this.addIsPrimary));
      const u = this.allUsers().find(x => x.id === this.addUserId);
      if (u) {
        s.technicians.push({ userId: u.id, fullName: u.fullName, isPrimary: this.addIsPrimary, skillLevel: 3 });
      }
      this.addUserId = '';
      this.addIsPrimary = false;
      this.stations.update(list => [...list]);
    } catch {
      this.stationError.set(s.id);
    }
  }

  async removeTech(s: StationInfo, userId: string) {
    try {
      await firstValueFrom(this.svc.removeTechnician(s.id, userId));
      s.technicians = s.technicians.filter(t => t.userId !== userId);
      this.stations.update(list => [...list]);
    } catch {
      this.stationError.set(s.id);
    }
  }

  async saveEdit(s: StationInfo) {
    try {
      await firstValueFrom(this.svc.changeOwner(s.id, this.draftOwner()));
      s.ownerUserId = this.draftOwner();
      const ownerUser = this.allUsers().find(u => u.id === this.draftOwner());
      s.ownerName = ownerUser?.fullName ?? null;
      this.stations.update(list => [...list]);
      this.editingId.set(null);
    } catch {
      this.stationError.set(s.id);
    }
  }
}
