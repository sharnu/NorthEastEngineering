import { Component, EventEmitter, Output, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-blocker-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="overlay" (click)="cancel.emit()">
      <div class="sheet" (click)="$event.stopPropagation()">
        <h3 class="sheet-title">Report Blocker</h3>
        <p class="hint-text">Describe what is blocking this task (minimum 10 characters).</p>

        <div class="field">
          <label for="blocker-reason">Reason</label>
          <textarea
            id="blocker-reason"
            rows="4"
            [ngModel]="reason()"
            (ngModelChange)="reason.set($event)"
            placeholder="e.g. Waiting for chassis to arrive from supplier...">
          </textarea>
          @if (reason().length > 0 && reason().length < 10) {
            <span class="error">At least 10 characters required ({{ reason().length }}/10)</span>
          }
        </div>

        <div class="actions">
          <button class="btn-secondary" (click)="cancel.emit()">Cancel</button>
          <button class="btn-danger" [disabled]="!isValid()" (click)="submit()">Report Blocker</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .overlay {
      position: fixed; inset: 0;
      background: rgba(10,14,15,0.4);
      display: flex; align-items: flex-end;
      z-index: 200;
      animation: fadeIn 0.2s ease;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .sheet {
      background: white;
      width: 100%; max-width: 480px;
      margin: 0 auto;
      border-radius: 16px 16px 0 0;
      padding: 24px 20px 32px;
      max-height: 80vh;
      overflow-y: auto;
      animation: slideUp 0.25s ease;
    }
    @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
    .sheet-title { margin: 0 0 4px; font-family: var(--display); font-size: 20px; font-weight: 500; color: var(--ink); }
    .hint-text { color: var(--ink-3); margin: 0 0 20px; font-size: 13px; }
    .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
    label { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
            font-weight: 500; color: var(--ink-3); }
    textarea {
      border: 0.5px solid var(--rule-strong); border-radius: 6px;
      padding: 8px 10px; font-size: 13px; font-family: var(--sans);
      background: var(--paper); color: var(--ink);
      width: 100%; box-sizing: border-box; resize: vertical;
    }
    textarea:focus { outline: none; border-color: var(--accent); background: white; }
    .error { font-family: var(--mono); color: var(--bad); font-size: 11px; }
    .actions { display: flex; gap: 8px; margin-top: 8px; }
    .btn-danger, .btn-secondary {
      flex: 1; padding: 12px; border-radius: 8px;
      font-size: 13px; font-weight: 500; cursor: pointer; border: none;
    }
    .btn-danger { background: var(--bad); color: white; }
    .btn-danger:disabled { background: var(--paper-3); color: var(--ink-3); cursor: not-allowed; }
    .btn-secondary { background: var(--paper-2); color: var(--ink); }
    .btn-secondary:hover { background: var(--paper-3); }
  `],
})
export class BlockerModalComponent {
  @Output() confirmed = new EventEmitter<string>();
  @Output() cancel = new EventEmitter<void>();

  reason = signal('');
  isValid = computed(() => this.reason().trim().length >= 10);

  submit(): void {
    if (!this.isValid()) return;
    this.confirmed.emit(this.reason().trim());
  }
}
