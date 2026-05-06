import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-drafter-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  template: `
    <div class="topbar">
      <div class="brand">
        <span class="brand-name">North East Engineering</span>
        <span class="brand-sub">Drafter Workspace</span>
      </div>
      <div class="topbar-right">
        @if (user(); as u) {
          <span class="user-label">{{ u.fullName }}</span>
        }
        <a class="nav-link" (click)="router.navigate(['/dashboard'])">Dashboard</a>
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
              padding: 14px 28px; background: var(--ink); color: var(--paper); }
    .brand  { display: flex; flex-direction: column; gap: 2px; }
    .brand-name { font-family: var(--display); font-weight: 500; font-size: 16px; color: var(--paper); }
    .brand-sub  { font-family: var(--mono); font-size: 11px; text-transform: uppercase;
                  letter-spacing: 0.12em; color: rgba(245,242,234,0.5); }
    .topbar-right { display: flex; align-items: center; gap: 16px; }
    .user-label { font-size: 13px; color: rgba(245,242,234,0.8); }
    .nav-link { font-size: 13px; color: rgba(245,242,234,0.8); cursor: pointer;
                padding: 5px 0; border-bottom: 1px solid transparent; }
    .nav-link:hover { color: var(--paper); border-bottom-color: rgba(245,242,234,0.4); }
    .logout { background: transparent; border: 0.5px solid rgba(245,242,234,0.3); color: var(--paper);
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
