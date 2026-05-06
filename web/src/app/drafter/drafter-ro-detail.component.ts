import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
  DrafterService, DrafterRoDetail, DrafterArtefact,
  DRAFTER_STATUS_LABELS, CATEGORY_LABELS,
} from './drafter.service';

type Category = 'DRAFT_LAYOUT' | 'DRAFT_BOM' | 'DRAFT_DRAWING_PACK';

@Component({
  selector: 'app-drafter-ro-detail',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule],
  template: `
    <div class="detail-header">
      <button class="back-btn" (click)="router.navigate(['/drafter'])">← Queue</button>
      @if (ro()) {
        <h2 class="ro-title">{{ ro()!.roNumber }}</h2>
        <span class="pill" [class]="'status-' + ro()!.draftingStatus">{{ label(ro()!.draftingStatus) }}</span>
      }
    </div>

    @if (loading()) {
      <div class="loading">Loading…</div>
    } @else if (error()) {
      <div class="error-state">{{ error() }}</div>
    } @else if (ro()) {
      <div class="detail-layout">

        <!-- Left: RO Summary + Tasks -->
        <div class="summary-col">
          <section class="card">
            <h3 class="card-title">RO Summary</h3>
            <dl class="field-grid">
              <dt>Customer</dt><dd>{{ ro()!.customerName }}</dd>
              <dt>Template</dt><dd>{{ ro()!.templateCode }} — {{ ro()!.templateName }}</dd>
              <dt>Priority</dt><dd>P{{ ro()!.priority }}</dd>
              <dt>Required</dt><dd>{{ ro()!.requiredDate ? (ro()!.requiredDate | date:'dd MMM yyyy') : '—' }}</dd>
              @if (ro()!.notes) {
                <dt>Notes</dt><dd>{{ ro()!.notes }}</dd>
              }
            </dl>
          </section>

          <section class="card">
            <h3 class="card-title">Tasks ({{ ro()!.tasks.length }})</h3>
            <table class="tasks-table">
              <thead>
                <tr><th>#</th><th>Operation</th><th>Est. Hours</th><th>Status</th></tr>
              </thead>
              <tbody>
                @for (t of ro()!.tasks; track t.id) {
                  <tr>
                    <td>{{ t.sequence }}</td>
                    <td>{{ t.operationName }}</td>
                    <td class="mono">{{ t.estimatedHours }}h</td>
                    <td><span class="pill task-{{ t.status }}">{{ t.status }}</span></td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        </div>

        <!-- Right: Artefacts + Status -->
        <div class="artefacts-col">

          <!-- Status panel -->
          <section class="card status-panel">
            <h3 class="card-title">Drafting Status</h3>
            <span class="status-pill pill" [class]="'status-' + ro()!.draftingStatus">{{ label(ro()!.draftingStatus) }}</span>

            <div class="action-buttons">
              @if (ro()!.draftingStatus === 'NOT_STARTED') {
                <button class="btn btn-primary" [disabled]="saving()" (click)="transition('IN_PROGRESS')">
                  Start Drafting
                </button>
              }
              @if (ro()!.draftingStatus === 'IN_PROGRESS') {
                <button class="btn btn-warning" [disabled]="saving()" (click)="transition('ON_HOLD')">
                  Put On Hold
                </button>
                <button class="btn btn-success" [disabled]="saving() || !hasArtefacts()" (click)="openCompleteModal()"
                        [title]="!hasArtefacts() ? 'Upload at least one artefact before marking complete' : ''">
                  Mark Complete
                </button>
              }
              @if (ro()!.draftingStatus === 'ON_HOLD') {
                <button class="btn btn-primary" [disabled]="saving()" (click)="transition('IN_PROGRESS')">
                  Resume Drafting
                </button>
              }
              @if (ro()!.draftingStatus === 'COMPLETED') {
                <p class="completed-note">
                  Drafting completed on {{ ro()!.draftedAt | date:'dd MMM yyyy HH:mm' }}.
                </p>
              }
            </div>
          </section>

          <!-- Artefact panels -->
          @for (cat of categories; track cat.key) {
            <section class="card artefact-panel">
              <h3 class="card-title">{{ cat.label }}</h3>
              <div class="file-list">
                @for (a of artefactsFor(cat.key); track a.id) {
                  <div class="file-row">
                    <div class="file-info">
                      <span class="file-icon">{{ isPdf(a) ? '📄' : '📎' }}</span>
                      <div>
                        @if (isPdf(a)) {
                          <button class="file-name-btn" (click)="previewArtefact.set(a)">{{ a.fileName }}</button>
                        } @else {
                          <a class="file-name" [href]="a.url" target="_blank" rel="noopener">{{ a.fileName }}</a>
                        }
                        <span class="file-meta">{{ a.uploaderName }} · {{ a.uploadedAt | date:'dd MMM HH:mm' }}</span>
                      </div>
                    </div>
                    <div class="file-actions">
                      @if (isPdf(a)) {
                        <button class="preview-btn" (click)="previewArtefact.set(a)">Preview</button>
                      }
                      @if (!isDraftingComplete()) {
                        <button class="del-btn" (click)="confirmDelete(a)">✕</button>
                      }
                    </div>
                  </div>
                }
                @if (artefactsFor(cat.key).length === 0) {
                  <p class="no-files">No files uploaded yet.</p>
                }
              </div>
              @if (!isDraftingComplete()) {
                <div class="drop-zone"
                     [class.drag-over]="dragOver() === cat.key"
                     (dragover)="$event.preventDefault(); dragOver.set(cat.key)"
                     (dragleave)="dragOver.set(null)"
                     (drop)="onDrop($event, cat.key)">
                  <span>Drop file here or</span>
                  <label class="browse-btn">
                    Browse
                    <input type="file" hidden (change)="onFileSelect($event, cat.key)">
                  </label>
                  @if (uploading() === cat.key) {
                    <span class="uploading">Uploading…</span>
                  }
                </div>
              }
            </section>
          }

        </div>
      </div>
    }

    <!-- PDF preview modal -->
    @if (previewArtefact()) {
      <div class="modal-overlay" (click)="previewArtefact.set(null)">
        <div class="pdf-modal" (click)="$event.stopPropagation()">
          <div class="pdf-modal-header">
            <span class="pdf-modal-name">{{ previewArtefact()!.fileName }}</span>
            <div class="pdf-modal-actions">
              <a class="pdf-download-btn" [href]="previewArtefact()!.url" target="_blank" rel="noopener">Download</a>
              <button class="close-btn" (click)="previewArtefact.set(null)">✕</button>
            </div>
          </div>
          <iframe class="pdf-iframe" [src]="safePdfUrl()"></iframe>
        </div>
      </div>
    }

    <!-- Complete modal -->
    @if (showCompleteModal()) {
      <div class="modal-overlay" (click)="showCompleteModal.set(false)">
        <div class="modal" (click)="$event.stopPropagation()">
          <h3 class="modal-title">Mark Drafting Complete</h3>
          <p class="modal-body">
            This will mark drafting as complete and notify supervisors that the RO is ready to schedule.
          </p>
          <label class="modal-label">Handoff notes (optional)</label>
          <textarea class="modal-textarea" rows="3" [(ngModel)]="completeNotes" placeholder="Any notes for the supervisor…"></textarea>
          <div class="modal-actions">
            <button class="btn btn-ghost" (click)="showCompleteModal.set(false)">Cancel</button>
            <button class="btn btn-success" [disabled]="saving()" (click)="markComplete()">Confirm Complete</button>
          </div>
        </div>
      </div>
    }

    <!-- Delete confirmation modal -->
    @if (pendingDelete()) {
      <div class="modal-overlay" (click)="pendingDelete.set(null)">
        <div class="modal" (click)="$event.stopPropagation()">
          <h3 class="modal-title">Delete Artefact</h3>
          <p class="modal-body">Delete <strong>{{ pendingDelete()!.fileName }}</strong>? This cannot be undone.</p>
          <div class="modal-actions">
            <button class="btn btn-ghost" (click)="pendingDelete.set(null)">Cancel</button>
            <button class="btn btn-danger" [disabled]="saving()" (click)="deleteArtefact()">Delete</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .detail-header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
    .back-btn { background: none; border: 1px solid var(--rule); border-radius: 6px;
                padding: 5px 12px; cursor: pointer; font-size: 13px; color: var(--ink-3); }
    .back-btn:hover { color: var(--ink); }
    .ro-title { font-size: 20px; font-weight: 600; margin: 0; flex: 1; }
    .detail-layout { display: grid; grid-template-columns: 1fr 380px; gap: 20px; align-items: start; }
    .card { background: #fff; border: 1px solid var(--rule); border-radius: 8px; padding: 20px; margin-bottom: 16px; }
    .card-title { font-size: 14px; font-weight: 600; margin: 0 0 14px; text-transform: uppercase;
                  letter-spacing: 0.06em; color: var(--ink-3); }
    .field-grid { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 0; font-size: 13px; }
    dt { color: var(--ink-3); font-weight: 500; }
    .tasks-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .tasks-table th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--rule);
                      font-size: 10px; text-transform: uppercase; color: var(--ink-3); }
    .tasks-table td { padding: 7px 8px; border-bottom: 1px solid var(--rule); }
    .mono { font-family: var(--mono); }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; }
    .status-NOT_STARTED { background: #f0f0f0; color: #555; }
    .status-IN_PROGRESS { background: #e8f4fd; color: #1a6bb5; }
    .status-ON_HOLD     { background: #fff3cd; color: #856404; }
    .status-COMPLETED   { background: #d4edda; color: #155724; }
    .task-PENDING       { background: #f0f0f0; color: #555; }
    .task-IN_PROGRESS   { background: #e8f4fd; color: #1a6bb5; }
    .task-COMPLETE      { background: #d4edda; color: #155724; }
    .status-panel { text-align: center; }
    .status-pill { font-size: 13px; margin-bottom: 16px; display: inline-block; }
    .action-buttons { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
    .btn { padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: #1a6bb5; color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #1558a0; }
    .btn-success { background: #28a745; color: #fff; }
    .btn-success:hover:not(:disabled) { background: #218838; }
    .btn-warning { background: #ffc107; color: #212529; }
    .btn-warning:hover:not(:disabled) { background: #e0a800; }
    .btn-danger  { background: #dc3545; color: #fff; }
    .btn-danger:hover:not(:disabled)  { background: #c82333; }
    .btn-ghost   { background: none; border: 1px solid var(--rule); color: var(--ink); }
    .btn-ghost:hover:not(:disabled)   { background: var(--rule); }
    .completed-note { font-size: 12px; color: var(--ink-3); margin: 8px 0 0; }
    .artefact-panel { }
    .file-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; min-height: 24px; }
    .file-row { display: flex; align-items: center; justify-content: space-between;
                padding: 6px 0; border-bottom: 1px solid var(--rule); }
    .file-info { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
    .file-icon { font-size: 18px; flex-shrink: 0; }
    .file-name { font-size: 13px; color: #1a6bb5; text-decoration: none; }
    .file-name:hover { text-decoration: underline; }
    .file-name-btn { background: none; border: none; padding: 0; font-size: 13px; color: #1a6bb5;
                     cursor: pointer; text-align: left; }
    .file-name-btn:hover { text-decoration: underline; }
    .file-meta { display: block; font-size: 11px; color: var(--ink-3); margin-top: 2px; }
    .file-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
    .preview-btn { background: none; border: 1px solid var(--rule); border-radius: 4px; padding: 2px 8px;
                   font-size: 11px; cursor: pointer; color: #1a6bb5; white-space: nowrap; }
    .preview-btn:hover { background: #e8f4fd; }
    .del-btn { background: none; border: none; cursor: pointer; color: var(--ink-3); font-size: 14px; padding: 2px 6px; }
    .del-btn:hover { color: #dc3545; }
    .pdf-modal { background: #fff; border-radius: 12px; width: 90vw; max-width: 1000px;
                 height: 90vh; display: flex; flex-direction: column;
                 box-shadow: 0 24px 80px rgba(0,0,0,0.3); overflow: hidden; }
    .pdf-modal-header { display: flex; align-items: center; justify-content: space-between;
                        padding: 14px 20px; border-bottom: 1px solid var(--rule); flex-shrink: 0; }
    .pdf-modal-name { font-size: 14px; font-weight: 500; color: var(--ink); overflow: hidden;
                      text-overflow: ellipsis; white-space: nowrap; }
    .pdf-modal-actions { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
    .pdf-download-btn { font-size: 13px; color: #1a6bb5; text-decoration: none; }
    .pdf-download-btn:hover { text-decoration: underline; }
    .close-btn { background: none; border: none; font-size: 20px; cursor: pointer; color: var(--ink-3);
                 line-height: 1; padding: 0 2px; }
    .close-btn:hover { color: var(--ink); }
    .pdf-iframe { flex: 1; border: none; width: 100%; }
    .no-files { font-size: 12px; color: var(--ink-3); margin: 4px 0; }
    .drop-zone { border: 1.5px dashed #ccc; border-radius: 8px; padding: 12px;
                 display: flex; align-items: center; gap: 8px; justify-content: center;
                 font-size: 12px; color: var(--ink-3); transition: border-color 0.15s; }
    .drop-zone.drag-over { border-color: #1a6bb5; background: #e8f4fd; }
    .browse-btn { cursor: pointer; color: #1a6bb5; font-weight: 500; }
    .browse-btn:hover { text-decoration: underline; }
    .uploading { color: #1a6bb5; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000;
                     display: flex; align-items: center; justify-content: center; }
    .modal { background: #fff; border-radius: 12px; padding: 28px; max-width: 440px; width: 100%; }
    .modal-title { font-size: 16px; font-weight: 600; margin: 0 0 12px; }
    .modal-body { font-size: 13px; color: var(--ink-3); margin-bottom: 16px; }
    .modal-label { font-size: 12px; font-weight: 500; display: block; margin-bottom: 6px; }
    .modal-textarea { width: 100%; border: 1px solid var(--rule); border-radius: 6px;
                      padding: 8px; font-size: 13px; resize: vertical; box-sizing: border-box; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
    .loading, .error-state { text-align: center; padding: 48px 0; color: var(--ink-3); }
    .error-state { color: #dc3545; }
    @media (max-width: 900px) {
      .detail-layout { grid-template-columns: 1fr; }
    }
  `],
})
export class DrafterRoDetailComponent implements OnInit {
  private svc       = inject(DrafterService);
  private route     = inject(ActivatedRoute);
  private sanitizer = inject(DomSanitizer);
  router            = inject(Router);

