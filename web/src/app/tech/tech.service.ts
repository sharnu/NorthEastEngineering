import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface TechTask {
  id: string;
  roId: string;
  roNumber: string;
  sequence: number;
  operationName: string;
  stationName: string;
  estimatedHours: number;
  actualHours: number;
  status: string;
  priority: number;
  customerName: string;
  requiredDate: string | null;
  clockedInSince: string | null;
}

export interface TimeEntryItem {
  id: string;
  clockIn: string;
  clockOut: string | null;
  durationMinutes: number | null;
  activityType: string;
}

export interface TechTaskDetail extends TechTask {
  operationId: number;
  jobCodeLine: string;
  notes: string | null;
  ro: {
    customerName: string;
    rego: string | null;
    make: string | null;
    model: string | null;
    paintColour: string | null;
    requiredDate: string | null;
  };
  timeEntries: TimeEntryItem[];
}

export interface PhotoItem {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  url: string;
}

export interface VarianceReason {
  id: number;
  code: string;
  name: string;
  isOverrun: boolean;
}

export interface ClockInResult {
  entryId: string;
  clockIn: string;
}

export interface ClockOutResult {
  entryId: string;
  clockIn: string;
  clockOut: string;
  durationMinutes: number | null;
}

export interface CompleteTaskResult {
  taskId: string;
  actualHours: number;
  deltaHours: number;
  reasonName: string;
}

export interface BlockResult {
  taskId: string;
  roNumber: string;
  blockedAt: string;
}

@Injectable({ providedIn: 'root' })
export class TechService {
  private http = inject(HttpClient);

  getMyTasks(): Observable<TechTask[]> {
    return this.http.get<TechTask[]>('/api/tech/tasks');
  }

  getTask(id: string): Observable<TechTaskDetail> {
    return this.http.get<TechTaskDetail>(`/api/tech/tasks/${id}`);
  }

  clockIn(id: string): Observable<ClockInResult> {
    return this.http.post<ClockInResult>(`/api/tech/tasks/${id}/clock-in`, {});
  }

  clockOut(id: string): Observable<ClockOutResult> {
    return this.http.post<ClockOutResult>(`/api/tech/tasks/${id}/clock-out`, {});
  }

  uploadPhoto(id: string, file: File): Observable<{ attachmentId: string; fileName: string; uploadedAt: string }> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<{ attachmentId: string; fileName: string; uploadedAt: string }>(
      `/api/tech/tasks/${id}/photos`,
      form,
    );
  }

  getPhotos(id: string): Observable<PhotoItem[]> {
    return this.http.get<PhotoItem[]>(`/api/tech/tasks/${id}/photos`);
  }

  getVarianceReasons(): Observable<VarianceReason[]> {
    return this.http.get<VarianceReason[]>('/api/variance-reasons');
  }

  completeTask(id: string, body: { varianceReasonId: number; notes?: string }): Observable<CompleteTaskResult> {
    return this.http.post<CompleteTaskResult>(`/api/tech/tasks/${id}/complete`, body);
  }

  blockTask(id: string, reason: string): Observable<BlockResult> {
    return this.http.post<BlockResult>(`/api/tech/tasks/${id}/block`, { reason });
  }

  unblockTask(id: string): Observable<void> {
    return this.http.post<void>(`/api/tech/tasks/${id}/unblock`, {});
  }
}
