import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AdminUserSummary {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  shortCode: string | null;
  isActive: boolean;
  roles: string[];
  stations: string[];
}

export interface UserListResponse {
  items: AdminUserSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface CreateUserRequest {
  username: string;
  fullName: string;
  email: string | null;
  shortCode: string | null;
  password: string;
  roleIds: number[];
}

export interface UpdateUserRequest {
  fullName: string;
  email: string | null;
  shortCode: string | null;
  roleIds: number[];
}

export interface StationRosterEntry {
  userId: string;
  fullName: string;
  isPrimary: boolean;
  skillLevel: number;
}

export interface StationInfo {
  id: number;
  code: string;
  name: string;
  ownerUserId: string | null;
  ownerName: string | null;
  technicians: StationRosterEntry[];
}

export interface ActivityEvent {
  eventType: string;
  description: string;
  occurredAt: string;
}

export interface ActivityCounts {
  tasksCompleted: number;
  rosCreated: number;
  lastLoginAt: string | null;
}

export interface ActivityResponse {
  events: ActivityEvent[];
  counts: ActivityCounts;
}

export interface UserStationAssignment {
  stationId: number;
  stationName: string;
  isPrimary: boolean;
}

export const ALL_ROLES = [
  { id: 1, code: 'ADMIN',         label: 'Admin' },
  { id: 2, code: 'SALES',         label: 'Sales' },
  { id: 3, code: 'DRAFTER',       label: 'Drafter' },
  { id: 4, code: 'SUPERVISOR',    label: 'Supervisor' },
  { id: 5, code: 'STATION_OWNER', label: 'Station Owner' },
  { id: 6, code: 'TECHNICIAN',    label: 'Technician' },
  { id: 7, code: 'QC',            label: 'QC' },
  { id: 8, code: 'VIEWER',        label: 'Viewer' },
];

// ── Customer interfaces ──────────────────────────────────────────────────────

export interface CustomerSummary {
  id: string;
  code: string | null;
  name: string;
  customerNo: string | null;
  abn: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  isActive: boolean;
  activeRoCount: number;
  lastRoDate: string | null;
}

export interface CustomerListResponse {
  items: CustomerSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface CustomerDetail {
  id: string;
  code: string | null;
  name: string;
  customerNo: string | null;
  abn: string | null;
  billToName: string | null;
  billToAddress: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  emailDl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  activeRoCount: number;
  completedRoCount: number;
  cancelledRoCount: number;
}

export interface CustomerRoSummary {
  id: string;
  roNumber: string;
  templateCode: string;
  rego: string | null;
  chassisNumber: string | null;
  status: string;
  kanbanStage: string | null;
  requiredDate: string | null;
  roDate: string;
}

export interface CustomerRoListResponse {
  items: CustomerRoSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface VehicleEntry {
  rego: string | null;
  vin: string | null;
  chassisNumber: string | null;
  make: string | null;
  model: string | null;
  paintColour: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  roCount: number;
}

export interface CreateCustomerRequest {
  name: string;
  code?: string | null;
  customerNo?: string | null;
  abn?: string | null;
  billToName?: string | null;
  billToAddress?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  emailDl?: string | null;
}

export interface UpdateCustomerRequest {
  name?: string | null;
  code?: string | null;
  customerNo?: string | null;
  abn?: string | null;
  billToName?: string | null;
  billToAddress?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  emailDl?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);

  listUsers(q: string, role: string, active: string, station: string, page: number, pageSize = 20): Observable<UserListResponse> {
    let params = new HttpParams()
      .set('page', page)
      .set('pageSize', pageSize);
    if (q)       params = params.set('q', q);
    if (role)    params = params.set('role', role);
    if (active)  params = params.set('active', active);
    if (station) params = params.set('stationId', station);
    return this.http.get<UserListResponse>('/api/admin/users', { params });
  }

  getUser(id: string): Observable<AdminUserSummary> {
    return this.http.get<AdminUserSummary>(`/api/admin/users/${id}`);
  }

  createUser(req: CreateUserRequest): Observable<{ id: string }> {
    return this.http.post<{ id: string }>('/api/admin/users', req);
  }

  updateUser(id: string, req: UpdateUserRequest): Observable<void> {
    return this.http.put<void>(`/api/admin/users/${id}`, req);
  }

  resetPassword(id: string, newPassword: string): Observable<void> {
    return this.http.post<void>(`/api/admin/users/${id}/reset-password`, { newPassword });
  }

  deactivate(id: string): Observable<void> {
    return this.http.post<void>(`/api/admin/users/${id}/deactivate`, {});
  }

  activate(id: string): Observable<void> {
    return this.http.post<void>(`/api/admin/users/${id}/activate`, {});
  }

  getUserStations(id: string): Observable<UserStationAssignment[]> {
    return this.http.get<UserStationAssignment[]>(`/api/admin/users/${id}/stations`);
  }

  getActivity(id: string, days = 30): Observable<ActivityResponse> {
    return this.http.get<ActivityResponse>(`/api/admin/users/${id}/activity`, {
      params: new HttpParams().set('days', days),
    });
  }

  listStations(): Observable<StationInfo[]> {
    return this.http.get<StationInfo[]>('/api/stations');
  }

  addTechnician(stationId: number, userId: string, isPrimary: boolean): Observable<void> {
    return this.http.post<void>(`/api/admin/stations/${stationId}/technicians`, { userId, isPrimary });
  }

  removeTechnician(stationId: number, userId: string): Observable<void> {
    return this.http.delete<void>(`/api/admin/stations/${stationId}/technicians/${userId}`);
  }

  changeOwner(stationId: number, userId: string | null): Observable<void> {
    return this.http.put<void>(`/api/admin/stations/${stationId}/owner`, { userId });
  }

  // ── Customer admin methods ─────────────────────────────────────────────────

  listCustomers(q: string, active: string, page: number, pageSize = 50): Observable<CustomerListResponse> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (q)      params = params.set('q', q);
    if (active) params = params.set('active', active);
    return this.http.get<CustomerListResponse>('/api/admin/customers', { params });
  }

  getCustomer(id: string): Observable<CustomerDetail> {
    return this.http.get<CustomerDetail>(`/api/admin/customers/${id}`);
  }

  getCustomerRos(id: string, status: string, page: number, pageSize = 20): Observable<CustomerRoListResponse> {
    const params = new HttpParams()
      .set('status', status)
      .set('page', page)
      .set('pageSize', pageSize);
    return this.http.get<CustomerRoListResponse>(`/api/admin/customers/${id}/repair-orders`, { params });
  }

  getCustomerVehicles(id: string): Observable<VehicleEntry[]> {
    return this.http.get<VehicleEntry[]>(`/api/admin/customers/${id}/vehicles`);
  }

  createCustomer(req: CreateCustomerRequest): Observable<{ id: string }> {
    return this.http.post<{ id: string }>('/api/admin/customers', req);
  }

  updateCustomer(id: string, req: UpdateCustomerRequest): Observable<void> {
    return this.http.put<void>(`/api/admin/customers/${id}`, req);
  }

  deactivateCustomer(id: string): Observable<{ activeRoCount: number }> {
    return this.http.post<{ activeRoCount: number }>(`/api/admin/customers/${id}/deactivate`, {});
  }

  activateCustomer(id: string): Observable<void> {
    return this.http.post<void>(`/api/admin/customers/${id}/activate`, {});
  }
}
