import {
  Component, OnInit, OnDestroy, inject, signal, computed,
} from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription, interval } from 'rxjs';
import { TechService, TechTaskDetail, PhotoItem } from './tech.service';
import { TechBottomNavComponent } from './tech-bottom-nav.component';
import { VarianceModalComponent } from './variance-modal.component';
import { BlockerModalComponent } from './blocker-modal.component';

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

@Component({
  selector: 'app-task-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TechBottomNavComponent,
    VarianceModalComponent,
    BlockerModalComponent,
  ],
  template: `
    <div class="page">
      <header class="detail-header">
        <button class="back-btn" (click)="goBack()">&#8592; Back</button>
        <span class="header-title">Task Detail</span>
      </header>

      @if (task()) {
        <main class="detail-scroll">

          <!-- 1. Job header -->
          <section class="card">
            <h2 class="op-name">{{ task()!.operationName }}</h2>
            <div class="meta-row">
              <span class="meta-label">Job Code</span>
              <span>{{ task()!.jobCodeLine }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">Station</span>
              <span>{{ task()!.stationName }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">Status</span>
              <span class="status-pill" [class]="statusClass(task()!.status)">{{ task()!.status }}</span>
            </div>
          </section>

          <!-- 2. Vehicle -->
          <section class="card">
            <h3 class="section-title">Vehicle</h3>
            <div class="meta-row"><span class="meta-label">Customer</span><span>{{ task()!.ro.customerName }}</span></div>
            <div class="meta-row"><span class="meta-label">Rego</span><span>{{ task()!.ro.rego ?? '—' }}</span></div>
            <div class="meta-row"><span class="meta-label">Make / Model</span><span>{{ task()!.ro.make }} {{ task()!.ro.model }}</span></div>
            <div class="meta-row"><span class="meta-label">Paint</span><span>{{ task()!.ro.paintColour ?? '—' }}</span></div>
            <div class="meta-row">
              <span class="meta-label">Due</span>
              <span>{{ task()!.ro.requiredDate ? (task()!.ro.requiredDate | date:'dd MMM yyyy') : '—' }}</span>
            </div>
          </section>

          <!-- 3. Hours tracker -->
          <section class="card">
            <h3 class="section-title">Hours</h3>
            <div class="progress-labels">
              <span>{{ task()!.actualHours }}h actual</span>
              <span>{{ task()!.estimatedHours }}h estimated</span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" [class]="progressClass()" [style.width]="progressWidth()"></div>
            </div>

            @if (clockedInSince()) {
              <div class="clock-block">
                <div>
                  <div class="clock-status">Live Session</div>
                  <div class="clock-time">{{ elapsedDisplay() }}</div>
                </div>
                <button class="btn-clockout" (click)="handleClockOut()">Clock Out</button>
              </div>
            }
          </section>

          <!-- 4. Sessions -->
          @if (task()!.timeEntries.length > 0) {
            <section class="card">
              <h3 class="section-title">Sessions</h3>
              <table class="sessions-table">
                <thead>
                  <tr>
                    <th>Date</th><th>Start</th><th>End</th><th>Mins</th>
                  </tr>
                </thead>
                <tbody>
                  @for (te of task()!.timeEntries; track te.id) {
                    <tr>
                      <td>{{ te.clockIn | date:'dd/MM' }}</td>
                      <td>{{ te.clockIn | date:'HH:mm' }}</td>
                      <td>{{ te.clockOut ? (te.clockOut | date:'HH:mm') : '—' }}</td>
                      <td>{{ te.durationMinutes ?? '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </section>
          }

          <!-- 5. Photos -->
          <section class="card">
            <h3 class="section-title">Photos</h3>
            <div class="photo-grid">
              @for (photo of photos(); track photo.id) {
                <img [src]="photo.url" [alt]="photo.fileName" class="photo-thumb" />
              }
            </div>
            <label class="add-photo-btn">
              @if (isUploading()) {
                Uploading...
              } @else {
                + Add Photo
              }
              <input type="file" accept="image/*" capture="environment" [disabled]="isUploading()" (change)="onFileSelected($event)" style="display:none" />
            </label>
          </section>

        </main>

        <!-- Fixed action buttons -->
        <div class="action-bar">
          @if (clockInError()) {
            <p class="clock-error">{{ clockInError() }}</p>
          }
          @if (!clockedInSince() && task()!.status !== 'COMPLETED' && task()!.status !== 'CANCELLED') {
            <button class="btn btn-clockin" (click)="handleClockIn()">Clock In</button>
            <button class="btn btn-complete" (click)="handleComplete()">Complete Task</button>
          }

          @if (task()!.status === 'ASSIGNED' || task()!.status === 'IN_PROGRESS' || task()!.status === 'PAUSED') {
            <button class="btn btn-block" (click)="showBlockerModal.set(true)">Report Blocker</button>
          }

          @if (task()!.operationId === 70 && task()!.status !== 'COMPLETED' && task()!.status !== 'CANCELLED') {
            <button class="btn btn-qc" (click)="openQc()">Start QC &#8594;</button>
          }
        </div>
      } @else if (loadError()) {
        <div class="empty-state">Failed to load task.</div>
      } @else {
        <div class="empty-state">Loading...</div>
      }

      <!-- Modals -->
      @if (showVarianceModal()) {
        <app-variance-modal
          [deltaHours]="varianceDelta()"
          (confirmed)="submitComplete($event)"
          (cancel)="showVarianceModal.set(false)" />
      }

      @if (showBlockerModal()) {
        <app-blocker-modal
          (confirmed)="submitBlock($event)"
          (cancel)="showBlockerModal.set(false)" />
      }

      <app-tech-bottom-nav />
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; min-height: 100vh; background: var(--paper);
            max-width: 420px; margin: 0 auto; position: relative; z-index: 1; }
    .detail-header {
      display: flex; align-items: center; gap: 12px;
      background: white; border-bottom: 0.5px solid var(--rule);
      padding: 14px 16px; position: sticky; top: 0; z-index: 10;
    }
    .back-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--accent); }
    .header-title { font-family: var(--display); font-size: 16px; font-weight: 500; color: var(--ink); }
    .detail-scroll { flex: 1; padding: 12px 14px 160px; display: flex; flex-direction: column; gap: 10px; }
    .card { background: white; border: 0.5px solid var(--rule); border-radius: 10px; padding: 14px 16px; }
    .op-name { margin: 0 0 10px; font-family: var(--display); font-size: 20px; font-weight: 500; color: var(--ink); }
    .section-title { margin: 0 0 10px; font-family: var(--mono); font-size: 10px; font-weight: 500;
                     text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink-3); }
    .meta-row { display: flex; justify-content: space-between; font-size: 13px; padding: 5px 0;
                border-bottom: 0.5px solid var(--rule); }
    .meta-row:last-child { border-bottom: none; }
    .meta-label { color: var(--ink-3); }
    .status-pill { font-family: var(--mono); font-size: 10px; font-weight: 500; padding: 2px 8px;
                   border-radius: 3px; text-transform: uppercase; }
    .pill-assigned { background: #e0e7ff; color: #3730a3; }
    .pill-in_progress { background: #dbeafe; color: var(--info); }
    .pill-paused { background: #fef9c3; color: var(--warn); }
    .pill-blocked { background: #fee2e2; color: var(--bad); }
    .pill-default { background: var(--paper-3); color: var(--ink-3); }
    .progress-labels { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 12px;
                       color: var(--ink-3); margin-bottom: 8px; }
    .progress-bar-bg { height: 4px; background: var(--paper-3); border-radius: 2px; overflow: hidden; }
    .progress-bar-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }
    .bar-green { background: var(--info); }
    .bar-amber { background: var(--warn); }
    .bar-red   { background: var(--bad); }
    .clock-block { margin-top: 12px; background: #dbeafe; border-radius: 10px; padding: 12px 14px;
                   display: flex; justify-content: space-between; align-items: center; }
    .clock-status { font-family: var(--mono); font-size: 10px; color: var(--info);
                    text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 2px; }
    .clock-time { font-family: var(--display); font-weight: 500; font-size: 18px; color: #1e3a8a; }
    .sessions-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .sessions-table th { font-family: var(--mono); text-align: left; color: var(--ink-3); padding: 4px 0;
                         font-weight: 500; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
                         border-bottom: 0.5px solid var(--rule); }
    .sessions-table td { font-family: var(--mono); font-size: 12px; padding: 5px 0; border-bottom: 0.5px solid var(--rule); color: var(--ink); }
    .sessions-table tr:last-child td { border-bottom: none; }
    .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 10px; }
    .photo-thumb { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; }
    .add-photo-btn {
      display: block; text-align: center;
      padding: 8px; border-radius: 8px; cursor: pointer;
      background: var(--paper-2); color: var(--ink-3); font-size: 13px; font-weight: 500;
      border: 0.5px solid var(--rule);
    }
    .action-bar {
      position: fixed; bottom: 60px; left: 0; right: 0;
      max-width: 420px; margin: 0 auto;
      padding: 10px 16px; background: white;
      border-top: 0.5px solid var(--rule);
      display: flex; flex-direction: column; gap: 8px;
    }
    .btn-clockout {
      padding: 8px 14px; background: var(--bad); color: white; border: none;
      border-radius: 6px; font-size: 11px; font-weight: 500; cursor: pointer; font-family: var(--sans);
    }
    .btn-clockout:hover { background: #991b1b; }
    .btn {
      width: 100%; padding: 14px; border-radius: 10px;
      border: none; font-size: 14px; font-weight: 500;
      cursor: pointer; font-family: var(--sans);
    }
    .btn-clockin  { background: var(--accent); color: white; }
    .btn-clockin:hover { background: #1d6bc8; }
    .btn-complete { background: var(--good); color: white; }
    .btn-complete:hover { background: #166534; }
    .btn-block {
      background: white; border: 0.5px solid var(--rule-strong);
      color: var(--ink-2); padding: 10px; border-radius: 8px; font-size: 12px;
    }
    .btn-clockin  { background: #2563eb; color: #fff; }
    .btn-clockout { background: #0891b2; color: #fff; }
    .btn-complete { background: #16a34a; color: #fff; }
    .btn-block    { background: #dc2626; color: #fff; }
    .btn-qc       { background: #7c3aed; color: #fff; }
    .empty-state  { text-align: center; padding: 48px 16px; color: #6b7280; }
  `],
})
export class TechTaskDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private techService = inject(TechService);

  task = signal<TechTaskDetail | null>(null);
  photos = signal<PhotoItem[]>([]);
  loadError = signal(false);
  isUploading = signal(false);

  clockedInSince = signal<Date | null>(null);
  elapsedSeconds = signal(0);
  elapsedDisplay = computed(() => formatElapsed(this.elapsedSeconds()));

  showVarianceModal = signal(false);
  showBlockerModal = signal(false);
  varianceDelta = signal(0);
  clockInError = signal<string | null>(null);

  progressWidth = computed(() => {
    const t = this.task();
    if (!t || t.estimatedHours === 0) return '0%';
    const pct = Math.min((t.actualHours / t.estimatedHours) * 100, 150);
    return `${pct}%`;
  });

  progressClass = computed(() => {
    const t = this.task();
    if (!t || t.estimatedHours === 0) return 'bar-green';
    const pct = (t.actualHours / t.estimatedHours) * 100;
    if (pct <= 90) return 'bar-green';
    if (pct <= 110) return 'bar-amber';
    return 'bar-red';
  });

  private taskId = '';
  private tickSub?: Subscription;

  ngOnInit(): void {
    this.taskId = this.route.snapshot.paramMap.get('id') ?? '';
    this.loadTask();
    this.loadPhotos();
  }

  ngOnDestroy(): void {
    this.tickSub?.unsubscribe();
  }

  loadTask(): void {
    this.techService.getTask(this.taskId).subscribe({
      next: task => {
        this.task.set(task);
        this.loadError.set(false);
        if (task.clockedInSince) {
          this.clockedInSince.set(new Date(task.clockedInSince));
          this.startTimer();
        } else {
          this.clockedInSince.set(null);
          this.stopTimer();
        }
      },
      error: () => this.loadError.set(true),
    });
  }

  loadPhotos(): void {
    this.techService.getPhotos(this.taskId).subscribe({
      next: photos => this.photos.set(photos),
    });
  }

  goBack(): void {
    this.router.navigate(['/tech/tasks']);
  }

  handleClockIn(): void {
    this.clockInError.set(null);
    this.techService.clockIn(this.taskId).subscribe({
      next: result => {
        this.clockedInSince.set(new Date(result.clockIn));
        this.startTimer();
        this.loadTask();
      },
      error: err => {
        const msg = err.error?.message ?? 'Could not clock in. Please try again.';
        this.clockInError.set(msg);
        setTimeout(() => this.clockInError.set(null), 4000);
      },
    });
  }

  handleClockOut(): void {
    this.techService.clockOut(this.taskId).subscribe({
      next: () => {
        this.clockedInSince.set(null);
        this.stopTimer();
        this.loadTask();
      },
    });
  }

  handleComplete(): void {
    const t = this.task();
    if (!t) return;
    const overrun = t.actualHours > t.estimatedHours * 1.1;
    if (overrun) {
      this.varianceDelta.set(Math.round((t.actualHours - t.estimatedHours) * 100) / 100);
      this.showVarianceModal.set(true);
    } else {
      this.techService.completeTask(this.taskId, { varianceReasonId: 11 }).subscribe({
        next: () => this.loadTask(),
      });
    }
  }

  submitComplete(data: { reasonId: number; notes: string | undefined }): void {
    this.showVarianceModal.set(false);
    this.techService.completeTask(this.taskId, { varianceReasonId: data.reasonId, notes: data.notes }).subscribe({
      next: () => this.loadTask(),
    });
  }

  submitBlock(reason: string): void {
    this.showBlockerModal.set(false);
    this.techService.blockTask(this.taskId, reason).subscribe({
      next: () => this.loadTask(),
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.isUploading.set(true);
    this.techService.uploadPhoto(this.taskId, file).subscribe({
      next: () => {
        this.isUploading.set(false);
        this.loadPhotos();
      },
      error: () => this.isUploading.set(false),
    });
  }

  statusClass(status: string): string {
    switch (status.toLowerCase()) {
      case 'in_progress': return 'status-pill pill-in_progress';
      case 'paused':      return 'status-pill pill-paused';
      case 'assigned':    return 'status-pill pill-assigned';
      case 'blocked':     return 'status-pill pill-blocked';
      default:            return 'status-pill pill-default';
    }
  }

  openQc(): void {
    const t = this.task();
    if (!t) return;
    this.router.navigate(['/tech/qc', t.roId]);
  }

  private startTimer(): void {
    this.stopTimer();
    const since = this.clockedInSince();
    if (!since) return;
    const updateElapsed = () => {
      const diff = Math.floor((Date.now() - since.getTime()) / 1000);
      this.elapsedSeconds.set(diff);
    };
    updateElapsed();
    this.tickSub = interval(1000).subscribe(() => updateElapsed());
  }

  private stopTimer(): void {
    this.tickSub?.unsubscribe();
    this.tickSub = undefined;
    this.elapsedSeconds.set(0);
  }
}
