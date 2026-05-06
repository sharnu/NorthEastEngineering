import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface QueueItem {
  id: string;
  roNumber: string;
  customerName: string;
  templateName: string;
  draftingStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED';
  priority: number;
  requiredDate: string | null;
}

export interface DrafterArtefact {
  id: string;
  category: 'DRAFT_LAYOUT' | 'DRAFT_BOM' | 'DRAFT_DRAWING_PACK';
  fileName: string;
  contentType: string;
  sizeBytes: number;
  url: string;
  uploadedBy: string;
  uploaderName: string;
  uploadedAt: string;
}

export interface DrafterTask {
  id: string;
  sequence: number;
  jobCodeLine: string;
  operationName: string;
  estimatedHours: number;
  status: string;
  stationId: number;
  name: string;
}

export interface DrafterRoDetail {
  id: string;
  roNumber: string;
  draftingStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED';
  draftedBy: string | null;
  draftedAt: string | null;
  priority: number;
  notes: string | null;
  requiredDate: string | null;
  customerName: string;
  templateCode: string;
  templateName: string;
  tasks: DrafterTask[];
  artefacts: DrafterArtefact[];
}

export const DRAFTER_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
};

export const CATEGORY_LABELS: Record<string, string> = {
  DRAFT_LAYOUT: 'Layout',
  DRAFT_BOM: 'Bill of Materials',
  DRAFT_DRAWING_PACK: 'Drawing Pack',
};

@Injectable({ providedIn: 'root' })
export class DrafterService {
  private http = inject(HttpClient);

  getQueue() {
    return firstValueFrom(this.http.get<QueueItem[]>('/api/drafter/queue'));
  }

  getRoDetail(roId: string) {
    return firstValueFrom(this.http.get<DrafterRoDetail>(`/api/drafter/ros/${roId}`));
  }

  updateStatus(roId: string, status: string, notes?: string) {
    return firstValueFrom(
      this.http.put<void>(`/api/drafter/ros/${roId}/status`, { status, notes: notes ?? null })
    );
  }

  uploadArtefact(roId: string, category: string, file: File) {
    const form = new FormData();
    form.append('file', file);
    return firstValueFrom(
      this.http.post<{ attachmentId: string; fileName: string; category: string; url: string; uploadedAt: string }>(
        `/api/drafter/ros/${roId}/artefacts?category=${category}`,
        form
      )
    );
  }

  deleteArtefact(roId: string, artefactId: string) {
    return firstValueFrom(
      this.http.delete<void>(`/api/drafter/ros/${roId}/artefacts/${artefactId}`)
    );
  }
}
