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
  rego: string | null;
  sourceRoNumber: string | null;
  jobTypeName: string | null;
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

  // E17 — Variance Root Cause
  getVarianceRootCause(filters: VarianceFilters): Observable<VarianceReport> {
    let p = new HttpParams();
    if (filters.from)          p = p.set('from', filters.from);
    if (filters.to)            p = p.set('to', filters.to);
    if (filters.groupBy)       p = p.set('groupBy', filters.groupBy);
    if (filters.minSampleSize) p = p.set('minSampleSize', String(filters.minSampleSize));
    return this.http.get<VarianceReport>('/api/dashboard/reports/variance-root-cause', { params: p });
  }

  getVarianceRootCauseRecords(args: VarianceFilters & { groupKey: string; page?: number; pageSize?: number }):
      Observable<VarianceRecordsPage> {
    let p = new HttpParams().set('groupKey', args.groupKey);
    if (args.from)     p = p.set('from', args.from);
    if (args.to)       p = p.set('to', args.to);
    if (args.groupBy)  p = p.set('groupBy', args.groupBy);
    if (args.page)     p = p.set('page', String(args.page));
    if (args.pageSize) p = p.set('pageSize', String(args.pageSize));
    return this.http.get<VarianceRecordsPage>('/api/dashboard/reports/variance-root-cause/records', { params: p });
  }

  varianceRootCauseCsvUrl(filters: VarianceFilters): string {
    const sp = new URLSearchParams();
    if (filters.from)          sp.set('from', filters.from);
    if (filters.to)            sp.set('to', filters.to);
    if (filters.groupBy)       sp.set('groupBy', filters.groupBy);
    if (filters.minSampleSize) sp.set('minSampleSize', String(filters.minSampleSize));
    return `/api/dashboard/reports/variance-root-cause/csv?${sp.toString()}`;
  }

  // E18 — Customer Concentration
  getCustomerConcentration(period: ConcentrationPeriod = 'last_quarter'):
      Observable<CustomerConcentrationReport> {
    return this.http.get<CustomerConcentrationReport>(
      `/api/dashboard/reports/customer-concentration?period=${period}`);
  }

  getCustomerConcentrationTrend(customerId: string): Observable<CustomerTrend> {
    return this.http.get<CustomerTrend>(
      `/api/dashboard/reports/customer-concentration/trend?customerId=${customerId}`);
  }

  customerConcentrationCsvUrl(period: ConcentrationPeriod): string {
    return `/api/dashboard/reports/customer-concentration/csv?period=${period}`;
  }

  // E20 — Strategic Forecasting
  getForecast(): Observable<ForecastReport> {
    return this.http.get<ForecastReport>('/api/dashboard/reports/forecast');
  }
}

// E17 types
export type VarianceGroupBy = 'reason' | 'station' | 'template' | 'technician';

export interface VarianceFilters {
  from?: string; to?: string; groupBy?: VarianceGroupBy; minSampleSize?: number;
}

export interface VarianceReasonBreakdown {
  reasonCode: string; reasonName: string; isOverrun: boolean;
  deltaHours: number; count: number;
}

export interface VarianceRow {
  groupKey: string; groupLabel: string;
  totalDeltaHours: number; sampleSize: number;
  byReason: VarianceReasonBreakdown[];
}

export interface VarianceReport {
  groupBy: VarianceGroupBy;
  from: string; to: string;
  totalSampleSize: number; totalDeltaHours: number;
  rows: VarianceRow[];
}

export interface VarianceRecordRow {
  recordId: string; recordedAt: string;
  roId: string; roNumber: string;
  operationName: string; stationName: string;
  templateCode: string; technicianName: string | null;
  estimatedHours: number; actualHours: number;
  deltaHours: number; deltaPercent: number | null;
  reasonCode: string; reasonName: string;
  notes: string | null;
}

export interface VarianceRecordsPage {
  items: VarianceRecordRow[]; totalCount: number; page: number; pageSize: number;
}

// E18 types
export type ConcentrationPeriod = 'last_quarter' | 'last_year' | 'ytd';

export interface CustomerConcentrationRow {
  customerId: string; customerCode: string; customerName: string;
  roCount: number; totalHours: number;
  percentOfTotal: number; cumulativePercent: number;
  topRanked: boolean;
}

export interface CustomerConcentrationReport {
  period: ConcentrationPeriod;
  from: string; to: string;
  totalRoCount: number; totalHours: number;
  rows: CustomerConcentrationRow[];
}

export interface CustomerTrendPoint {
  quarterLabel: string; quarterStart: string;
  roCount: number; totalHours: number;
}

export interface CustomerTrend {
  customerId: string; quarters: CustomerTrendPoint[];
}

// E20 types
export interface ForecastFactor {
  key: string; weight: number; description: string;
}

export interface ForecastRow {
  roId: string; roNumber: string;
  customerName: string; templateCode: string;
  scheduledStartWeek: string;
  requiredDate: string | null;
  projectedCompletionDate: string;
  daysAtRisk: number;
  riskScore: number;
  riskTier: 'LOW' | 'MED' | 'HIGH';
  bottleneckStationId: number | null;
  bottleneckStationName: string | null;
  factors: ForecastFactor[];
}

export interface ForecastReport {
  computedAt: string;
  rows: ForecastRow[];
}
