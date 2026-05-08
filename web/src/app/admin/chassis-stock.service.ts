import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ParsedChassisRow {
  chassisNumber: string;
  bodyType?: string;
  colour?: string;
  tagNumber?: string;
  arrivalDate?: string;
}

export interface ChassisUpdateDiff {
  chassisNumber: string;
  changes: { field: string; from: string | null; to: string | null }[];
}

export interface ChassisStaleRow {
  chassisNumber: string;
  lastSeenWeeksAgo: number;
}

export interface ParseError {
  row: number;
  message: string;
}

export interface DryRunResult {
  uploadId: string;
  rowCount: number;
  toInsert: ParsedChassisRow[];
  toUpdate: ChassisUpdateDiff[];
  wouldBeStale: ChassisStaleRow[];
  parseErrors: ParseError[];
}

export interface CommitResult {
  inserted: number;
  updated: number;
  deliveredAuto: number;
  staleAfterUpload: number;
}

@Injectable({ providedIn: 'root' })
export class ChassisStockService {
  private http = inject(HttpClient);

  upload(file: File): Observable<DryRunResult> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<DryRunResult>('/api/scheduling/chassis/upload-inventory', form);
  }

  commit(uploadId: string): Observable<CommitResult> {
    return this.http.post<CommitResult>(
      `/api/scheduling/chassis/upload-inventory/${uploadId}/commit`,
      {}
    );
  }
}
