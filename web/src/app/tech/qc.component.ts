import {
  Component, OnInit, OnDestroy, inject, signal, computed,
} from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription, interval, forkJoin } from 'rxjs';
import { TechService } from './tech.service';
import { TechBottomNavComponent } from './tech-bottom-nav.component';

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

interface QcChecklistItem { itemCode: string; label: string; checked: boolean; }
interface QcTask { id: string; status: string; estimatedHours: number; actualHours: number; clockedInSince: string | null; }
interface QcContext {
  roId: string; roNumber: string; customerName: string; customerEmailDl: string | null;
  rego: string | null; make: string | null; model: string | null; paintColour: string | null;
  requiredDate: string | null; templateCode: string; templateName: string;
  qcTask: QcTask; checklistItems: QcChecklistItem[];
  priorSubmission: { submittedAt: string; notes: string | null; emailTo: string | null } | null;
  allBuildTasksComplete: boolean;
}
interface OperationGroup { operationName: string; photos: PhotoEntry[]; }
interface PhotoEntry { id: string; fileName: string; url: string; uploadedAt: string; uploadedByName: string; }
interface QcPhotos { groups: OperationGroup[]; totalCount: number; }
interface EmailPreview { to: string; cc: string; subject: string; bodyHtml: string; bodyText: string; photoCount: number; }
interface PassResult { roId: string; roNumber: string; emailSent: boolean; emailTo: string; emailError: string | null; }

