import { Component, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { switchMap, catchError, distinctUntilChanged } from 'rxjs/operators';
import { of } from 'rxjs';
import { FlowData, KanbanService } from './kanban.service';
import { computed } from '@angular/core';

@Component({
  selector: 'app-flow-ribbon',
  standalone: true,
  imports: [],
  template: `
    @if (flow(); as f) {
      @if (f.tracks.length) {
        <div class="flow-ribbon" [class.compact]="compact()">
          <div class="flow-ribbon-head">
            <div class="flow-ribbon-title">Flow · {{ f.bodyType }}</div>
            <div class="flow-ribbon-meta">{{ ribbonMeta(f) }}</div>
          </div>
          <div class="flow-tracks">
            @for (track of f.tracks; track track.track) {
              <div [class]="'flow-track-label ' + track.track.toLowerCase()">
                {{ trackLabel(track.track) }}
              </div>
              <div class="flow-track-row">
                @for (step of track.steps; track step.stationId; let last = $last) {
                  @if (step.isMergePoint) {
                    <span [class]="'flow-merge ' + step.stepStatus.toLowerCase()">
                      {{ step.stationName }}
                    </span>
                  } @else {
                    <span [class]="'flow-step ' + step.stepStatus.toLowerCase()">
                      {{ step.stationName }}
                    </span>
                  }
                  @if (!last) {
                    <span class="flow-arrow">→</span>
                  }
                }
              </div>
            }
          </div>
        </div>
      }
    } @else if (loading()) {
      <div class="flow-ribbon flow-ribbon--loading" [class.compact]="compact()">
        <span class="flow-loading-text">Loading flow…</span>
      </div>
    }
  `,
  styles: [`
    .flow-ribbon {
      background: white;
      border: 0.5px solid var(--rule);
      border-radius: 14px;
      padding: 14px 18px;
      margin: 0 28px 10px;
    }
    .flow-ribbon.compact {
      margin: 0 0 14px;
      border-radius: 8px;
    }
    .flow-ribbon--loading {
      padding: 10px 18px;
    }
    .flow-ribbon--loading.compact {
      margin: 0 0 14px;
    }
    .flow-loading-text {
      font-family: var(--mono);
      font-size: 11px;
      color: var(--ink-3);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .flow-ribbon-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 10px;
    }
    .flow-ribbon-title {
      font-family: var(--display);
      font-weight: 500;
      font-size: 14px;
      letter-spacing: -0.01em;
      color: var(--ink);
    }
    .flow-ribbon-meta {
      font-family: var(--mono);
      font-size: 11px;
      color: var(--ink-3);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .flow-tracks {
      display: grid;
      grid-template-columns: 90px 1fr;
      row-gap: 8px;
      column-gap: 12px;
      align-items: center;
    }
    .flow-track-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-weight: 500;
      color: var(--ink-3);
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .flow-track-label::before {
      content: '';
      width: 7px;
      height: 7px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }
    .flow-track-label.body::before    { background: #1d4ed8; }
    .flow-track-label.chassis::before { background: #b45309; }
    .flow-track-label.subframe::before{ background: #7c3aed; }
    .flow-track-label.any::before     { background: var(--ink-3); }

    .flow-track-row {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
    }

    .flow-step {
      background: var(--paper);
      border: 0.5px solid var(--rule);
      border-radius: 6px;
      padding: 4px 9px;
      font-size: 11px;
      color: var(--ink-2);
      white-space: nowrap;
    }
    .flow-step.done {
      background: #dcfce7;
      border-color: #86efac;
      color: #15803d;
    }
    .flow-step.active {
      background: var(--ink);
      border-color: var(--ink);
      color: var(--paper);
    }
    .flow-step.blocked {
      background: #fee2e2;
      border-color: #fca5a5;
      color: #b91c1c;
    }

    .flow-merge {
      background: #c2410c;
      color: white;
      border: 0.5px solid #c2410c;
      border-radius: 6px;
      padding: 4px 9px;
      font-size: 11px;
      font-weight: 500;
      white-space: nowrap;
    }
    .flow-merge::before { content: '⇉ '; }
    .flow-merge.done {
      background: #15803d;
      border-color: #15803d;
    }
    .flow-merge.active {
      background: var(--ink);
      border-color: var(--ink);
    }
    .flow-merge.blocked {
      background: #b91c1c;
      border-color: #b91c1c;
    }

    .flow-arrow {
      color: var(--ink-3);
      font-size: 11px;
      font-family: var(--mono);
    }
  `],
})
export class FlowRibbonComponent {
  private svc        = inject(KanbanService);
  private destroyRef = inject(DestroyRef);

  roId      = input.required<string>();
  compact   = input<boolean>(false);
  refreshAt = input<number>(0);
  flow      = signal<FlowData | null>(null);
  loading   = signal(true);

  // Combines roId + refreshAt into a string nonce so any change triggers a re-fetch
  private nonce = computed(() => `${this.roId()}::${this.refreshAt()}`);

  constructor() {
    toObservable(this.nonce).pipe(
      distinctUntilChanged(),
      switchMap(nonce => {
        const roId = nonce.split('::')[0];
        this.flow.set(null);
        this.loading.set(true);
        return this.svc.getFlow(roId).pipe(catchError(() => of(null)));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(data => {
      this.flow.set(data);
      this.loading.set(false);
    });
  }

  ribbonMeta(f: FlowData): string {
    if (!f.tracks.length) return '';
    const trackNames = f.tracks.map(t => this.trackLabel(t.track));
    if (trackNames.length === 1) return `${trackNames[0]} track`;
    const last = trackNames[trackNames.length - 1];
    return `${trackNames.slice(0, -1).join(', ')} & ${last} run in parallel`;
  }

  trackLabel(track: string): string {
    const map: Record<string, string> = {
      BODY: 'Body', CHASSIS: 'Chassis', SUBFRAME: 'Subframe', ANY: 'Common',
    };
    return map[track] ?? track;
  }
}
