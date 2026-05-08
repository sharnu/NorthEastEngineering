import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface KpiData {
  activeRos: number;
  hoursScheduled: number;
  hoursUtilised: number;
  utilisationPct: number;
  inHospitalCount: number;
  onTimePct: number;
  overdueCount: number;
}

export interface StationLoad {
  stationId: number;
  stationCode: string;
  stationName: string;
  ownerName: string | null;
  openTasks: number;
  activeTasks: number;
  hoursRemaining: number | null;
}

export interface TopVarianceItem {
  taskId: string;
  roNumber: string;
  operationName: string;
  stationName: string;
  estimatedHours: number;
  actualHours: number;
  deltaHours: number;
  deltaPct: number | null;
  reasonName: string;
  technicianName: string | null;
}

export interface ActiveRo {
  id: string;
  roNumber: string;
  customerName: string;
  templateCode: string;
  bodyType: string;
  currentStage: string | null;
  status: string;
  priority: number;
  requiredDate: string | null;
  hoursScheduled: number;
  hoursUtilised: number;
  taskCount: number;
  tasksCompleted: number;
  completionPct: number;
}

export interface ThroughputWeek {
  weekStart: string;
  completed: number;
  inProgress: number;
  blocked: number;
}

export interface JobTypeRef {
  id: number;
  name: string;
}

export interface ArchiveRo {
  id: string;
  roNumber: string;
  sourceRoNumber: string | null;
  rego: string | null;
  customerName: string;
  jobTypeName: string;
  bodyType: string | null;
  roDate: string;
  completedAt: string;
  estimatedHours: number;
  actualHours: number;
}

export interface ArchivePage {
  totalCount: number;
  page: number;
  pageSize: number;
  rows: ArchiveRo[];
}

export interface ArchiveParams {
  search?: string;
  from?: string;
  to?: string;
  jobTypeId?: number;
  sortBy?: string;
  sortDir?: string;
  page?: number;
  pageSize?: number;
}

export interface CalibrationRow {
  templateCode: string;
  operationName: string;
  templateEstimate: number;
  avgActual: number | null;
  avgDelta: number | null;
  sampleSize: number;
  stddevActual: number | null;
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private http = inject(HttpClient);

  getKpis(): Observable<KpiData> {
    return this.http.get<KpiData>('/api/dashboard/kpis');
  }

  getStationLoad(): Observable<StationLoad[]> {
    return this.http.get<StationLoad[]>('/api/dashboard/station-load');
  }

  getTopVariance(): Observable<TopVarianceItem[]> {
    return this.http.get<TopVarianceItem[]>('/api/dashboard/top-variance');
  }

  getActiveRos(status?: string, customerId?: string): Observable<ActiveRo[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    if (customerId) params = params.set('customerId', customerId);
    return this.http.get<ActiveRo[]>('/api/dashboard/active-ros', { params });
  }

  getJobTypes(): Observable<JobTypeRef[]> {
    return this.http.get<JobTypeRef[]>('/api/dashboard/job-types');
  }

  getArchive(params: ArchiveParams = {}): Observable<ArchivePage> {
    let p = new HttpParams()
      .set('page',     String(params.page     ?? 1))
      .set('pageSize', String(params.pageSize ?? 50));
    if (params.search)    p = p.set('search',    params.search);
    if (params.from)      p = p.set('from',      params.from);
    if (params.to)        p = p.set('to',        params.to);
    if (params.jobTypeId) p = p.set('jobTypeId', String(params.jobTypeId));
    if (params.sortBy)    p = p.set('sortBy',    params.sortBy);
    if (params.sortDir)   p = p.set('sortDir',   params.sortDir);
    return this.http.get<ArchivePage>('/api/dashboard/archive', { params: p });
  }

  getThroughput(): Observable<ThroughputWeek[]> {
    return this.http.get<ThroughputWeek[]>('/api/dashboard/reports/throughput');
  }

  getCalibration(templateCode?: string): Observable<CalibrationRow[]> {
    let params = new HttpParams();
    if (templateCode) params = params.set('templateCode', templateCode);
    return this.http.get<CalibrationRow[]>('/api/dashboard/reports/calibration', { params });
  }
}
