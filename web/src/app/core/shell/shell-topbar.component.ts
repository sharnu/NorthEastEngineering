import { Component, inject, computed } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { AuthService } from '../auth.service';
import { ThemeSwitcherComponent } from '../theme-switcher.component';
import { NotificationBellComponent } from '../notification-bell.component';

const TITLE_MAP: [string, string][] = [
  ['/dashboard/archive', 'Archive'],
  ['/dashboard',         'Dashboard'],
  ['/kanban',            'Kanban Board'],
  ['/sales/new-ro',      'New Repair Order'],
  ['/sales/ros',         'Repair Orders'],
  ['/sales/ro/',         'Repair Order'],
  ['/sales/pdf-review',  'PDF Review'],
  ['/admin/chassis-stock', 'Chassis Stock Upload'],
  ['/admin',             'Admin'],
  ['/drafter',           'Drafting'],
];

@Component({
  selector: 'app-shell-topbar',
  standalone: true,
  imports: [ThemeSwitcherComponent, NotificationBellComponent],
  template: `
    <header class="shell-topbar">
      <span class="page-title">{{ pageTitle() }}</span>

      <div class="search-bar">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 20 20" fill="none"
             stroke="currentColor" stroke-width="1.8">
          <circle cx="8.5" cy="8.5" r="5.5"/><path d="M15 15l3.5 3.5"/>
        </svg>
        <input type="text" placeholder="Search ROs, customers…" readonly
               (click)="focusSearch($event)" />
        <span class="search-hint">⌘K</span>
      </div>

      <div class="topbar-spacer"></div>

      <div class="topbar-actions">
        <app-notification-bell />
        <app-theme-switcher />
        <button class="user-avatar" [title]="userName()" (click)="logout()">
          {{ userInitial() }}
        </button>
      </div>
    </header>
  `,
  styles: [`
    .shell-topbar {
      height: 52px;
      background: var(--topbar-bg);
      border-bottom: 0.5px solid var(--topbar-border);
      display: flex; align-items: center;
      padding: 0 24px; gap: 16px;
      position: sticky; top: 0; z-index: 50;
    }
    .page-title {
      font-family: var(--display);
      font-size: 17px; font-weight: 400;
      color: var(--topbar-text); letter-spacing: -0.01em;
      flex-shrink: 0;
    }
    .search-bar {
      flex: 1; max-width: 360px; margin: 0 8px; position: relative;
    }
    .search-bar input {
      width: 100%; padding: 7px 36px 7px 32px;
      background: var(--paper-2); border: 0.5px solid var(--rule);
      border-radius: 20px; font-size: 13px; font-family: var(--sans);
      color: var(--topbar-text); outline: none; cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .search-bar input:focus { border-color: var(--accent); background: #fff; }
    .search-icon {
      position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
      color: var(--topbar-muted); pointer-events: none;
    }
    .search-hint {
      position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
      font-family: var(--mono); font-size: 10px; color: var(--topbar-muted);
      background: var(--rule); padding: 1px 5px; border-radius: 3px;
    }
    .topbar-spacer { flex: 1; }
    .topbar-actions { display: flex; align-items: center; gap: 6px; }
    .user-avatar {
      width: 32px; height: 32px; border-radius: 50%;
      background: var(--accent); color: #fff;
      font-size: 12px; font-weight: 600; font-family: var(--sans);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; margin-left: 4px; border: none;
      box-shadow: 0 1px 4px rgba(59,111,212,0.3);
    }
  `],
})
export class ShellTopbarComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  private currentUrl = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url }
  );

  pageTitle = computed(() => {
    const url = this.currentUrl() ?? '';
    const match = TITLE_MAP.find(([prefix]) => url.startsWith(prefix));
    return match ? match[1] : 'NEE Platform';
  });

  userName = computed(() => this.auth.user()?.fullName ?? this.auth.user()?.username ?? '');
  userInitial = computed(() => (this.userName()[0] ?? '?').toUpperCase());

  focusSearch(e: Event): void {
    (e.target as HTMLInputElement).blur();
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
