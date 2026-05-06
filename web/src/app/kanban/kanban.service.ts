import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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

export interface KanbanStationDto {
  stationId: number;
  stationCode: string;
  stationName: string;
  ownerName: string | null;
  tasks: KanbanTaskDto[];
}

export interface KanbanBoardDto {
  stations: KanbanStationDto[];
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
}
