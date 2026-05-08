import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface KanbanCardTaskDto {
  id: string;
  sequence: number;
  jobCodeLine: string;
  operationName: string;
  assignedToUserId: string | null;
  assignedToName: string | null;
  estimatedHours: number;
  actualHours: number;
  status: string;
  flowTrack: string;
  notes: string | null;
}

export interface KanbanCardDto {
  roId: string;
  roNumber: string;
  customerName: string;
  priority: number;
  requiredDate: string | null;
  bodyType: string | null;
  track: string;
  stationId: number;
  stationCode: string;
  stationName: string;
  gateState: string;
  gateReason: string | null;
  estimatedHours: number;
  actualHours: number;
  totalTasks: number;
  completedTasks: number;
  sourcePdfUrl: string | null;
  hasManualOverride: boolean;
  tasks: KanbanCardTaskDto[];
}

export interface KanbanStationDto {
  stationId: number;
  stationCode: string;
  stationName: string;
  ownerName: string | null;
  cards: KanbanCardDto[];
}

export interface KanbanBoardDto {
  stations: KanbanStationDto[];
}

// Kept for task-drawer.component.ts (E23-S3 will migrate it to KanbanCardDto)
export interface KanbanTaskDto {
  id: string;
  roId: string;
  roNumber: string;
  sequence: number;
  jobCodeLine: string;
  operationName: string;
  assignedToUserId: string | null;
  assignedToName: string | null;
  estimatedHours: number;
  actualHours: number;
  status: string;
  priority: number;
  customerName: string;
  requiredDate: string | null;
  stationId: number;
  stationName: string;
  notes: string | null;
  hasManualOverride: boolean;
  overrideAt: string | null;
  overrideReason: string | null;
  overrideByName: string | null;
}

export interface FlowStep {
  stationId: number;
  stationName: string;
  stepStatus: 'DONE' | 'ACTIVE' | 'PENDING' | 'BLOCKED';
  isMergePoint: boolean;
}

export interface FlowTrack {
  track: string;
  steps: FlowStep[];
}

export interface FlowData {
  roId: string;
  bodyType: string | null;
  tracks: FlowTrack[];
}

export interface StationTechnicianDto {
  userId: string;
  fullName: string;
  isPrimary: boolean;
  skillLevel: number;
}

@Injectable({ providedIn: 'root' })
export class KanbanService {
  private http = inject(HttpClient);

  // Signal store — callers (board component, future SignalR listener) read from here.
  // Call refresh() to fetch and commit a new snapshot.
  readonly boardSignal = signal<KanbanBoardDto | null>(null);

  // Fetches the board and updates boardSignal. Called by the board component's
  // polling loop and will be called by the SignalR KanbanUpdated listener (E25).
  refresh(stationId?: number): void {
    this.getBoard(stationId).subscribe(board => this.boardSignal.set(board));
  }

  getBoard(stationId?: number): Observable<KanbanBoardDto> {
    const url = stationId ? `/api/kanban?stationId=${stationId}` : '/api/kanban';
    return this.http.get<KanbanBoardDto>(url);
  }

  getTechnicians(stationId: number): Observable<StationTechnicianDto[]> {
    return this.http.get<StationTechnicianDto[]>(`/api/stations/${stationId}/technicians`);
  }

  assignTask(taskId: string, userId: string | null): Observable<void> {
    return this.http.put<void>(`/api/job-tasks/${taskId}/assign`, { userId });
  }

  forceAdvance(roId: string, stationId: number, reason: string): Observable<void> {
    return this.http.post<void>(`/api/kanban/ros/${roId}/force-advance`, { stationId, reason });
  }

  getFlow(roId: string): Observable<FlowData> {
    return this.http.get<FlowData>(`/api/repair-orders/${roId}/flow`);
  }
}
