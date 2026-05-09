import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StationCardComponent } from './station-card.component';
import { KanbanCardDto } from './kanban.service';

function card(overrides: Partial<KanbanCardDto>): KanbanCardDto {
  return {
    roId: 'aaaaaaaa-0000-0000-0000-000000000001',
    roNumber: 'RO00001',
    customerName: 'DFE',
    priority: 2,
    requiredDate: '2026-09-01T00:00:00Z',
    scheduledStartWeek: null,
    bodyType: 'TIPPER_CS',
    track: 'BODY',
    stationId: 20,
    stationCode: 'FAB_LINE',
    stationName: 'Fabrication Line',
    gateState: 'IN_PROGRESS',
    gateReason: null,
    estimatedHours: 14,
    actualHours: 5.5,
    totalTasks: 4,
    completedTasks: 1,
    sourcePdfUrl: '/uploads/sample.pdf',
    hasManualOverride: false,
    tasks: [
      { id: 't1', sequence: 1, jobCodeLine: 'TP42N-001', operationName: 'CNC + base', assignedToUserId: null, assignedToName: null, estimatedHours: 5.5, actualHours: 5.5, status: 'COMPLETED', flowTrack: 'BODY', notes: null },
      { id: 't2', sequence: 2, jobCodeLine: 'TP42N-002', operationName: 'Mfr headboard', assignedToUserId: null, assignedToName: 'Peter Rogers', estimatedHours: 2.5, actualHours: 0, status: 'ASSIGNED', flowTrack: 'BODY', notes: null },
      { id: 't3', sequence: 3, jobCodeLine: 'TP42N-003', operationName: 'Mfr dropsides', assignedToUserId: null, assignedToName: null, estimatedHours: 4, actualHours: 0, status: 'PENDING', flowTrack: 'BODY', notes: null },
      { id: 't4', sequence: 4, jobCodeLine: 'TP42N-004', operationName: 'Fab line assy', assignedToUserId: null, assignedToName: null, estimatedHours: 2, actualHours: 0, status: 'PENDING', flowTrack: 'BODY', notes: null },
    ],
    ...overrides,
  };
}

const READY_CARD = card({
  roNumber: 'RO00002',
  gateState: 'READY',
  completedTasks: 4,
  actualHours: 14,
  tasks: [
    { id: 'r1', sequence: 1, jobCodeLine: 'L1', operationName: 'CNC + base', assignedToUserId: null, assignedToName: null, estimatedHours: 5.5, actualHours: 5.5, status: 'COMPLETED', flowTrack: 'BODY', notes: null },
    { id: 'r2', sequence: 2, jobCodeLine: 'L2', operationName: 'Mfr headboard', assignedToUserId: null, assignedToName: null, estimatedHours: 2.5, actualHours: 2.5, status: 'COMPLETED', flowTrack: 'BODY', notes: null },
    { id: 'r3', sequence: 3, jobCodeLine: 'L3', operationName: 'Mfr dropsides', assignedToUserId: null, assignedToName: null, estimatedHours: 4, actualHours: 4, status: 'COMPLETED', flowTrack: 'BODY', notes: null },
    { id: 'r4', sequence: 4, jobCodeLine: 'L4', operationName: 'Fab line assy', assignedToUserId: null, assignedToName: null, estimatedHours: 2, actualHours: 2, status: 'COMPLETED', flowTrack: 'BODY', notes: null },
  ],
});

const GATED_CARD = card({
  roNumber: 'RO00003',
  gateState: 'GATED',
  gateReason: 'Waiting for chassis delivery — expected 2026-09-15',
  bodyType: 'PANTECH_AL',
  track: 'CHASSIS',
});

const MIXED_CARD = card({
  roNumber: 'RO00004',
  gateState: 'IN_PROGRESS',
  bodyType: 'TAUTLINER',
  track: 'MIXED',
  totalTasks: 5,
  completedTasks: 2,
  tasks: [
    { id: 'm1', sequence: 1, jobCodeLine: 'L1', operationName: 'Chassis prep', assignedToUserId: null, assignedToName: null, estimatedHours: 3, actualHours: 3, status: 'COMPLETED', flowTrack: 'CHASSIS', notes: null },
    { id: 'm2', sequence: 2, jobCodeLine: 'L2', operationName: 'Hyva kit fit', assignedToUserId: null, assignedToName: null, estimatedHours: 4, actualHours: 4, status: 'COMPLETED', flowTrack: 'CHASSIS', notes: null },
    { id: 'm3', sequence: 3, jobCodeLine: 'L3', operationName: 'Body fitout', assignedToUserId: null, assignedToName: null, estimatedHours: 6, actualHours: 0, status: 'PENDING', flowTrack: 'BODY', notes: null },
    { id: 'm4', sequence: 4, jobCodeLine: 'L4', operationName: 'Curtain side install', assignedToUserId: null, assignedToName: null, estimatedHours: 3, actualHours: 0, status: 'PENDING', flowTrack: 'BODY', notes: null },
    { id: 'm5', sequence: 5, jobCodeLine: 'L5', operationName: 'Final fitment', assignedToUserId: null, assignedToName: null, estimatedHours: 2, actualHours: 0, status: 'PENDING', flowTrack: 'BODY', notes: null },
  ],
});

@Component({
  selector: 'app-station-card-dev',
  standalone: true,
  imports: [CommonModule, StationCardComponent],
  template: `
    <div class="dev-page">
      <h1 class="dev-title">station-card preview</h1>
      <p class="dev-sub">E22-S2 — three states: in-progress · ready · gated · mixed</p>
      <div class="dev-grid">
        <div class="dev-col">
          <p class="dev-label">IN_PROGRESS (default)</p>
          <app-station-card [card]="inProgress" />
        </div>
        <div class="dev-col">
          <p class="dev-label">READY (all tasks done)</p>
          <app-station-card [card]="ready" />
        </div>
        <div class="dev-col">
          <p class="dev-label">GATED (with tooltip reason)</p>
          <app-station-card [card]="gated" />
        </div>
        <div class="dev-col">
          <p class="dev-label">MIXED track</p>
          <app-station-card [card]="mixed" />
        </div>
      </div>
    </div>
  `,
  styles: [`
    .dev-page { padding: 32px; background: var(--paper); min-height: 100vh; }
    .dev-title { font-family: var(--display); font-size: 24px; font-weight: 500; color: var(--ink); margin-bottom: 4px; }
    .dev-sub   { font-family: var(--mono); font-size: 11px; color: var(--ink-3); margin-bottom: 32px; }
    .dev-grid  { display: flex; gap: 24px; flex-wrap: wrap; }
    .dev-col   { width: 290px; }
    .dev-label { font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
                 color: var(--ink-3); margin-bottom: 8px; }
    app-station-card {
      display: block;
      background: white;
      border: 0.5px solid var(--rule);
      border-radius: 10px;
      overflow: hidden;
      cursor: pointer;
      transition: all 0.15s ease;
      position: relative;
    }
    app-station-card.gated {
      border-style: dashed;
      border-color: var(--rule-strong);
      background: repeating-linear-gradient(45deg, white, white 8px, #faf7ee 8px, #faf7ee 14px);
    }
    app-station-card.ready  { border-color: var(--good); box-shadow: inset 3px 0 0 var(--good); }
    app-station-card.complete { background: #f0fdf4; border-color: #86efac; }
  `],
})
export class StationCardDevComponent {
  inProgress = card({});
  ready      = READY_CARD;
  gated      = GATED_CARD;
  mixed      = MIXED_CARD;
}
