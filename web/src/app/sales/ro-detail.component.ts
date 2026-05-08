import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../core/auth.service';

interface RoTask {
  id: string;
  sequence: number;
  operationId: number;
  operationName: string;
  stationId: number;
  stationName: string;
  estimatedHours: number;
  actualHours: number;
  status: string;
  hasWork: boolean;
}

interface RoDetail {
  id: string;
  roNumber: string;
  status: string;
  priority: number;
  notes: string | null;
  // Vehicle
  vin: string | null;
  rego: string | null;
  chassisNumber: string | null;
  engineNumber: string | null;
  make: string | null;
  model: string | null;
  paintColour: string | null;
  buildDate: string | null;
  keyTagNo: string | null;
  odometer: number | null;
  // Dates
  expectedInDate: string | null;
  requiredDate: string | null;
  deliveryDate: string | null;
  // Source document
  sourceRoNumber: string | null;
  sourceRoDate: string | null;
  customerNo: string | null;
  customerAbn: string | null;
  ownerName: string | null;
  customerOrderNo: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  businessPhone: string | null;
  createdAt: string;
  totalEstimatedHours: number;
  customer: { id: string; name: string };
  jobTypeId: number;
  jobType: string;
  bodyType: string;
  sourcePdfUrl: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  cancelledByName: string | null;
  reopenedAt: string | null;
  tasks: RoTask[];
}

interface OperationItem { id: number; code: string; canonicalName: string; defaultStationId: number; typicalHours: number | null; }
interface StationItem   { id: number; code: string; name: string; }
interface CustomerItem  { id: string; code: string; name: string; }
interface JobTypeItem   { id: number; code: string; name: string; }
interface KanbanStage   { id: number; code: string; name: string; isTerminal: boolean; }

