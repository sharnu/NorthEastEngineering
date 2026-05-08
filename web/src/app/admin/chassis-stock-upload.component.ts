import {
  Component, inject, signal, computed, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  ChassisStockService,
  DryRunResult, CommitResult,
  ParsedChassisRow, ChassisUpdateDiff, ChassisStaleRow, ParseError,
} from './chassis-stock.service';
import { ThemeSwitcherComponent } from '../core/theme-switcher.component';

const MAX_DISPLAY_ROWS = 100;

@Component({
  selector: 'app-chassis-stock-upload',
  standalone: true,
  imports: [CommonModule, ThemeSwitcherComponent],
  template: `
    <div class="page-wrap">
      <!-- Top bar -->
      <div class="topbar">
        <div class="brand">
          <img class="brand-logo" src="assets/nee-logo.png" alt="North East Engineering" />
          <span class="brand-sub">Chassis Stock Upload</span>
        </div>
        <div class="topbar-right">
          <a class="nav-link" (click)="router.navigate(['/admin'])">Admin</a>
          <a class="nav-link" (click)="router.navigate(['/dashboard'])">Dashboard</a>
          <app-theme-switcher />
        </div>
      </div>

      <main class="stage">
        <div class="content">
          <h2 class="section-title">Weekly Chassis Inventory Upload</h2>
          <p class="hint">Upload a <strong>.xlsx</strong> file with chassis stock data. Review the diff before committing.</p>

          <!-- Drop zone -->
          <div
            class="drop-zone"
            [class.drop-zone--over]="isDragOver()"
            [class.drop-zone--has-file]="selectedFile()"
            (click)="fileInput.click()"
            (dragover)="onDragOver($event)"
            (dragleave)="onDragLeave()"
            (drop)="onDrop($event)">
            <input #fileInput type="file" accept=".xlsx" style="display:none"
                   (change)="onFileChange($event)" />
            @if (selectedFile(); as f) {
              <span class="drop-label">{{ f.name }} ({{ formatBytes(f.size) }})</span>
              <span class="drop-hint">Click or drag to replace</span>
            } @else {
              <span class="drop-label">Click or drag &amp; drop a .xlsx file here</span>
            }
          </div>

          <!-- Parse button -->
          <div class="actions">
            <button class="btn-primary"
                    [disabled]="!selectedFile() || parsing()"
                    (click)="parse()">
              @if (parsing()) { Parsing… } @else { Parse File }
            </button>
            @if (parseError()) {
              <span class="err-inline">{{ parseError() }}</span>
            }
          </div>

          <!-- Results -->
          @if (dryRun(); as dr) {
            <div class="results">
              <p class="summary">
                Parsed <strong>{{ dr.rowCount }}</strong> row(s).
                <strong>{{ dr.toInsert.length }}</strong> to insert,
                <strong>{{ dr.toUpdate.length }}</strong> to update,
                <strong>{{ dr.wouldBeStale.length }}</strong> would be stale.
              </p>

              <!-- Parse errors panel -->
              @if (dr.parseErrors.length > 0) {
                <div class="panel panel--error">
                  <div class="panel-header" (click)="toggleErrors()">
                    <span>Parse Errors ({{ dr.parseErrors.length }})</span>
                    <span class="chevron">{{ showErrors() ? '▲' : '▼' }}</span>
                  </div>
                  @if (showErrors()) {
                    <div class="panel-body">
                      <table class="data-table">
                        <thead><tr><th>Row</th><th>Message</th></tr></thead>
                        <tbody>
                          @for (e of dr.parseErrors; track e.row) {
                            <tr><td>{{ e.row }}</td><td>{{ e.message }}</td></tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  }
                </div>
              }

              <!-- Insert section -->
              <div class="panel">
                <div class="panel-header" (click)="toggleInsert()">
                  <span class="panel-title-green">Insert ({{ dr.toInsert.length }})</span>
                  <span class="chevron">{{ showInsert() ? '▲' : '▼' }}</span>
                </div>
                @if (showInsert() && dr.toInsert.length > 0) {
                  <div class="panel-body">
                    <table class="data-table">
                      <thead><tr><th>Chassis #</th><th>Body Type</th><th>Colour</th><th>Tag</th><th>Arrival</th></tr></thead>
                      <tbody>
                        @for (row of dr.toInsert.slice(0, maxRows); track row.chassisNumber) {
                          <tr>
                            <td>{{ row.chassisNumber }}</td>
                            <td>{{ row.bodyType ?? '—' }}</td>
                            <td>{{ row.colour ?? '—' }}</td>
                            <td>{{ row.tagNumber ?? '—' }}</td>
                            <td>{{ row.arrivalDate ?? '—' }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                    @if (dr.toInsert.length > maxRows) {
                      <p class="truncate-note">… and {{ dr.toInsert.length - maxRows }} more rows not shown.</p>
                    }
                  </div>
                }
                @if (showInsert() && dr.toInsert.length === 0) {
                  <div class="panel-body"><p class="empty">No new chassis to insert.</p></div>
                }
              </div>

              <!-- Update section -->
              <div class="panel">
                <div class="panel-header" (click)="toggleUpdate()">
                  <span class="panel-title-blue">Update ({{ dr.toUpdate.length }})</span>
                  <span class="chevron">{{ showUpdate() ? '▲' : '▼' }}</span>
                </div>
                @if (showUpdate() && dr.toUpdate.length > 0) {
                  <div class="panel-body">
                    <table class="data-table">
                      <thead><tr><th>Chassis #</th><th>Field</th><th>From</th><th>To</th></tr></thead>
                      <tbody>
                        @for (diff of dr.toUpdate.slice(0, maxRows); track diff.chassisNumber) {
                          @for (change of diff.changes; track change.field) {
                            <tr>
                              <td>{{ diff.chassisNumber }}</td>
                              <td>{{ change.field }}</td>
                              <td class="val-old">{{ change.from ?? '—' }}</td>
                              <td class="val-new">{{ change.to ?? '—' }}</td>
                            </tr>
                          }
                        }
                      </tbody>
                    </table>
                    @if (dr.toUpdate.length > maxRows) {
                      <p class="truncate-note">… and {{ dr.toUpdate.length - maxRows }} more chassis not shown.</p>
                    }
                  </div>
                }
                @if (showUpdate() && dr.toUpdate.length === 0) {
                  <div class="panel-body"><p class="empty">No field changes detected.</p></div>
                }
              </div>

              <!-- Stale section -->
              <div class="panel">
                <div class="panel-header" (click)="toggleStale()">
                  <span class="panel-title-amber">Would-Be Stale ({{ dr.wouldBeStale.length }})</span>
                  <span class="chevron">{{ showStale() ? '▲' : '▼' }}</span>
                </div>
                @if (showStale() && dr.wouldBeStale.length > 0) {
                  <div class="panel-body">
                    <p class="hint">These AVAILABLE chassis are not in this upload. They will not be automatically changed — they are shown for awareness.</p>
                    <table class="data-table">
                      <thead><tr><th>Chassis #</th><th>Last Seen (weeks ago)</th></tr></thead>
                      <tbody>
                        @for (row of dr.wouldBeStale.slice(0, maxRows); track row.chassisNumber) {
                          <tr>
                            <td>{{ row.chassisNumber }}</td>
                            <td>{{ row.lastSeenWeeksAgo < 0 ? 'never' : row.lastSeenWeeksAgo }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                    @if (dr.wouldBeStale.length > maxRows) {
                      <p class="truncate-note">… and {{ dr.wouldBeStale.length - maxRows }} more not shown.</p>
                    }
                  </div>
                }
                @if (showStale() && dr.wouldBeStale.length === 0) {
                  <div class="panel-body"><p class="empty">No stale chassis detected.</p></div>
                }
              </div>

              <!-- Commit button -->
              <div class="actions actions--commit">
                @if (dr.parseErrors.length > 0) {
                  <p class="warn-note">Resolve parse errors before committing.</p>
                }
                <button class="btn-danger"
                        [disabled]="dr.parseErrors.length > 0 || committing()"
                        (click)="commit()">
                  @if (committing()) { Committing… } @else { Commit to Database }
                </button>
              </div>
            </div>
          }

          <!-- Commit success toast -->
          @if (commitResult(); as cr) {
            <div class="toast toast--success">
              Committed: {{ cr.inserted }} inserted, {{ cr.updated }} updated,
              {{ cr.deliveredAuto }} auto-delivered, {{ cr.staleAfterUpload }} stale.
            </div>
          }

          <!-- Commit failure toast -->
          @if (commitErrorMsg()) {
            <div class="toast toast--error">
              Commit failed: {{ commitErrorMsg() }}
            </div>
          }
        </div>
      </main>
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 1024px; }

    .topbar {
      display: flex; justify-content: space-between; align-items: center;
      padding: 14px 28px; background: var(--topbar-bg); color: var(--topbar-text);
    }
    .brand { display: flex; flex-direction: row; align-items: center; gap: 12px; }
    .brand-logo { height: 48px; width: auto; filter: var(--logo-filter); }
    .brand-sub  { font-family: var(--mono); font-size: 11px; text-transform: uppercase;
                  letter-spacing: 0.12em; color: var(--topbar-sub); }
    .topbar-right { display: flex; align-items: center; gap: 16px; }
    .nav-link { font-size: 13px; color: var(--topbar-muted); cursor: pointer;
                padding: 5px 0; border-bottom: 1px solid transparent; }
    .nav-link:hover { color: var(--topbar-text); border-bottom-color: var(--topbar-border); }

    .stage { background: var(--paper); min-height: calc(100vh - 57px); }
    .content { max-width: 1100px; margin: 0 auto; padding: 32px 28px; }
    .section-title { font-family: var(--display); font-size: 20px; font-weight: 500;
                     color: var(--ink); margin: 0 0 8px; }
    .hint { font-size: 13px; color: var(--ink-3); margin: 0 0 20px; }

    /* Drop zone */
    .drop-zone {
      border: 2px dashed var(--rule);
      border-radius: 8px;
      padding: 40px 24px;
      text-align: center;
      cursor: pointer;
      background: var(--paper);
      transition: border-color 0.15s, background 0.15s;
      margin-bottom: 16px;
    }
    .drop-zone--over { border-color: var(--accent); background: rgba(0,0,0,0.03); }
    .drop-zone--has-file { border-color: var(--ink-3); }
    .drop-zone:hover { border-color: var(--ink-3); }
    .drop-label { display: block; font-size: 14px; color: var(--ink); font-weight: 500; }
    .drop-hint  { display: block; font-size: 12px; color: var(--ink-3); margin-top: 4px; }

    /* Actions */
    .actions { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .actions--commit { margin-top: 20px; justify-content: flex-end; }

    .btn-primary {
      background: var(--topbar-bg); color: var(--topbar-text);
      border: none; padding: 9px 20px; border-radius: 5px;
      font-size: 13px; font-weight: 500; cursor: pointer;
    }
    .btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-primary:not(:disabled):hover { opacity: 0.85; }

    .btn-danger {
      background: #c0392b; color: #fff;
      border: none; padding: 9px 20px; border-radius: 5px;
      font-size: 13px; font-weight: 500; cursor: pointer;
    }
    .btn-danger:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-danger:not(:disabled):hover { background: #a93226; }

    .err-inline { color: #c0392b; font-size: 13px; }
    .warn-note  { color: #c0392b; font-size: 12px; margin: 0; }

    /* Results */
    .results { margin-top: 8px; }
    .summary { font-size: 14px; color: var(--ink); margin-bottom: 16px; }

    /* Panels */
    .panel {
      border: 1px solid var(--rule);
      border-radius: 6px;
      margin-bottom: 12px;
      overflow: hidden;
    }
    .panel--error { border-color: #f5c6cb; }

    .panel-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 14px;
      background: var(--paper);
      cursor: pointer;
      user-select: none;
      font-size: 13px; font-weight: 500; color: var(--ink);
      border-bottom: 1px solid transparent;
    }
    .panel--error .panel-header { background: #fff5f5; border-bottom-color: #f5c6cb; color: #c0392b; }
    .panel-header:hover { background: rgba(0,0,0,0.03); }

    .panel-title-green { color: #27ae60; }
    .panel-title-blue  { color: #2980b9; }
    .panel-title-amber { color: #d68910; }

    .chevron { font-size: 10px; color: var(--ink-3); }
    .panel-body { padding: 12px 14px; overflow-x: auto; }
    .empty { font-size: 13px; color: var(--ink-3); margin: 0; }
    .truncate-note { font-size: 12px; color: var(--ink-3); margin-top: 8px; }

    /* Table */
    .data-table {
      width: 100%; border-collapse: collapse; font-size: 12px;
    }
    .data-table th {
      text-align: left; font-weight: 600; color: var(--ink-3);
      padding: 6px 10px; border-bottom: 1px solid var(--rule);
      white-space: nowrap;
    }
    .data-table td {
      padding: 6px 10px; border-bottom: 1px solid var(--rule);
      color: var(--ink); vertical-align: top;
    }
    .data-table tr:last-child td { border-bottom: none; }
    .val-old { color: #c0392b; text-decoration: line-through; }
    .val-new { color: #27ae60; font-weight: 500; }

    /* Toasts */
    .toast {
      position: fixed; bottom: 24px; right: 24px;
      padding: 14px 20px; border-radius: 6px;
      font-size: 13px; font-weight: 500;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      z-index: 1000; max-width: 480px;
    }
    .toast--success { background: #27ae60; color: #fff; }
    .toast--error   { background: #c0392b; color: #fff; }
  `],
})
export class ChassisStockUploadComponent {
  router = inject(Router);
  private svc = inject(ChassisStockService);