@Component({
  selector: 'app-qc',
  standalone: true,
  imports: [CommonModule, RouterModule, TechBottomNavComponent],
  template: `
    <div class="page">
      <header class="detail-header">
        <button class="back-btn" routerLink="/tech/tasks">&#8592; My Tasks</button>
        <span class="header-title">Final QC</span>
      </header>

      @if (ctx()) {
        <main class="detail-scroll">

          <!-- Vehicle strip -->
          <section class="card vehicle-strip">
            <div class="ro-badge">{{ ctx()!.roNumber }}</div>
            <div class="vehicle-main">{{ ctx()!.make }} {{ ctx()!.model }}</div>
            <div class="vehicle-meta">
              <span>{{ ctx()!.rego ?? '—' }}</span>
              <span>{{ ctx()!.customerName }}</span>
              @if (ctx()!.requiredDate) {
                <span class="due-chip">Due {{ ctx()!.requiredDate | date:'dd MMM' }}</span>
              }
            </div>
          </section>

          <!-- Build status banner -->
          <div class="build-status" [class.complete]="ctx()!.allBuildTasksComplete">
            {{ ctx()!.allBuildTasksComplete ? '✓ All build tasks complete' : '⚠ Build tasks still in progress — cannot pass yet' }}
          </div>

          <!-- Clock section -->
          @if (clockedInSince()) {
            <div class="clock-section card">
              <div class="live-session">
                <span class="live-dot"></span>
                QC in progress: {{ elapsedDisplay() }}
              </div>
              <button class="btn btn-clockout" (click)="handleClockOut()">Clock Out</button>
            </div>
          } @else if (ctx()!.qcTask.status !== 'COMPLETED') {
            <div class="clock-section card">
              <button class="btn btn-clockin" (click)="handleClockIn()">Clock In to QC</button>
            </div>
          }

          <!-- Checklist -->
          <section class="card">
            <div class="section-header">
              <h3 class="section-title">Compliance Checklist</h3>
              <span class="check-badge" [class.all-done]="checkCount() === 6">{{ checkCount() }} / 6</span>
            </div>
            <div class="progress-wrap">
              <div class="progress-bg">
                <div class="progress-fill" [style.width]="progressWidth()"></div>
              </div>
              <span class="progress-label">{{ checkCount() }} of 6 passed</span>
            </div>
            @for (item of ctx()!.checklistItems; track item.itemCode) {
              <div class="checklist-row" [class.checked]="checkedItems()[item.itemCode]"
                   [class.disabled]="ctx()!.qcTask.status === 'COMPLETED'"
                   (click)="toggleItem(item.itemCode)">
                <div class="check-box">{{ checkedItems()[item.itemCode] ? '✓' : '' }}</div>
                <span class="check-label">{{ item.label }}</span>
              </div>
            }
          </section>

          <!-- Build photos -->
          <section class="card">
            <h3 class="section-title">Build Photos</h3>
            @if (qcPhotos() && qcPhotos()!.totalCount > 0) {
              @for (group of qcPhotos()!.groups; track group.operationName) {
                <h4 class="photo-group-header">{{ group.operationName }} ({{ group.photos.length }})</h4>
                <div class="photo-grid">
                  @for (p of group.photos; track p.id) {
                    <a [href]="p.url" target="_blank">
                      <img [src]="p.url" [alt]="p.fileName" class="photo-thumb" />
                    </a>
                  }
                </div>
              }
            } @else {
              <p class="empty-text">No build photos yet.</p>
            }
            @if (ctx()!.qcTask.status !== 'COMPLETED') {
              <label class="add-photo-btn">
                {{ isUploading() ? 'Uploading...' : '+ Add QC Photo' }}
                <input type="file" accept="image/*" capture="environment"
                       [disabled]="isUploading()" (change)="onPhotoSelected($event)" style="display:none" />
              </label>
            }
          </section>

          <!-- Notes -->
          @if (ctx()!.qcTask.status !== 'COMPLETED') {
            <section class="card">
              <h3 class="section-title">QC Notes (optional)</h3>
              <textarea class="notes-input" rows="3" placeholder="Any observations or notes…"
                        [value]="notes()"
                        (input)="notes.set($any($event.target).value)"></textarea>
            </section>
          }

        </main>

        <!-- Fixed action bar -->
        @if (ctx()!.qcTask.status !== 'COMPLETED') {
          <div class="action-bar">
            <button class="btn btn-pass"
                    [disabled]="!canPass()"
                    (click)="openEmailModal()">
              Preview &amp; Send
            </button>
          </div>
        }

      } @else if (loadError()) {
        <div class="empty-state">Failed to load QC context.</div>
      } @else {
        <div class="empty-state">Loading…</div>
      }

      <!-- Email preview modal (centred dialog) -->
      @if (showEmailModal()) {
        <div class="modal-overlay" (click)="closeEmailModal()">
          <div class="modal-sheet" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <span class="modal-title">Email Preview</span>
              <button class="modal-close" (click)="closeEmailModal()">✕</button>
            </div>
            @if (!emailPreview()) {
              <p class="empty-text" style="padding:20px 16px;">Loading preview…</p>
            } @else {
              <div class="modal-body">
                <div class="field">
                  <label>To</label>
                  <input [value]="emailTo()" (input)="emailTo.set($any($event.target).value)"
                         placeholder="fleet@customer.com.au" />
                </div>
                <div class="field readonly">
                  <label>Subject</label>
                  <span class="field-value">{{ emailPreview()!.subject }}</span>
                </div>
                <div class="email-body" [innerHTML]="emailPreview()!.bodyHtml"></div>
                @if (apiError()) {
                  <div class="inline-error">{{ apiError() }}</div>
                }
              </div>
              <div class="modal-actions">
                <button class="btn-secondary-sm" [disabled]="passing()" (click)="closeEmailModal()">Cancel</button>
                <button class="btn btn-pass modal-send-btn" [disabled]="passing()" (click)="pass()">
                  {{ passing() ? 'Sending…' : 'Send &amp; Complete' }}
                </button>
              </div>
            }
          </div>
        </div>
      }

      <!-- Success overlay -->
      @if (passResult()) {
        <div class="success-overlay">
          <div class="success-card">
            <div class="success-icon">✓</div>
            <h2>{{ passResult()!.roNumber }} Complete</h2>
            @if (passResult()!.emailSent) {
              <p>Completion email sent to <strong>{{ passResult()!.emailTo }}</strong>.</p>
            } @else {
              <p class="warn-text">{{ passResult()!.emailError ?? 'No email sent.' }}</p>
            }
            <a class="btn btn-pass" routerLink="/tech/tasks">Return to task list</a>
          </div>
        </div>
      }

      <app-tech-bottom-nav />
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; min-height: 100vh; background: #f9fafb; max-width: 420px; margin: 0 auto; }
    .detail-header { display: flex; align-items: center; gap: 12px; background: #fff; border-bottom: 1px solid #e5e7eb; padding: 14px 16px; position: sticky; top: 0; z-index: 10; }
    .back-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: #2563eb; }
    .header-title { font-size: 16px; font-weight: 600; }
    .detail-scroll { flex: 1; padding: 12px 16px 100px; display: flex; flex-direction: column; gap: 12px; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); padding: 14px 16px; }

    /* Vehicle strip */
    .vehicle-strip { background: #1a202c; color: #f5f2ea; }
    .ro-badge { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(245,242,234,0.6); margin-bottom: 4px; }
    .vehicle-main { font-size: 20px; font-weight: 700; margin-bottom: 6px; }
    .vehicle-meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 13px; color: rgba(245,242,234,0.8); }
    .due-chip { background: rgba(245,242,234,0.15); padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }

    /* Build status */
    .build-status { padding: 10px 16px; border-radius: 10px; font-size: 13px; font-weight: 600; }
    .build-status.complete { background: #f0fff4; color: #276749; border: 1px solid #9ae6b4; }
    .build-status:not(.complete) { background: #fffbeb; color: #b7791f; border: 1px solid #f6e05e; }

    /* Clock section */
    .clock-section { padding: 12px 16px; }
    .live-session { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: #16a34a; margin-bottom: 10px; }
    .live-dot { width: 8px; height: 8px; border-radius: 50%; background: #16a34a; animation: pulse 1s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

    /* Checklist */
    .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .section-title { margin: 0; font-size: 15px; font-weight: 700; color: #374151; }
    .check-badge { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 99px; background: #e5e7eb; color: #374151; }
    .check-badge.all-done { background: #dcfce7; color: #15803d; }

    /* Progress bar */
    .progress-wrap { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .progress-bg { flex: 1; height: 6px; background: #e5e7eb; border-radius: 99px; overflow: hidden; }
    .progress-fill { height: 100%; background: #16a34a; border-radius: 99px; transition: width 0.2s ease; }
    .progress-label { font-size: 11px; color: #9ca3af; white-space: nowrap; font-variant-numeric: tabular-nums; }

    .checklist-row { display: flex; align-items: center; gap: 12px; padding: 13px 0; border-bottom: 1px solid #f3f4f6; cursor: pointer; }
    .checklist-row:last-child { border-bottom: none; }
    .checklist-row.disabled { cursor: default; opacity: 0.7; }
    .check-box { width: 28px; height: 28px; border: 2px solid #cbd5e0; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700; color: #276749; flex-shrink: 0; transition: all 0.1s; }
    .checklist-row.checked .check-box { background: #9ae6b4; border-color: #48bb78; }
    .check-label { font-size: 13px; color: #374151; line-height: 1.4; }

    /* Photos */
    .photo-group-header { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin: 12px 0 6px; }
    .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-bottom: 10px; }
    .photo-thumb { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; }
    .add-photo-btn { display: block; text-align: center; padding: 8px; border-radius: 8px; cursor: pointer; background: #f3f4f6; color: #374151; font-size: 14px; font-weight: 600; margin-top: 6px; }
    .empty-text { font-size: 13px; color: #9ca3af; text-align: center; padding: 12px 0; margin: 0; }

    /* Notes */
    .notes-input { width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; font-size: 13px; resize: vertical; font-family: inherit; box-sizing: border-box; }
    .notes-input:focus { outline: none; border-color: #2563eb; }

    /* Action bar */
    .action-bar { position: fixed; bottom: 60px; left: 0; right: 0; max-width: 420px; margin: 0 auto; padding: 10px 16px; background: #fff; border-top: 1px solid #e5e7eb; }
    .inline-error { background: #fff5f5; color: #c53030; border: 1px solid #feb2b2; border-radius: 6px; padding: 8px 12px; font-size: 12px; }

    /* Email modal */
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 50; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .modal-sheet { background: #fff; width: 100%; max-width: 480px; border-radius: 12px; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 12px 40px rgba(10,14,15,0.18); }
    .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid #f3f4f6; flex-shrink: 0; }
    .modal-title { font-size: 16px; font-weight: 700; color: #0a0e0f; }
    .modal-close { background: none; border: none; font-size: 18px; cursor: pointer; color: #9ca3af; padding: 0; line-height: 1; }
    .modal-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .modal-actions { padding: 12px 16px; border-top: 1px solid #f3f4f6; display: flex; gap: 8px; flex-shrink: 0; }
    .btn-secondary-sm { flex: 1; padding: 12px; border-radius: 10px; border: 1px solid #e5e7eb; background: #fff; font-size: 14px; font-weight: 600; cursor: pointer; color: #374151; }
    .btn-secondary-sm:disabled { opacity: 0.5; cursor: not-allowed; }
    .modal-send-btn { flex: 2; }

    /* Email preview fields */
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field label { font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; }
    .field input { padding: 8px 10px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 13px; }
    .field.readonly .field-value { font-size: 13px; color: #374151; }
    .email-body { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; font-size: 12px; max-height: 200px; overflow-y: auto; }

    /* Buttons */
    .btn { width: 100%; padding: 13px; border-radius: 10px; border: none; font-size: 16px; font-weight: 700; cursor: pointer; }
    .btn-clockin  { background: #2563eb; color: #fff; }
    .btn-clockout { background: #0891b2; color: #fff; }
    .btn-pass     { background: #276749; color: #fff; }
    .btn-pass:disabled { opacity: 0.4; cursor: not-allowed; }

    /* Success overlay */
    .success-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
    .success-card { background: white; border-radius: 16px; padding: 32px 24px; text-align: center; max-width: 320px; width: 90%; }
    .success-icon { font-size: 48px; color: #276749; margin-bottom: 12px; }
    .success-card h2 { font-size: 20px; font-weight: 700; margin: 0 0 12px; }
    .success-card p { font-size: 14px; color: #4a5568; margin: 0 0 20px; }
    .success-card .btn-pass { display: block; text-decoration: none; text-align: center; line-height: 1; }
    .warn-text { color: #b7791f; }

    .empty-state { text-align: center; padding: 48px 16px; color: #6b7280; }
  `],
})
export class QcComponent implements OnInit, OnDestroy {
  private route   = inject(ActivatedRoute);
  private http    = inject(HttpClient);
  private techSvc = inject(TechService);

