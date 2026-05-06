import {
  Component, OnInit, inject, signal, input, output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, ALL_ROLES, UserStationAssignment } from './admin.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-user-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="form-overlay" (click)="onClose()">
      <div class="form-card" (click)="$event.stopPropagation()">
        <div class="form-header">
          <h2 class="form-title">{{ editId() ? 'Edit User' : 'New User' }}</h2>
          <button class="close-btn" (click)="onClose()">✕</button>
        </div>

        @if (error()) {
          <div class="alert-error">{{ error() }}</div>
        }

        <div class="field">
          <label>Full Name *</label>
          <input [(ngModel)]="fullName" placeholder="Full Name" />
        </div>

        @if (!editId()) {
          <div class="field">
            <label>Username *</label>
            <input [(ngModel)]="username" placeholder="username" autocomplete="off" />
          </div>
          <div class="field">
            <label>Password *</label>
            <input type="password" [(ngModel)]="password" placeholder="Password" autocomplete="new-password" />
          </div>
        }

        <div class="field">
          <label>Email</label>
          <input [(ngModel)]="email" placeholder="user@example.com" type="email" />
        </div>

        <div class="field">
          <label>Short Code</label>
          <input [(ngModel)]="shortCode" placeholder="e.g. JD" maxlength="10" />
        </div>

        <div class="field">
          <label>Roles *</label>
          <div class="role-grid">
            @for (r of roles; track r.id) {
              <label class="role-check">
                <input type="checkbox" [checked]="selectedRoleIds().includes(r.id)"
                       (change)="toggleRole(r.id, $event)" />
                {{ r.label }}
              </label>
            }
          </div>
        </div>

        <div class="field">
          <label>Stations</label>
          <div class="station-list">
            @for (s of allStations(); track s.id) {
              <div class="station-row">
                <label class="station-check">
                  <input type="checkbox"
                         [checked]="isStationSelected(s.id)"
                         (change)="toggleStation(s.id, $event)" />
                  {{ s.name }}
                </label>
                @if (isStationSelected(s.id)) {
                  <label class="primary-check">
                    <input type="checkbox"
                           [checked]="isStationPrimary(s.id)"
                           (change)="togglePrimary(s.id, $event)" />
                    Primary
                  </label>
                }
              </div>
            }
            @if (allStations().length === 0) {
              <span class="no-stations">Loading stations…</span>
            }
          </div>
        </div>

        @if (editId() && showReset()) {
          <div class="field">
            <label>New Password (leave blank to keep current)</label>
            <input type="password" [(ngModel)]="newPassword" placeholder="New password" autocomplete="new-password" />
          </div>
        }

        <div class="form-actions">
          <button class="btn-secondary" (click)="onClose()">Cancel</button>
          <button class="btn-primary" (click)="save()" [disabled]="saving()">
            {{ saving() ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .form-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000;
                    display: flex; align-items: center; justify-content: center; }
    .form-card { background: white; border-radius: 12px; padding: 28px; width: 480px; max-height: 90vh;
                 overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
    .form-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .form-title { font-family: var(--display); font-size: 20px; font-weight: 500; color: var(--ink); margin: 0; }
    .close-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--ink-3); padding: 4px; }
    .close-btn:hover { color: var(--ink); }
    .alert-error { background: #fef2f2; color: var(--bad); border-left: 4px solid var(--bad);
                   border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; }
    .field { margin-bottom: 16px; }
    .field label { display: block; font-size: 12px; font-weight: 500; color: var(--ink-3);
                   text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
    .field input { width: 100%; border: 1px solid var(--rule); border-radius: 6px; padding: 8px 12px;
                   font-size: 14px; color: var(--ink); box-sizing: border-box; }
    .field input:focus { outline: none; border-color: var(--ink); }
    .role-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .role-check { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
    .role-check input { width: auto; }
    .station-list { display: flex; flex-direction: column; gap: 6px; max-height: 200px;
                    overflow-y: auto; border: 1px solid var(--rule); border-radius: 6px; padding: 8px 10px; }
    .station-row { display: flex; align-items: center; justify-content: space-between; }
    .station-check { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; flex: 1; }
    .station-check input { width: auto; }
    .primary-check { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--ink-3);
                     cursor: pointer; white-space: nowrap; }
    .primary-check input { width: auto; }
    .no-stations { font-size: 12px; color: var(--ink-3); }
    .form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }
    .btn-primary { background: var(--ink); color: var(--paper); border: none; border-radius: 6px;
                   padding: 9px 20px; font-size: 13px; cursor: pointer; }
    .btn-primary:hover:not(:disabled) { opacity: 0.85; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: white; color: var(--ink); border: 1px solid var(--rule);
                     border-radius: 6px; padding: 9px 20px; font-size: 13px; cursor: pointer; }
    .btn-secondary:hover { background: var(--paper-2); }
  `],
})
export class UserFormComponent implements OnInit {
  private svc = inject(AdminService);

  editId = input<string | null>(null);
  showReset = input(false);
  saved = output<void>();
  closed = output<void>();

  roles = ALL_ROLES;

  fullName    = '';
  username    = '';
  password    = '';
  email       = '';
  shortCode   = '';
  newPassword = '';
  selectedRoleIds    = signal<number[]>([]);
  allStations        = signal<{ id: number; name: string }[]>([]);
  selectedStations   = signal<{ stationId: number; isPrimary: boolean }[]>([]);
  private originalStations: { stationId: number; isPrimary: boolean }[] = [];
  saving = signal(false);
  error  = signal<string | null>(null);

  async ngOnInit() {
    // Load station list (excluding HOSPITAL 95)
    this.svc.listStations().subscribe(list =>
      this.allStations.set(list.filter(s => s.id !== 95).map(s => ({ id: s.id, name: s.name })))
    );

    const id = this.editId();
    if (id) {
      const [u, stationAssignments] = await Promise.all([
        firstValueFrom(this.svc.getUser(id)),
        firstValueFrom(this.svc.getUserStations(id)),
      ]);
      this.fullName  = u.fullName;
      this.email     = u.email ?? '';
      this.shortCode = u.shortCode ?? '';
      this.selectedRoleIds.set(
        ALL_ROLES.filter(r => u.roles.includes(r.code)).map(r => r.id),
      );
      const mapped = stationAssignments.map(s => ({ stationId: s.stationId, isPrimary: s.isPrimary }));
      this.originalStations = mapped;
      this.selectedStations.set([...mapped]);
    }
  }

  toggleRole(id: number, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    const current = this.selectedRoleIds();
    this.selectedRoleIds.set(checked ? [...current, id] : current.filter(x => x !== id));
  }

  isStationSelected(stationId: number) {
    return this.selectedStations().some(s => s.stationId === stationId);
  }

  isStationPrimary(stationId: number) {
    return this.selectedStations().find(s => s.stationId === stationId)?.isPrimary ?? false;
  }

  toggleStation(stationId: number, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      this.selectedStations.update(list => [...list, { stationId, isPrimary: false }]);
    } else {
      this.selectedStations.update(list => list.filter(s => s.stationId !== stationId));
    }
  }

  togglePrimary(stationId: number, event: Event) {
    const isPrimary = (event.target as HTMLInputElement).checked;
    this.selectedStations.update(list =>
      list.map(s => s.stationId === stationId ? { ...s, isPrimary } : s)
    );
  }

  private async syncStations(userId: string) {
    const desired  = this.selectedStations();
    const original = this.originalStations;

    const toAdd = desired.filter(d => {
      const existing = original.find(o => o.stationId === d.stationId);
      return !existing || existing.isPrimary !== d.isPrimary;
    });
    const toRemove = original.filter(o => !desired.find(d => d.stationId === o.stationId));

    for (const s of toAdd)
      await firstValueFrom(this.svc.addTechnician(s.stationId, userId, s.isPrimary));
    for (const s of toRemove)
      await firstValueFrom(this.svc.removeTechnician(s.stationId, userId));
  }

  async save() {
    this.error.set(null);
    const id = this.editId();
    if (!this.fullName.trim()) { this.error.set('Full name is required.'); return; }
    if (!id && !this.username.trim()) { this.error.set('Username is required.'); return; }
    if (!id && !this.password) { this.error.set('Password is required.'); return; }
    if (this.selectedRoleIds().length === 0) { this.error.set('At least one role is required.'); return; }

    this.saving.set(true);
    try {
      if (id) {
        await firstValueFrom(this.svc.updateUser(id, {
          fullName:  this.fullName.trim(),
          email:     this.email.trim() || null,
          shortCode: this.shortCode.trim() || null,
          roleIds:   this.selectedRoleIds(),
        }));
        await this.syncStations(id);
        if (this.newPassword)
          await firstValueFrom(this.svc.resetPassword(id, this.newPassword));
      } else {
        const { id: newId } = await firstValueFrom(this.svc.createUser({
          username:  this.username.trim(),
          fullName:  this.fullName.trim(),
          email:     this.email.trim() || null,
          shortCode: this.shortCode.trim() || null,
          password:  this.password,
          roleIds:   this.selectedRoleIds(),
        }));
        await this.syncStations(newId);
      }
      this.saved.emit();
    } catch (e: any) {
      this.error.set(e?.error?.message ?? 'Save failed.');
      this.saving.set(false);
    }
  }

  onClose() {
    this.closed.emit();
  }
}
