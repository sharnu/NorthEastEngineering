import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TechService, VarianceReason } from './tech.service';

@Component({
  selector: 'app-variance-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="overlay" (click)="cancel.emit()">
      <div class="sheet" (click)="$event.stopPropagation()">
        <h3 class="sheet-title">Over-Estimate Variance</h3>
        <p class="delta-text">Delta: {{ deltaHours | number:'1.2-2' }} hrs over estimate</p>

        <div class="field">
          <label for="reason-select">Reason</label>
          <select id="reason-select" [(ngModel)]="selectedReasonId">
            <option value="">-- Select reason --</option>
            @for (r of reasons(); track r.id) {
              <option [value]="r.id">{{ r.name }}</option>
            }
          </select>
        </div>

        <div class="field">
          <label for="variance-notes">Notes (optional)</label>
          <textarea id="variance-notes" rows="3" [(ngModel)]="notes" placeholder="Add any context..."></textarea>
        </div>

        <div class="actions">
          <button class="btn-secondary" (click)="cancel.emit()">Cancel</button>
          <button class="btn-primary" [disabled]="!selectedReasonId" (click)="submit()">Submit</button>
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
    .delta-text { font-family: var(--mono); color: var(--bad); margin: 0 0 20px; font-size: 13px; }
    .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
    label { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
            font-weight: 500; color: var(--ink-3); }
    select, textarea {
      border: 0.5px solid var(--rule-strong); border-radius: 6px;
      padding: 8px 10px; font-size: 13px; font-family: var(--sans);
      background: var(--paper); color: var(--ink);
      width: 100%; box-sizing: border-box;
    }
    select:focus, textarea:focus { outline: none; border-color: var(--accent); background: white; }
    .actions { display: flex; gap: 8px; margin-top: 8px; }
    .btn-primary, .btn-secondary {
      flex: 1; padding: 12px; border-radius: 8px;
      font-size: 13px; font-weight: 500; cursor: pointer; border: none;
    }
    .btn-primary { background: var(--accent); color: white; }
    .btn-primary:disabled { background: var(--paper-3); color: var(--ink-3); cursor: not-allowed; }
    .btn-secondary { background: var(--paper-2); color: var(--ink); }
    .btn-secondary:hover { background: var(--paper-3); }
  `],
})
export class VarianceModalComponent implements OnInit {
  @Input() deltaHours = 0;
  @Output() confirmed = new EventEmitter<{ reasonId: number; notes: string | undefined }>();
  @Output() cancel = new EventEmitter<void>();

  private techService = inject(TechService);

  reasons = signal<VarianceReason[]>([]);
  selectedReasonId = '';
  notes = '';

  ngOnInit(): void {
    this.techService.getVarianceReasons().subscribe(r => this.reasons.set(r));
  }

  submit(): void {
    if (!this.selectedReasonId) return;
    this.confirmed.emit({
      reasonId: Number(this.selectedReasonId),
      notes: this.notes.trim() || undefined,
    });
  }
}
