import { Component, inject, computed } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AuthService } from '../auth.service';

interface NavItem {
  label: string;
  route: string;
  roles: string[] | null;
  icon: string;
}

const ICONS: Record<string, string> = {
  dashboard: `<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>`,
  kanban:    `<rect x="3" y="3" width="4" height="18" rx="1"/><rect x="10" y="3" width="4" height="12" rx="1"/><rect x="17" y="3" width="4" height="15" rx="1"/>`,
  sales:     `<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/><polyline points="9 12 11 14 15 10"/>`,
  drafter:   `<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
  admin:     `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>`,
  logout:    `<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`,
};

@Component({
  selector: 'app-sidebar',
  standalone: true,
  template: `
    <nav class="sidebar">
      <div class="sidebar-logo">
        <svg viewBox="0 0 24 24" fill="white"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      </div>

      <div class="sidebar-nav">
        @for (item of visibleItems(); track item.route) {
          <button
            class="nav-item"
            [class.active]="isActive(item.route)"
            (click)="navigate(item.route)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" stroke-linejoin="round"
                 [innerHTML]="safe(item.icon)">
            </svg>
            <span class="nav-tooltip">{{ item.label }}</span>
          </button>
        }
      </div>

      <div class="sidebar-bottom">
        <button class="nav-item" (click)="logout()" title="Sign out">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round"
               [innerHTML]="safe(icons['logout'])">
          </svg>
          <span class="nav-tooltip">Sign out</span>
        </button>
      </div>
    </nav>
  `,
  styles: [`
    .sidebar {
      width: 64px;
      background: var(--sidebar-bg, #ffffff);
      border-right: 0.5px solid var(--rule);
      display: flex; flex-direction: column; align-items: center;
      padding: 16px 0 20px;
      position: fixed; top: 0; left: 0; bottom: 0;
      z-index: 100;
      box-shadow: 1px 0 0 var(--rule);
    }
    .sidebar-logo {
      width: 36px; height: 36px; border-radius: 8px;
      background: var(--accent);
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 20px; flex-shrink: 0;
      box-shadow: 0 2px 8px rgba(59,111,212,0.3);
    }
    .sidebar-logo svg { width: 20px; height: 20px; stroke: white; stroke-width: 2; fill: none; }
    .sidebar-nav { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
    .nav-item {
      position: relative;
      width: 40px; height: 40px; border-radius: 8px;
      background: none; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: var(--ink-3);
      transition: background 0.15s, color 0.15s;
    }
    .nav-item:hover { background: var(--paper-2, #e4ecf4); color: var(--ink-2); }
    .nav-item.active { background: var(--accent); color: #fff; box-shadow: 0 2px 8px rgba(59,111,212,0.25); }
    .nav-tooltip {
      position: absolute; left: calc(100% + 10px); top: 50%; transform: translateX(-4px) translateY(-50%);
      background: var(--ink); color: var(--paper);
      font-size: 11px; font-family: var(--sans);
      padding: 4px 8px; border-radius: 4px;
      white-space: nowrap; pointer-events: none; opacity: 0;
      transition: opacity 0.15s, transform 0.15s;
      z-index: 200;
    }
    .nav-item:hover .nav-tooltip { opacity: 1; transform: translateX(0) translateY(-50%); }
    .sidebar-bottom { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  `],
})
export class SidebarComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);

  icons = ICONS;

  private currentUrl = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url }
  );

  private navItems: NavItem[] = [
    { label: 'Dashboard', route: '/dashboard', roles: ['SUPERVISOR', 'ADMIN'],       icon: ICONS['dashboard'] },
    { label: 'Kanban',    route: '/kanban',     roles: null,                          icon: ICONS['kanban'] },
    { label: 'Sales',     route: '/sales/ros',  roles: ['SALES', 'SUPERVISOR', 'ADMIN'], icon: ICONS['sales'] },
    { label: 'Drafter',   route: '/drafter',    roles: ['DRAFTER', 'ADMIN'],          icon: ICONS['drafter'] },
    { label: 'Admin',     route: '/admin',      roles: ['ADMIN'],                     icon: ICONS['admin'] },
  ];

  visibleItems = computed(() =>
    this.navItems.filter(item =>
      item.roles === null || item.roles.some(r => this.auth.hasRole(r))
    )
  );

  isActive(route: string): boolean {
    return (this.currentUrl() ?? '').startsWith(route);
  }

  navigate(route: string): void {
    this.router.navigate([route]);
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  safe(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