  ctx          = signal<QcContext | null>(null);
  qcPhotos     = signal<QcPhotos | null>(null);
  emailPreview = signal<EmailPreview | null>(null);
  loadError    = signal(false);

  checkedItems   = signal<Record<string, boolean>>({});
  notes          = signal('');
  emailTo        = signal('');
  showEmailModal = signal(false);
  isUploading    = signal(false);
  passing        = signal(false);
  apiError       = signal<string | null>(null);
  passResult     = signal<PassResult | null>(null);

  clockedInSince = signal<Date | null>(null);
  elapsedSeconds = signal(0);
  elapsedDisplay = computed(() => formatElapsed(this.elapsedSeconds()));

  checkCount    = computed(() => Object.values(this.checkedItems()).filter(Boolean).length);
  progressWidth = computed(() => `${Math.round(this.checkCount() / 6 * 100)}%`);
  canPass       = computed(() =>
    this.checkCount() === 6
    && (this.ctx()?.allBuildTasksComplete ?? false)
    && !this.clockedInSince()
  );

  private roId    = '';
  private tickSub?: Subscription;

  ngOnInit(): void {
    this.roId = this.route.snapshot.paramMap.get('roId') ?? '';
    this.load();
  }

  ngOnDestroy(): void {
    this.tickSub?.unsubscribe();
  }