  readonly maxRows = MAX_DISPLAY_ROWS;

  selectedFile = signal<File | null>(null);
  parsing      = signal(false);
  committing   = signal(false);
  isDragOver   = signal(false);
  parseError   = signal<string | null>(null);
  dryRun       = signal<DryRunResult | null>(null);
  commitResult = signal<CommitResult | null>(null);
  commitErrorMsg = signal<string | null>(null);

  showErrors = signal(true);
  showInsert = signal(true);
  showUpdate = signal(true);
  showStale  = signal(false);

  toggleErrors() { this.showErrors.update(v => !v); }
  toggleInsert() { this.showInsert.update(v => !v); }
  toggleUpdate() { this.showUpdate.update(v => !v); }
  toggleStale()  { this.showStale.update(v => !v); }

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) this.setFile(input.files[0]);
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDragLeave() {
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.setFile(file);
  }

  private setFile(file: File) {
    this.selectedFile.set(file);
    this.parseError.set(null);
    this.dryRun.set(null);
    this.commitResult.set(null);
    this.commitErrorMsg.set(null);
  }

  async parse() {
    const file = this.selectedFile();
    if (!file) return;

    if (!file.name.endsWith('.xlsx')) {
      this.parseError.set('Only .xlsx files are accepted.');
      return;
    }

    this.parsing.set(true);
    this.parseError.set(null);
    this.dryRun.set(null);
    this.commitResult.set(null);
    this.commitErrorMsg.set(null);

    try {
      const result = await firstValueFrom(this.svc.upload(file));
      this.dryRun.set(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      this.parseError.set(msg);
    } finally {
      this.parsing.set(false);
    }
  }

  async commit() {
    const dr = this.dryRun();
    if (!dr || dr.parseErrors.length > 0) return;

    this.committing.set(true);
    this.commitErrorMsg.set(null);

    try {
      const result = await firstValueFrom(this.svc.commit(dr.uploadId));
      this.commitResult.set(result);
      this.dryRun.set(null);
      this.selectedFile.set(null);
      // Auto-hide toast after 8s
      setTimeout(() => this.commitResult.set(null), 8000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Commit failed. Please try again.';
      this.commitErrorMsg.set(msg);
    } finally {
      this.committing.set(false);
    }
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }
}
