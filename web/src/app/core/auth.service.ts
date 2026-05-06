import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Observable } from 'rxjs';

export interface UserInfo {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  roles: string[];
}

interface LoginResponse {
  token: string;
  user: UserInfo;
}

const TOKEN_KEY = 'nee.token';
const USER_KEY = 'nee.user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);

  // Signals expose reactive state to components
  private _user = signal<UserInfo | null>(this.readUser());
  user = this._user.asReadonly();
  isAuthenticated = computed(() => this._user() !== null);

  async login(username: string, password: string): Promise<UserInfo> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>('/api/auth/login', { username, password }),
    );
    sessionStorage.setItem(TOKEN_KEY, res.token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(res.user));
    this._user.set(res.user);
    return res.user;
  }

  logout(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    this._user.set(null);
  }

  getToken(): string | null {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  /** Hits /api/auth/me to verify the token is still valid server-side. */
  fetchMe(): Observable<UserInfo> {
    return this.http.get<UserInfo>('/api/auth/me');
  }

  hasRole(role: string): boolean {
    return this._user()?.roles?.includes(role) ?? false;
  }

  private readUser(): UserInfo | null {
    const raw = sessionStorage.getItem(USER_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw) as UserInfo; } catch { return null; }
  }
}