  ro      = signal<DrafterRoDetail | null>(null);
  loading = signal(true);
  error   = signal<string | null>(null);
  saving  = signal(false);
  uploading = signal<string | null>(null);
  dragOver  = signal<string | null>(null);

  previewArtefact = signal<DrafterArtefact | null>(null);
  safePdfUrl = computed((): SafeResourceUrl | null => {
    const a = this.previewArtefact();
    return a ? this.sanitizer.bypassSecurityTrustResourceUrl(a.url) : null;
  });

  showCompleteModal = signal(false);
  completeNotes     = '';
  pendingDelete     = signal<DrafterArtefact | null>(null);

  categories: { key: Category; label: string }[] = [
    { key: 'DRAFT_LAYOUT',       label: CATEGORY_LABELS['DRAFT_LAYOUT'] },
    { key: 'DRAFT_BOM',          label: CATEGORY_LABELS['DRAFT_BOM'] },
    { key: 'DRAFT_DRAWING_PACK', label: CATEGORY_LABELS['DRAFT_DRAWING_PACK'] },
  ];

  hasArtefacts       = computed(() => (this.ro()?.artefacts?.length ?? 0) > 0);
  isDraftingComplete = computed(() => this.ro()?.draftingStatus === 'COMPLETED');

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.load(id);
  }

  async load(id: string) {
    this.loading.set(true);
    this.error.set(null);
    try {
      const detail = await this.svc.getRoDetail(id);
      this.ro.set(detail);
    } catch {
      this.error.set('Failed to load RO details.');
    } finally {
      this.loading.set(false);
    }
  }

  artefactsFor(cat: string) {
    return this.ro()?.artefacts.filter(a => a.category === cat) ?? [];
  }

  isPdf(a: DrafterArtefact) {
    return a.contentType === 'application/pdf' || a.fileName.toLowerCase().endsWith('.pdf');
  }

  label(status: string) { return DRAFTER_STATUS_LABELS[status] ?? status; }

  async transition(toStatus: string) {
    if (!this.ro()) return;
    this.saving.set(true);
    try {
      await this.svc.updateStatus(this.ro()!.id, toStatus);
      await this.load(this.ro()!.id);
    } catch {
      alert('Failed to update status. Please try again.');
    } finally {
      this.saving.set(false);
    }
  }

  openCompleteModal() { this.completeNotes = ''; this.showCompleteModal.set(true); }

  async markComplete() {
    if (!this.ro()) return;
    this.saving.set(true);
    try {
      await this.svc.updateStatus(this.ro()!.id, 'COMPLETED', this.completeNotes || undefined);
      this.showCompleteModal.set(false);
      await this.load(this.ro()!.id);
    } catch {
      alert('Failed to mark complete. Please try again.');
    } finally {
      this.saving.set(false);
    }
  }

  onFileSelect(event: Event, category: string) {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) this.uploadFile(input.files[0], category);
    input.value = '';
  }

  onDrop(event: DragEvent, category: string) {
    event.preventDefault();
    this.dragOver.set(null);
    const file = event.dataTransfer?.files[0];
    if (file) this.uploadFile(file, category);
  }

  async uploadFile(file: File, category: string) {
    if (!this.ro()) return;
    this.uploading.set(category);
    try {
      await this.svc.uploadArtefact(this.ro()!.id, category, file);
      await this.load(this.ro()!.id);
    } catch {
      alert('Upload failed. Please try again.');
    } finally {
      this.uploading.set(null);
    }
  }

  confirmDelete(a: DrafterArtefact) { this.pendingDelete.set(a); }

  async deleteArtefact() {
    const a = this.pendingDelete();
    if (!a || !this.ro()) return;
    this.saving.set(true);
    try {
      await this.svc.deleteArtefact(this.ro()!.id, a.id);
      this.pendingDelete.set(null);
      await this.load(this.ro()!.id);
    } catch {
      alert('Delete failed. Please try again.');
    } finally {
      this.saving.set(false);
    }
  }
}
