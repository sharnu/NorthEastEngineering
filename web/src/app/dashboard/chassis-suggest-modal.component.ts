import {
  Component, Input, Output, EventEmitter,
  OnChanges, SimpleChanges, signal, inject, HostListener,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';

interface ScoreBreakdown { tag: number; colour: number; proximity: number; }
interface ChassisSuggestion {
  chassisId: string;
  chassisNumber: string;
  bodyType: string | null;
  colour: string | null;
  tagNumber: string | null;
  arrivalDate: string | null;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  reason: string;
}
export interface SuggestionsResponse {
  roId: string;
  roBodyType: string | null;
  candidates: ChassisSuggestion[];
}

@Component({
  selector: 'app-chassis-suggest-modal',
  standalone: true,
  imports: [CommonModule, DatePipe],
  template: `
    @if (open) {
      <div class="suggest-backdrop" (click)="onBackdropClick($event)">
        <div class="suggest-panel" role="dialog" aria-modal="true" aria-label="Chassis suggestions">
          <div class="suggest-header">
            <span class="suggest-title">Chassis suggestions</span>
            <button class="suggest-close" (click)="close()" aria-label="Close">✕</button>
          </div>

          @if (loading()) {
            <div class="suggest-body"><p class="state-msg">Loading suggestions…</p></div>
          } @else if (err()) {
            <div class="suggest-body"><p class="state-msg state-err">{{ err() }}</p></div>
          } @else if (data()?.candidates?.length === 0) {
            <div class="suggest-body">
              <p class="state-msg">No matching chassis in stock — adjust the tag or upload this week's stock sheet.</p>
              <a class="link-sm" href="/admin/chassis-stock">Go to chassis stock upload →</a>
            </div>
          } @else {
            <div class="suggest-body">
              @for (c of data()!.candidates; track c.chassisId) {
                <div class="candidate">
                  <div class="candidate-top">
                    <span class="cnum">{{ c.chassisNumber }}</span>
                    <span [class]="scoreCls(c.score)">{{ c.score }}</span>
                  </div>
                  <div class="meta-row">
                    @if (c.bodyType)    { <span class="meta">{{ c.bodyType }}</span> }
                    @if (c.colour)      { <span class="meta">{{ c.colour }}</span> }
                    @if (c.tagNumber)   { <span class="meta">Tag: {{ c.tagNumber }}</span> }
                    @if (c.arrivalDate) { <span class="meta">Arrived: {{ c.arrivalDate | date:'dd MMM yy' }}</span> }
                  </div>
                  <div class="breakdown">
                    tag {{ c.scoreBreakdown.tag }} · colour {{ c.scoreBreakdown.colour }} · proximity {{ c.scoreBreakdown.proximity }}
                  </div>
                  <p class="reason">{{ c.reason }}</p>
                  <button class="btn-allocate" (click)="doAllocate(c)">Allocate</button>
                </div>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .suggest-backdrop { position: fixed; inset: 0; background: rgba(10,14,15,.45);
      display: flex; align-items: center; justify-content: center; z-index: 10000; }
    .suggest-panel { background: white; border-radius: 12px; width: 440px;
      max-width: calc(100vw - 32px); max-height: 90vh; overflow-y: auto;
      box-shadow: 0 8px 40px rgba(10,14,15,.2); }
    .suggest-header { display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px; border-bottom: .5px solid var(--rule);
      position: sticky; top: 0; background: white; z-index: 1; }
    .suggest-title { font-family: var(--mono); font-size: 11px; text-transform: uppercase;
      letter-spacing: .1em; color: var(--ink-3); font-weight: 500; }
    .suggest-close { background: none; border: none; cursor: pointer;
      font-size: 14px; color: var(--ink-3); padding: 2px 4px; line-height: 1; }
    .suggest-close:hover { color: var(--ink); }
    .suggest-body { padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }

    .state-msg { font-size: 13px; color: var(--ink-3); margin: 8px 0; }
    .state-err { color: var(--bad); }
    .link-sm { font-size: 12px; color: var(--accent); text-decoration: none; }
    .link-sm:hover { text-decoration: underline; }

    .candidate { border: .5px solid var(--rule); border-radius: 8px; padding: 14px;
      display: flex; flex-direction: column; gap: 6px; }
    .candidate-top { display: flex; align-items: center; justify-content: space-between; }
    .cnum { font-family: var(--mono); font-size: 14px; font-weight: 600; color: var(--ink); }
    .score-badge { padding: 2px 8px; border-radius: 3px; font-family: var(--mono);
      font-size: 11px; font-weight: 600; }
    .score-green { background: #dcfce7; color: #166534; }
    .score-amber { background: #fef9c3; color: var(--warn); }
    .score-grey  { background: var(--paper-3); color: var(--ink-3); }

    .meta-row { display: flex; flex-wrap: wrap; gap: 4px; }
    .meta { font-size: 11px; padding: 1px 6px; border-radius: 3px;
      background: var(--paper-3); color: var(--ink-3); font-family: var(--mono); }
    .breakdown { font-family: var(--mono); font-size: 10px; color: var(--ink-3); }
    .reason { font-size: 12px; color: var(--ink); margin: 0; }

    .btn-allocate { align-self: flex-end; padding: 6px 16px; border-radius: 6px;
      border: none; font-size: 12px; font-weight: 500; cursor: pointer;
      background: var(--accent); color: white; margin-top: 4px; }
    .btn-allocate:hover { opacity: .9; }
  `],
})
export class ChassisSuggestModalComponent implements OnChanges {
  private http = inject(HttpClient);

  @Input() open = false;
  @Input() roId: string | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() allocated = new EventEmitter<{ chassisId: string; chassisNumber: string; roId: string }>();

  data    = signal<SuggestionsResponse | null>(null);
  loading = signal(false);
  err     = signal<string | null>(null);

  ngOnChanges(changes: SimpleChanges) {
    if ((changes['open'] || changes['roId']) && this.open && this.roId) {
      this.load();
    }
    if (changes['open'] && !this.open) {
      this.data.set(null);
      this.err.set(null);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() { if (this.open) this.close(); }

  private load() {
    this.loading.set(true);
    this.err.set(null);
    this.http.get<SuggestionsResponse>(`/api/scheduling/ros/${this.roId}/chassis-suggestions`).subscribe({
      next:  d => { this.data.set(d); this.loading.set(false); },
      error: () => { this.err.set('Failed to load suggestions.'); this.loading.set(false); },
    });
  }

  doAllocate(c: ChassisSuggestion) {
    this.http.post(`/api/scheduling/chassis/${c.chassisId}/allocate`, { roId: this.roId }).subscribe({
      next: () => {
        this.allocated.emit({ chassisId: c.chassisId, chassisNumber: c.chassisNumber, roId: this.roId! });
        this.close();
      },
      error: () => this.err.set('Allocation failed — the chassis may have been taken.'),
    });
  }

  close() { this.closed.emit(); }

  onBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('suggest-backdrop')) this.close();
  }

  scoreCls(score: number) {
    return score >= 100 ? 'score-badge score-green'
         : score >= 50  ? 'score-badge score-amber'
         :                'score-badge score-grey';
  }
}