  load(): void {
    forkJoin({
      ctx:    this.http.get<QcContext>(`/api/tech/qc/${this.roId}`),
      photos: this.http.get<QcPhotos>(`/api/tech/qc/${this.roId}/photos`),
    }).subscribe({
      next: ({ ctx, photos }) => {
        this.ctx.set(ctx);
        this.qcPhotos.set(photos);
        this.loadError.set(false);

        const init: Record<string, boolean> = {};
        ctx.checklistItems.forEach(i => { init[i.itemCode] = i.checked; });

        // Auto-tick PHOTOS_COMPLETE when build photos already exist
        if (photos.totalCount > 0 && ctx.qcTask.status !== 'COMPLETED') {
          init['PHOTOS_COMPLETE'] = true;
        }
        this.checkedItems.set(init);

        this.emailTo.set(ctx.customerEmailDl ?? '');

        if (ctx.qcTask.clockedInSince) {
          this.clockedInSince.set(new Date(ctx.qcTask.clockedInSince));
          this.startTimer();
        }
      },
      error: () => this.loadError.set(true),
    });
  }

  toggleItem(code: string): void {
    if (this.ctx()?.qcTask.status === 'COMPLETED') return;
    const newValue = !this.checkedItems()[code];
    this.checkedItems.update(prev => ({ ...prev, [code]: newValue }));
    this.http.put(`/api/tech/qc/${this.roId}/items/${code}`, { passed: newValue }).subscribe();
  }