@Component({
  selector: 'app-ro-detail',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule],
  template: `
    <div class="topbar">
      <div class="brand">
        <img class="brand-logo" src="assets/nee-logo.png" alt="North East Engineering" />
        <span class="brand-sub">Production Platform</span>
      </div>
      <div class="topbar-right">
        <a class="back-link" (click)="router.navigate(['/sales/ros'])">&#8592; Repair Orders</a>
        @if (user(); as u) {
          <span class="user-label">{{ u.fullName }}</span>
        }
        <button class="logout" (click)="logout()">Sign out</button>
      </div>
    </div>

    @if (toast()) {
      <div class="toast" (click)="toast.set(null)">{{ toast() }}</div>
    }

    <!-- ── Cancel modal ─────────────────────────────────────────────────── -->
    @if (showCancelModal()) {
      <div class="modal-overlay" (click)="showCancelModal.set(false)">
        <div class="modal-card" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3 class="modal-title">Cancel Repair Order</h3>
            <button class="close-btn" (click)="showCancelModal.set(false)">✕</button>
          </div>
          @if (cancelError()) {
            <div class="alert-error">{{ cancelError() }}</div>
          }
          <div class="field">
            <label>Reason *</label>
            <textarea [(ngModel)]="cancelReason" rows="3"
                      placeholder="Why is this RO being cancelled? (min 10 characters)"></textarea>
          </div>
          @if (hasChassisAllocated()) {
            <div class="field-checkbox">
              <input type="checkbox" id="releaseChk" [(ngModel)]="releaseChassis" />
              <label for="releaseChk">Release chassis allocation</label>
            </div>
          }
          <div class="modal-actions">
            <button class="btn-secondary" (click)="showCancelModal.set(false)">Cancel</button>
            <button class="btn-danger" [disabled]="cancelSaving()" (click)="doCancel()">
              {{ cancelSaving() ? 'Cancelling…' : 'Yes, cancel RO' }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ── Override stage modal ──────────────────────────────────────────── -->
    @if (showOverrideModal()) {
      <div class="modal-overlay" (click)="showOverrideModal.set(false)">
        <div class="modal-card" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3 class="modal-title">Override Kanban Stage</h3>
            <button class="close-btn" (click)="showOverrideModal.set(false)">✕</button>
          </div>
          @if (overrideError()) {
            <div class="alert-error">{{ overrideError() }}</div>
          }
          <div class="field">
            <label>Target Stage</label>
            <select [(ngModel)]="overrideStageId">
              @for (s of kanbanStages(); track s.id) {
                <option [value]="s.id">{{ s.name }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label>Reason *</label>
            <textarea [(ngModel)]="overrideReason" rows="2"
                      placeholder="Why is this stage being overridden? (min 10 characters)"></textarea>
          </div>
          <div class="modal-actions">
            <button class="btn-secondary" (click)="showOverrideModal.set(false)">Cancel</button>
            <button class="btn-primary" [disabled]="overrideSaving()" (click)="doOverrideStage()">
              {{ overrideSaving() ? 'Saving…' : 'Override Stage' }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ── Add task modal ───────────────────────────────────────────────── -->
    @if (showAddTaskModal()) {
      <div class="modal-overlay" (click)="showAddTaskModal.set(false)">
        <div class="modal-card" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3 class="modal-title">Add Task</h3>
            <button class="close-btn" (click)="showAddTaskModal.set(false)">✕</button>
          </div>
          @if (addTaskError()) {
            <div class="alert-error">{{ addTaskError() }}</div>
          }
          <div class="field">
            <label>Operation *</label>
            <select [(ngModel)]="addTaskOpId" (ngModelChange)="onOpChange($event)">
              <option value="">— select —</option>
              @for (op of operations(); track op.id) {
                <option [value]="op.id">{{ op.code }} — {{ op.canonicalName }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label>Station</label>
            <select [(ngModel)]="addTaskStationId">
              @for (s of stations(); track s.id) {
                <option [value]="s.id">{{ s.name }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label>Estimated Hours</label>
            <input type="number" [(ngModel)]="addTaskHours" min="0.25" step="0.25" />
          </div>
          <div class="field">
            <label>Notes</label>
            <textarea [(ngModel)]="addTaskNotes" rows="2" placeholder="Optional notes…"></textarea>
          </div>
          <div class="modal-actions">
            <button class="btn-secondary" (click)="showAddTaskModal.set(false)">Cancel</button>
            <button class="btn-primary" [disabled]="addTaskSaving()" (click)="doAddTask()">
              {{ addTaskSaving() ? 'Adding…' : 'Add Task' }}
            </button>
          </div>
        </div>
      </div>
    }

    <main class="stage">
      @if (loading()) {
        <div class="loading">Loading&#8230;</div>
      } @else if (error()) {
        <div class="alert-error">{{ error() }}</div>
      } @else if (ro()) {
        <!-- ── Cancellation banner ─────────────────────────────────────── -->
        @if (ro()!.status === 'CANCELLED') {
          <div class="cancel-banner">
            <div class="cancel-banner-body">
              <strong>This RO was cancelled</strong>
              @if (ro()!.cancellationReason) { — {{ ro()!.cancellationReason }} }
              @if (ro()!.cancelledByName) { <span class="cancel-meta">by {{ ro()!.cancelledByName }}</span> }
              @if (ro()!.cancelledAt) { <span class="cancel-meta">on {{ ro()!.cancelledAt | date:'dd MMM yyyy' }}</span> }
            </div>
            @if (isAdmin()) {
              <button class="btn-reopen" [disabled]="reopenSaving()" (click)="doReopen()">
                {{ reopenSaving() ? 'Reopening…' : 'Reopen RO' }}
              </button>
            }
          </div>
        }

        <div class="scene-header">
          <div class="scene-title-row">
            <h1 class="scene-title">{{ ro()!.roNumber }} &#183; {{ ro()!.customer.name }}</h1>
            <span [class]="statusClass(ro()!.status)">{{ ro()!.status }}</span>
            @if (!isTerminalStatus()) {
              @if (!editMode()) {
                <button class="btn-sm btn-edit" (click)="enterEdit()">Edit</button>
              }
              @if (isSupervisor() || isAdmin()) {
                <button class="btn-sm btn-override" (click)="openOverrideModal()">Override Stage</button>
              }
            }
          </div>
          <div class="scene-meta">
            {{ ro()!.jobType }} &#183; {{ ro()!.bodyType }} &#183;
            {{ ro()!.totalEstimatedHours | number:'1.1-1' }}h estimated &#183;
            {{ ro()!.tasks.length }} tasks
            @if (ro()!.sourcePdfUrl) {
              &#183; <a [href]="ro()!.sourcePdfUrl!" target="_blank" class="pdf-link">View source PDF &#8599;</a>
            }
          </div>
        </div>

        @if (!editMode()) {
          <!-- ── Read mode ──────────────────────────────────────────────── -->
          <div class="three-col">
            <!-- Column 1: Customer & Source RO -->
            <section class="panel">
              <h2 class="panel-title">Customer &amp; Source RO</h2>
              <dl class="detail-list">
                <dt>Customer</dt><dd>{{ ro()!.customer.name }}</dd>
                <dt>Job Type</dt><dd>{{ ro()!.jobType }}</dd>
                @if (ro()!.customerNo) { <dt>Customer No</dt><dd>{{ ro()!.customerNo }}</dd> }
                @if (ro()!.customerAbn) { <dt>ABN</dt><dd>{{ ro()!.customerAbn }}</dd> }
                @if (ro()!.ownerName) { <dt>Owner</dt><dd>{{ ro()!.ownerName }}</dd> }
                @if (ro()!.customerOrderNo) { <dt>C/Order No</dt><dd>{{ ro()!.customerOrderNo }}</dd> }
                @if (ro()!.contactPhone) { <dt>Mobile</dt><dd>{{ ro()!.contactPhone }}</dd> }
                @if (ro()!.businessPhone) { <dt>Business Ph</dt><dd>{{ ro()!.businessPhone }}</dd> }
                @if (ro()!.contactEmail) { <dt>Email</dt><dd>{{ ro()!.contactEmail }}</dd> }
                @if (ro()!.sourceRoNumber) { <dt>Source RO</dt><dd>{{ ro()!.sourceRoNumber }}</dd> }
                @if (ro()!.sourceRoDate) { <dt>Source RO Date</dt><dd>{{ ro()!.sourceRoDate | date:'dd MMM yyyy' }}</dd> }
                @if (ro()!.requiredDate) { <dt>Required Date</dt><dd>{{ ro()!.requiredDate | date:'dd MMM yyyy' }}</dd> }
                @if (ro()!.expectedInDate) { <dt>Expected In</dt><dd>{{ ro()!.expectedInDate | date:'dd MMM yyyy' }}</dd> }
                @if (ro()!.deliveryDate) { <dt>Delivery Date</dt><dd>{{ ro()!.deliveryDate | date:'dd MMM yyyy' }}</dd> }
                <dt>Priority</dt><dd><span [class]="priorityClass(ro()!.priority)">{{ priorityLabel(ro()!.priority) }}</span></dd>
                <dt>Created</dt><dd>{{ ro()!.createdAt | date:'dd MMM yyyy, HH:mm' }}</dd>
              </dl>
            </section>

            <!-- Column 2: Vehicle -->
            <section class="panel">
              <h2 class="panel-title">Vehicle</h2>
              <dl class="detail-list">
                @if (ro()!.rego) { <dt>Rego</dt><dd>{{ ro()!.rego }}</dd> }
                @if (ro()!.vin) { <dt>VIN</dt><dd>{{ ro()!.vin }}</dd> }
                @if (ro()!.chassisNumber) { <dt>Chassis No</dt><dd>{{ ro()!.chassisNumber }}</dd> }
                @if (ro()!.engineNumber) { <dt>Engine No</dt><dd>{{ ro()!.engineNumber }}</dd> }
                @if (ro()!.make || ro()!.model) { <dt>Make / Model</dt><dd>{{ ro()!.make }} {{ ro()!.model }}</dd> }
                @if (ro()!.paintColour) { <dt>Paint</dt><dd>{{ ro()!.paintColour }}</dd> }
                @if (ro()!.buildDate) { <dt>Build Date</dt><dd>{{ ro()!.buildDate | date:'dd MMM yyyy' }}</dd> }
                @if (ro()!.odometer != null) { <dt>Odometer</dt><dd>{{ ro()!.odometer | number }} km</dd> }
                @if (ro()!.keyTagNo) { <dt>Key Tag</dt><dd>{{ ro()!.keyTagNo }}</dd> }
              </dl>
            </section>

            <!-- Column 3: Tasks -->
            <section class="panel">
              <div class="panel-header-row">
                <h2 class="panel-title">Tasks <span class="panel-sub">({{ ro()!.tasks.length }} operations)</span></h2>
                @if (!isTerminalStatus() && canEditTasks()) {
                  <button class="btn-add-task" (click)="openAddTask()">+ Add task</button>
                }
              </div>
              <div class="task-list">
                @for (t of ro()!.tasks; track t.id; let i = $index) {
                  <div class="task-row">
                    <div class="task-reorder">
                      <button class="reorder-btn" [disabled]="i === 0" (click)="moveTask(i, -1)" title="Move up">↑</button>
                      <button class="reorder-btn" [disabled]="i === ro()!.tasks.length - 1" (click)="moveTask(i, 1)" title="Move down">↓</button>
                    </div>
                    <span class="task-seq">{{ t.sequence }}</span>
                    <div class="task-info">
                      <span class="task-name">{{ t.operationName }}</span>
                      <span class="task-station">{{ t.stationName }}</span>
                    </div>
                    <span class="task-hrs">{{ t.estimatedHours }}h</span>
                    <span [class]="taskStatusClass(t.status)">{{ t.status }}</span>
                    @if (!isTerminalStatus() && canEditTasks()) {
                      <button class="task-delete"
                              [disabled]="t.hasWork || t.status !== 'PENDING'"
                              [title]="t.hasWork ? 'Cannot delete: work logged' : t.status !== 'PENDING' ? 'Task is in progress' : 'Delete task'"
                              (click)="deleteTask(t.id)">✕</button>
                    }
                  </div>
                }
              </div>
              @if (!isTerminalStatus() && isSupervisor() || isAdmin()) {
                <div class="cancel-row">
                  <button class="btn-cancel-ro" (click)="showCancelModal.set(true)">Cancel RO</button>
                </div>
              }
            </section>
          </div>
        } @else {
          <!-- ── Edit mode ───────────────────────────────────────────────── -->
          <div class="edit-form">
            @if (editError()) {
              <div class="alert-error">{{ editError() }}</div>
            }
            <div class="edit-grid">
              <div class="edit-section">
                <h3 class="edit-section-title">Vehicle</h3>
                <div class="edit-field-row">
                  <div class="field"><label>Rego</label><input [(ngModel)]="editRego" /></div>
                  <div class="field"><label>VIN</label><input [(ngModel)]="editVin" maxlength="17" /></div>
                </div>
                <div class="edit-field-row">
                  <div class="field"><label>Make</label><input [(ngModel)]="editMake" /></div>
                  <div class="field"><label>Model</label><input [(ngModel)]="editModel" /></div>
                </div>
                <div class="edit-field-row">
                  <div class="field"><label>Paint Colour</label><input [(ngModel)]="editPaintColour" /></div>
                  <div class="field"><label>Chassis No</label><input [(ngModel)]="editChassisNumber" /></div>
                </div>
                <div class="field"><label>Engine No</label><input [(ngModel)]="editEngineNumber" /></div>
              </div>

              <div class="edit-section">
                <h3 class="edit-section-title">Scheduling</h3>
                <div class="edit-field-row">
                  <div class="field"><label>Required Date</label><input type="datetime-local" [(ngModel)]="editRequiredDate" /></div>
                  <div class="field"><label>Expected In</label><input type="datetime-local" [(ngModel)]="editExpectedInDate" /></div>
                </div>
                <div class="field"><label>Delivery Date</label><input type="date" [(ngModel)]="editDeliveryDate" /></div>
                <div class="field">
                  <label>Priority</label>
                  <select [(ngModel)]="editPriority">
                    <option value="1">1 — Urgent</option>
                    <option value="2">2 — High</option>
                    <option value="3">3 — Normal</option>
                    <option value="4">4 — Low</option>
                    <option value="5">5 — Very Low</option>
                  </select>
                </div>
                <div class="field"><label>Notes</label><textarea [(ngModel)]="editNotes" rows="3"></textarea></div>
              </div>
            </div>

            <div class="edit-actions">
              <button class="btn-secondary" (click)="cancelEdit()">Cancel</button>
              <button class="btn-primary" [disabled]="editSaving()" (click)="saveEdit()">
                {{ editSaving() ? 'Saving…' : 'Save Changes' }}
              </button>
            </div>
          </div>
        }
      }
    </main>
  `,
  styles: [`
    .topbar { display: flex; justify-content: space-between; align-items: center;
              padding: 14px 28px; background: var(--ink); color: var(--paper);
              border-bottom: 0.5px solid rgba(245,242,234,0.1); position: relative; z-index: 1; }
    .brand { display: flex; flex-direction: column; gap: 2px; }
    .brand-logo { height: 36px; width: auto; filter: brightness(0) invert(1); }
    .brand-sub  { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: rgba(245,242,234,0.5); }
    .topbar-right { display: flex; align-items: center; gap: 16px; }
    .back-link { font-size: 13px; color: rgba(245,242,234,0.7); cursor: pointer; transition: color 0.15s; }
    .back-link:hover { color: var(--paper); }
    .user-label { font-size: 13px; color: rgba(245,242,234,0.8); }
    .logout { background: transparent; border: 0.5px solid rgba(245,242,234,0.3); color: var(--paper);
              padding: 5px 12px; border-radius: 5px; cursor: pointer; font-size: 12px; }
    .logout:hover { background: rgba(245,242,234,0.1); }

    .toast { position: fixed; top: 70px; right: 28px; background: var(--good); color: white;
             padding: 12px 18px; border-radius: 8px; font-size: 13px; font-weight: 500;
             box-shadow: 0 4px 12px rgba(10,14,15,0.15); z-index: 1000; cursor: pointer;
             animation: slideIn 0.2s ease; }
    @keyframes slideIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }

    /* Modal */
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 800;
                     display: flex; align-items: center; justify-content: center; padding: 20px; }
    .modal-card { background: white; border-radius: 10px; padding: 24px; width: 480px; max-width: 95vw;
                  box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
    .modal-title  { font-family: var(--display); font-size: 17px; font-weight: 500; margin: 0; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }

    /* Cancellation banner */
    .cancel-banner { background: #fef2f2; border-bottom: 1px solid #fecaca; padding: 12px 28px;
                     display: flex; align-items: center; gap: 16px; justify-content: space-between; }
    .cancel-banner-body { font-size: 13px; color: var(--bad); }
    .cancel-meta { font-size: 12px; color: #9b1c1c; margin-left: 6px; }
    .btn-reopen { background: white; border: 1px solid #fca5a5; color: var(--bad); border-radius: 5px;
                  padding: 5px 14px; font-size: 12px; cursor: pointer; white-space: nowrap; }
    .btn-reopen:hover:not(:disabled) { background: #fef2f2; }
    .btn-reopen:disabled { opacity: 0.5; cursor: not-allowed; }

    .stage { background: var(--paper); min-height: calc(100vh - 57px); padding-bottom: 40px; position: relative; z-index: 1; }
    .loading { padding: 40px 28px; color: var(--ink-3); font-size: 14px; }
    .alert-error { background: #fef2f2; color: var(--bad); border-left: 4px solid var(--bad);
                   border-radius: 6px; padding: 10px 16px; margin: 16px 0; font-size: 13px; }

    .scene-header { padding: 24px 28px 16px; }
    .scene-title-row { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; flex-wrap: wrap; }
    .scene-title { font-family: var(--display); font-size: 28px; font-weight: 500; color: var(--ink);
                   letter-spacing: -0.02em; margin: 0; }
    .scene-meta { font-family: var(--mono); font-size: 11px; color: var(--ink-3); letter-spacing: 0.04em; }
    .pdf-link { color: var(--accent); font-family: var(--mono); font-size: 11px; text-decoration: none; }
    .pdf-link:hover { text-decoration: underline; }

    .btn-sm { font-size: 12px; padding: 4px 12px; border-radius: 5px; border: 1px solid var(--rule);
              background: white; cursor: pointer; }
    .btn-sm:hover { background: var(--paper-2); }
    .btn-edit    { }
    .btn-override { border-color: #c7d2fe; color: #3730a3; background: #eef2ff; }
    .btn-override:hover { background: #e0e7ff; }

    .three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; padding: 0 28px; }
    @media (max-width: 1100px) { .three-col { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 700px)  { .three-col { grid-template-columns: 1fr; } }
    .panel { background: white; border: 0.5px solid var(--rule); border-radius: 12px; padding: 24px; }
    .panel-title { font-family: var(--mono); font-size: 11px; font-weight: 500; text-transform: uppercase;
                   letter-spacing: 0.12em; color: var(--ink-3); margin: 0 0 16px; }
    .panel-sub { font-weight: 400; color: var(--ink-3); opacity: 0.7; font-size: 10px; }
    .panel-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .panel-header-row .panel-title { margin-bottom: 0; }

    .detail-list { display: grid; grid-template-columns: 110px 1fr; gap: 6px 12px; font-size: 13px; margin: 0; }
    dt { color: var(--ink-3); font-weight: 400; white-space: nowrap; font-family: inherit; }
    dd { color: var(--ink); font-weight: 500; margin: 0; word-break: break-all; font-family: inherit; font-size: 13px; }

    .status-pill { padding: 2px 8px; border-radius: 3px; font-family: var(--mono); font-size: 10px; font-weight: 500; }
    .pill-draft     { background: var(--paper-3); color: var(--ink-3); }
    .pill-approved  { background: #e0e7ff; color: #3730a3; }
    .pill-progress  { background: #dbeafe; color: var(--info); }
    .pill-hold      { background: #fef9c3; color: var(--warn); }
    .pill-cancelled { background: #fef2f2; color: var(--bad); }
    .pill-completed { background: #dcfce7; color: var(--good); }

    .priority-badge { padding: 2px 8px; border-radius: 3px; font-family: var(--mono); font-size: 10px; font-weight: 500; }
    .pri-urgent { background: #fee2e2; color: var(--bad); }
    .pri-high   { background: #fef9c3; color: var(--warn); }
    .pri-normal { background: #dbeafe; color: var(--info); }
    .pri-low    { background: var(--paper-3); color: var(--ink-3); }

    /* Task list */
    .btn-add-task { font-size: 11px; padding: 3px 10px; border-radius: 5px; border: 1px solid var(--rule);
                    background: white; cursor: pointer; color: var(--ink-3); white-space: nowrap; }
    .btn-add-task:hover { border-color: var(--ink); color: var(--ink); }
    .task-list { display: flex; flex-direction: column; gap: 0; }
    .task-row { display: flex; align-items: center; gap: 8px; padding: 7px 0;
                border-bottom: 0.5px solid var(--rule); font-size: 13px; }
    .task-row:last-child { border-bottom: none; }
    .task-reorder { display: flex; flex-direction: column; gap: 1px; }
    .reorder-btn { background: none; border: none; cursor: pointer; padding: 0; font-size: 11px;
                   color: var(--ink-3); line-height: 1.2; }
    .reorder-btn:hover:not(:disabled) { color: var(--ink); }
    .reorder-btn:disabled { opacity: 0.2; cursor: not-allowed; }
    .task-seq { font-family: var(--mono); width: 22px; font-size: 11px; color: var(--ink-3); flex-shrink: 0; text-align: right; }
    .task-info { flex: 1; min-width: 0; }
    .task-name { display: block; font-weight: 500; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .task-station { display: block; font-size: 11px; color: var(--ink-3); }
    .task-hrs { font-family: var(--mono); font-size: 12px; color: var(--ink-3); white-space: nowrap; }
    .task-status { font-family: var(--mono); font-size: 10px; padding: 2px 6px; border-radius: 3px; font-weight: 500;
                   background: var(--paper-3); color: var(--ink-3); white-space: nowrap; }
    .task-status.st-completed { background: #dcfce7; color: var(--good); }
    .task-status.st-in-progress { background: #dbeafe; color: var(--info); }
    .task-status.st-cancelled { background: #fef2f2; color: var(--bad); }
    .task-delete { background: none; border: none; cursor: pointer; color: var(--ink-3); font-size: 12px;
                   padding: 2px 4px; border-radius: 3px; }
    .task-delete:hover:not(:disabled) { background: #fee2e2; color: var(--bad); }
    .task-delete:disabled { opacity: 0.25; cursor: not-allowed; }
    .cancel-row { margin-top: 16px; border-top: 0.5px solid var(--rule); padding-top: 12px; }
    .btn-cancel-ro { background: none; border: none; color: var(--bad); font-size: 12px;
                     cursor: pointer; text-decoration: underline; padding: 0; }

    /* Edit form */
    .edit-form { padding: 0 28px 40px; }
    .edit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    @media (max-width: 900px) { .edit-grid { grid-template-columns: 1fr; } }
    .edit-section { background: white; border: 0.5px solid var(--rule); border-radius: 12px; padding: 20px; }
    .edit-section-title { font-family: var(--mono); font-size: 11px; font-weight: 500; text-transform: uppercase;
                          letter-spacing: 0.12em; color: var(--ink-3); margin: 0 0 16px; }
    .edit-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .edit-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }

    /* Shared form elements */
    .field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
    .field label { font-size: 11px; font-weight: 500; color: var(--ink-3); text-transform: uppercase;
                   letter-spacing: 0.06em; font-family: var(--mono); }
    .field input, .field select, .field textarea {
      border: 1px solid var(--rule); border-radius: 6px; padding: 7px 10px; font-size: 13px;
      font-family: inherit; outline: none; background: white; }
    .field input:focus, .field select:focus, .field textarea:focus { border-color: var(--ink); }
    .field-checkbox { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 13px; }

    .btn-primary  { background: var(--ink); color: var(--paper); border: none; border-radius: 6px;
                    padding: 9px 20px; font-size: 13px; cursor: pointer; }
    .btn-primary:hover:not(:disabled) { opacity: 0.85; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: white; color: var(--ink); border: 1px solid var(--rule); border-radius: 6px;
                     padding: 9px 20px; font-size: 13px; cursor: pointer; }
    .btn-danger { background: var(--bad); color: white; border: none; border-radius: 6px;
                  padding: 9px 20px; font-size: 13px; cursor: pointer; }
    .btn-danger:hover:not(:disabled) { opacity: 0.85; }
    .btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
    .close-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--ink-3); }
  `],
})
export class RoDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http  = inject(HttpClient);
  private auth  = inject(AuthService);
  router = inject(Router);

  user = this.auth.user;

  isAdmin     = computed(() => this.user()?.roles?.includes('ADMIN') ?? false);
  isSupervisor = computed(() => this.user()?.roles?.includes('SUPERVISOR') ?? this.isAdmin());

  canEditTasks = computed(() =>
    (this.user()?.roles?.includes('SALES') ?? false) ||
    (this.user()?.roles?.includes('SUPERVISOR') ?? false) ||
    this.isAdmin());

  ro      = signal<RoDetail | null>(null);
  loading = signal(true);
  error   = signal<string | null>(null);
  toast   = signal<string | null>(null);

  isTerminalStatus = computed(() => {
    const s = this.ro()?.status;
    return s === 'COMPLETED' || s === 'CANCELLED';
  });

  hasChassisAllocated = signal(false);

  // ── Edit mode ──────────────────────────────────────────────────────────────
  editMode       = signal(false);
  editSaving     = signal(false);
  editError      = signal<string | null>(null);
  editRego       = '';
  editVin        = '';
  editMake       = '';
  editModel      = '';
  editPaintColour     = '';
  editChassisNumber   = '';
  editEngineNumber    = '';
  editRequiredDate    = '';
  editExpectedInDate  = '';
  editDeliveryDate    = '';
  editPriority        = '3';
  editNotes           = '';

  // ── Cancel modal ───────────────────────────────────────────────────────────
  showCancelModal = signal(false);
  cancelReason    = '';
  releaseChassis  = true;
  cancelSaving    = signal(false);
  cancelError     = signal<string | null>(null);
  reopenSaving    = signal(false);

  // ── Override stage modal ───────────────────────────────────────────────────
  showOverrideModal = signal(false);
  overrideStageId   = 0;
  overrideReason    = '';
  overrideSaving    = signal(false);
  overrideError     = signal<string | null>(null);
  kanbanStages      = signal<KanbanStage[]>([]);

  // ── Add task modal ─────────────────────────────────────────────────────────
  showAddTaskModal = signal(false);
  operations       = signal<OperationItem[]>([]);
  stations         = signal<StationItem[]>([]);
  addTaskOpId      = '';
  addTaskStationId = 0;
  addTaskHours     = 1;
  addTaskNotes     = '';
  addTaskSaving    = signal(false);
  addTaskError     = signal<string | null>(null);

  ngOnInit() {
    const id      = this.route.snapshot.paramMap.get('id')!;
    const created = this.route.snapshot.queryParamMap.get('created') === '1';

    this.http.get<RoDetail>(`/api/repair-orders/${id}`).subscribe({
      next: r => {
        this.ro.set(r);
        this.loading.set(false);
        if (created) {
          this.toast.set(`RO ${r.roNumber} created with ${r.tasks.length} tasks`);
          setTimeout(() => this.toast.set(null), 5000);
        }
        this.checkChassis(id);
      },
      error: () => {
        this.error.set('Repair order not found.');
        this.loading.set(false);
      },
    });
  }

  private checkChassis(roId: string) {
    this.http.get<any[]>('/api/scheduling/chassis?available=false').subscribe({
      next: list => {
        this.hasChassisAllocated.set(list.some((c: any) => c.allocatedToRo === roId));
      },
    });
  }

  // ── Edit ───────────────────────────────────────────────────────────────────

  enterEdit() {
    const r = this.ro()!;
    this.editRego           = r.rego ?? '';
    this.editVin            = r.vin ?? '';
    this.editMake           = r.make ?? '';
    this.editModel          = r.model ?? '';
    this.editPaintColour    = r.paintColour ?? '';
    this.editChassisNumber  = r.chassisNumber ?? '';
    this.editEngineNumber   = r.engineNumber ?? '';
    this.editRequiredDate   = r.requiredDate ? r.requiredDate.slice(0, 16) : '';
    this.editExpectedInDate = r.expectedInDate ? r.expectedInDate.slice(0, 16) : '';
    this.editDeliveryDate   = r.deliveryDate ?? '';
    this.editPriority       = String(r.priority);
    this.editNotes          = r.notes ?? '';
    this.editError.set(null);
    this.editMode.set(true);
  }

  cancelEdit() { this.editMode.set(false); }

  async saveEdit() {
    this.editSaving.set(true);
    this.editError.set(null);
    const id = this.ro()!.id;
    try {
      await firstValueFrom(this.http.put(`/api/repair-orders/${id}`, {
        rego:           this.editRego   || null,
        vin:            this.editVin    || null,
        make:           this.editMake   || null,
        model:          this.editModel  || null,
        paintColour:    this.editPaintColour   || null,
        chassisNumber:  this.editChassisNumber || null,
        engineNumber:   this.editEngineNumber  || null,
        requiredDate:   this.editRequiredDate   ? new Date(this.editRequiredDate).toISOString()   : null,
        expectedInDate: this.editExpectedInDate ? new Date(this.editExpectedInDate).toISOString() : null,
        deliveryDate:   this.editDeliveryDate || null,
        priority:       Number(this.editPriority),
        notes:          this.editNotes || null,
      }));
      // Reload
      const updated = await firstValueFrom(this.http.get<RoDetail>(`/api/repair-orders/${id}`));
      this.ro.set(updated);
      this.editMode.set(false);
      this.showToast('Changes saved');
    } catch (e: any) {
      this.editError.set(e?.error?.message ?? 'Save failed. Please try again.');
    } finally {
      this.editSaving.set(false);
    }
  }

  // ── Cancel / Reopen ────────────────────────────────────────────────────────

  async doCancel() {
    if (!this.cancelReason.trim() || this.cancelReason.trim().length < 10) {
      this.cancelError.set('Reason must be at least 10 characters.');
      return;
    }
    this.cancelSaving.set(true);
    this.cancelError.set(null);
    try {
      await firstValueFrom(this.http.post(`/api/repair-orders/${this.ro()!.id}/cancel`, {
        reason:         this.cancelReason.trim(),
        releaseChassis: this.releaseChassis,
      }));
      const updated = await firstValueFrom(this.http.get<RoDetail>(`/api/repair-orders/${this.ro()!.id}`));
      this.ro.set(updated);
      this.showCancelModal.set(false);
      this.cancelReason = '';
      this.showToast('RO cancelled');
    } catch (e: any) {
      this.cancelError.set(e?.error?.message ?? 'Cancellation failed.');
    } finally {
      this.cancelSaving.set(false);
    }
  }

  async doReopen() {
    this.reopenSaving.set(true);
    try {
      await firstValueFrom(this.http.post(`/api/repair-orders/${this.ro()!.id}/reopen`, {}));
      const updated = await firstValueFrom(this.http.get<RoDetail>(`/api/repair-orders/${this.ro()!.id}`));
      this.ro.set(updated);
      this.showToast('RO reopened');
    } catch (e: any) {
      this.showToast(e?.error?.message ?? 'Reopen failed.');
    } finally {
      this.reopenSaving.set(false);
    }
  }

  // ── Override stage ─────────────────────────────────────────────────────────

  openOverrideModal() {
    this.overrideReason = '';
    this.overrideError.set(null);
    if (this.kanbanStages().length === 0) {
      this.http.get<KanbanStage[]>('/api/kanban/stages').subscribe(s => {
        this.kanbanStages.set(s);
        this.overrideStageId = s[0]?.id ?? 0;
      });
    } else {
      this.overrideStageId = this.kanbanStages()[0]?.id ?? 0;
    }
    this.showOverrideModal.set(true);
  }

  async doOverrideStage() {
    if (!this.overrideReason.trim() || this.overrideReason.trim().length < 10) {
      this.overrideError.set('Reason must be at least 10 characters.');
      return;
    }
    this.overrideSaving.set(true);
    this.overrideError.set(null);
    try {
      await firstValueFrom(this.http.post(`/api/kanban/ros/${this.ro()!.id}/override-stage`, {
        stageId: Number(this.overrideStageId),
        reason:  this.overrideReason.trim(),
      }));
      this.showOverrideModal.set(false);
      this.showToast('Kanban stage overridden');
    } catch (e: any) {
      this.overrideError.set(e?.error?.message ?? 'Override failed.');
    } finally {
      this.overrideSaving.set(false);
    }
  }

  // ── Add / delete / reorder tasks ───────────────────────────────────────────

  openAddTask() {
    this.addTaskOpId   = '';
    this.addTaskStationId = 0;
    this.addTaskHours  = 1;
    this.addTaskNotes  = '';
    this.addTaskError.set(null);

    const load$ = [];
    if (this.operations().length === 0)
      load$.push(this.http.get<OperationItem[]>('/api/operations').subscribe(o => this.operations.set(o)));
    if (this.stations().length === 0)
      load$.push(this.http.get<StationItem[]>('/api/stations').subscribe(s => {
        this.stations.set(s);
      }));

    this.showAddTaskModal.set(true);
  }

  onOpChange(opId: string) {
    const op = this.operations().find(o => o.id === Number(opId));
    if (op) {
      this.addTaskStationId = op.defaultStationId;
      this.addTaskHours     = op.typicalHours ?? 1;
    }
  }

  async doAddTask() {
    if (!this.addTaskOpId) { this.addTaskError.set('Select an operation.'); return; }
    this.addTaskSaving.set(true);
    this.addTaskError.set(null);
    try {
      await firstValueFrom(this.http.post(`/api/repair-orders/${this.ro()!.id}/tasks`, {
        operationId:    Number(this.addTaskOpId),
        stationId:      this.addTaskStationId || null,
        estimatedHours: this.addTaskHours,
        notes:          this.addTaskNotes || null,
      }));
      const updated = await firstValueFrom(this.http.get<RoDetail>(`/api/repair-orders/${this.ro()!.id}`));
      this.ro.set(updated);
      this.showAddTaskModal.set(false);
      this.showToast('Task added');
    } catch (e: any) {
      this.addTaskError.set(e?.error?.message ?? 'Failed to add task.');
    } finally {
      this.addTaskSaving.set(false);
    }
  }

  async deleteTask(taskId: string) {
    if (!confirm('Delete this task?')) return;
    try {
      await firstValueFrom(this.http.delete(`/api/repair-orders/${this.ro()!.id}/tasks/${taskId}`));
      const updated = await firstValueFrom(this.http.get<RoDetail>(`/api/repair-orders/${this.ro()!.id}`));
      this.ro.set(updated);
    } catch (e: any) {
      this.showToast(e?.error?.message ?? 'Delete failed.');
    }
  }

  async moveTask(index: number, direction: -1 | 1) {
    const tasks = [...this.ro()!.tasks].sort((a, b) => a.sequence - b.sequence);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= tasks.length) return;

    [tasks[index], tasks[swapIndex]] = [tasks[swapIndex], tasks[index]];
    const taskIds = tasks.map(t => t.id);

    try {
      await firstValueFrom(this.http.put(`/api/repair-orders/${this.ro()!.id}/tasks/reorder`, { taskIds }));
      const updated = await firstValueFrom(this.http.get<RoDetail>(`/api/repair-orders/${this.ro()!.id}`));
      this.ro.set(updated);
    } catch (e: any) {
      this.showToast('Reorder failed.');
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  private showToast(msg: string) {
    this.toast.set(msg);
    setTimeout(() => this.toast.set(null), 4000);
  }

  statusClass(s: string) {
    return s === 'IN_PROGRESS' ? 'status-pill pill-progress'
         : s === 'APPROVED'   ? 'status-pill pill-approved'
         : s === 'ON_HOLD'    ? 'status-pill pill-hold'
         : s === 'CANCELLED'  ? 'status-pill pill-cancelled'
         : s === 'COMPLETED'  ? 'status-pill pill-completed'
         :                      'status-pill pill-draft';
  }

  priorityClass(p: number) { return p === 1 ? 'priority-badge pri-urgent' : p === 2 ? 'priority-badge pri-high' : p <= 3 ? 'priority-badge pri-normal' : 'priority-badge pri-low'; }
  priorityLabel(p: number) { return p === 1 ? 'Urgent' : p === 2 ? 'High' : p === 3 ? 'Normal' : 'Low'; }
  taskStatusClass(s: string) {
    return s === 'COMPLETED'   ? 'task-status st-completed'
         : s === 'IN_PROGRESS' ? 'task-status st-in-progress'
         : s === 'CANCELLED'   ? 'task-status st-cancelled'
         : 'task-status';
  }
}
