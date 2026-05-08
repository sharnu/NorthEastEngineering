import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ThemeSwitcherComponent } from '../core/theme-switcher.component';

@Component({
  selector: 'app-drafter-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, ThemeSwitcherComponent],
  template: `
    <div class="topbar">
      <div class="brand">
        <img class="brand-logo" src="assets/nee-logo.png" alt="North East Engineering" />
        <span class="brand-sub">Drafter Workspace</span>
      </div>
      <div class="topbar-right">
        @if (user(); as u) {
          <span class="user-label">{{ u.fullName }}</span>
        }
        <a class="nav-link" (click)="router.navigate(['/dashboard'])">Dashboard</a>
        <app-theme-switcher />
        <button class="logout" (click)="logout()">Sign out</button>
      </div>
    </div>

    <main class="stage">
      <div class="stage-inner">
        <router-outlet />
      </div>
    </main>
  `,
  styles: [`
    .topbar { display: flex; justify-content: space-between; align-items: center;
              padding: 14px 28px; background: var(--topbar-bg); color: var(--topbar-text); }
    .brand  { display: flex; flex-direction: row; align-items: center; gap: 12px; }
    .brand-logo { height: 48px; width: auto; filter: var(--logo-filter); }
    .brand-sub  { font-family: var(--mono); font-size: 11px; text-transform: uppercase;
                  letter-spacing: 0.12em; color: var(--topbar-sub); }
    .topbar-right { display: flex; align-items: center; gap: 16px; }
    .user-label { font-size: 13px; color: var(--topbar-muted); }
    .nav-link { font-size: 13px; color: var(--topbar-muted); cursor: pointer;
                padding: 5px 0; border-bottom: 1px solid transparent; }
    .nav-link:hover { color: var(--topbar-text); border-bottom-color: var(--topbar-border); }
    .logout { background: transparent; border: 0.5px solid var(--topbar-border); color: var(--topbar-text);
              padding: 5px 12px; border-radius: 5px; cursor: pointer; font-size: 12px; }
    .stage { background: var(--paper); min-height: calc(100vh - 57px); }
    .stage-inner { padding: 24px 28px; }
  `],
})
export class DrafterShellComponent {
  router = inject(Router);
  private auth = inject(AuthService);
  user = this.auth.user;

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