  handleClockIn(): void {
    const taskId = this.ctx()?.qcTask.id;
    if (!taskId) return;
    this.techSvc.clockIn(taskId).subscribe({
      next: r => {
        this.clockedInSince.set(new Date(r.clockIn));
        this.startTimer();
      },
    });
  }

  handleClockOut(): void {
    const taskId = this.ctx()?.qcTask.id;
    if (!taskId) return;
    this.techSvc.clockOut(taskId).subscribe({
      next: () => {
        this.clockedInSince.set(null);
        this.stopTimer();
        this.load();
      },
    });
  }

  openEmailModal(): void {
    this.showEmailModal.set(true);
    if (!this.emailPreview()) {
      this.loadEmailPreview();
    }
  }

  closeEmailModal(): void {
    if (!this.passing()) this.showEmailModal.set(false);
  }

  loadEmailPreview(): void {
    this.emailPreview.set(null);
    this.http.get<EmailPreview>(`/api/tech/qc/${this.roId}/email-preview`).subscribe({
      next: p => {
        this.emailPreview.set(p);
        if (!this.emailTo()) this.emailTo.set(p.to);
      },
    });
  }

  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    this.isUploading.set(true);
    const form = new FormData();
    form.append('file', file);
    this.http.post<{ attachmentId: string; fileName: string; url: string; uploadedAt: string }>(
      `/api/tech/qc/${this.roId}/photos`, form,
    ).subscribe({
      next: photo => {
        this.isUploading.set(false);
        const newEntry: PhotoEntry = {
          id: photo.attachmentId, fileName: photo.fileName,
          url: photo.url, uploadedAt: photo.uploadedAt, uploadedByName: '',
        };
        this.qcPhotos.update(prev => {
          if (!prev) return prev;
          const groups = [...prev.groups];
          const qcIdx = groups.findIndex(g =>
            g.operationName.toLowerCase().includes('qc') ||
            g.operationName.toLowerCase().includes('blue plate'));
          if (qcIdx >= 0) {
            groups[qcIdx] = { ...groups[qcIdx], photos: [...groups[qcIdx].photos, newEntry] };
          } else {
            groups.push({ operationName: 'Blue Plate QC', photos: [newEntry] });
          }
          // Auto-tick PHOTOS_COMPLETE on first photo
          if (prev.totalCount === 0) {
            this.checkedItems.update(items => ({ ...items, PHOTOS_COMPLETE: true }));
            this.http.put(`/api/tech/qc/${this.roId}/items/PHOTOS_COMPLETE`, { passed: true }).subscribe();
          }
          return { groups, totalCount: prev.totalCount + 1 };
        });
      },
      error: () => this.isUploading.set(false),
    });
  }

  pass(): void {
    this.passing.set(true);
    this.apiError.set(null);

    const responses = Object.entries(this.checkedItems()).map(([itemCode, checked]) => ({ itemCode, checked }));
    const body = {
      checklistResponses: responses,
      notes:   this.notes() || null,
      emailTo: this.emailTo() || null,
    };

    this.http.post<PassResult>(`/api/tech/qc/${this.roId}/pass`, body).subscribe({
      next: res => {
        this.passing.set(false);
        this.showEmailModal.set(false);
        this.passResult.set(res);
      },
      error: err => {
        const errors = err?.error?.errors;
        const firstMsg = errors && typeof errors === 'object'
          ? (Object.values(errors).flat()[0] as string | undefined)
          : undefined;
        this.apiError.set(firstMsg ?? err?.error?.title ?? 'Failed to submit QC.');
        this.passing.set(false);
      },
    });
  }

  private startTimer(): void {
    this.stopTimer();
    const since = this.clockedInSince();
    if (!since) return;
    const update = () => this.elapsedSeconds.set(Math.floor((Date.now() - since.getTime()) / 1000));
    update();
    this.tickSub = interval(1000).subscribe(() => update());
  }

  private stopTimer(): void {
    this.tickSub?.unsubscribe();
    this.tickSub = undefined;
    this.elapsedSeconds.set(0);
  }
}
