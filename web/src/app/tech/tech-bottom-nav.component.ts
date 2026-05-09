import { Component, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-tech-bottom-nav',
  standalone: true,
  imports: [RouterModule],
  template: `
    <nav class="bottom-nav">
      <a routerLink="/tech/tasks" routerLinkActive="active" class="nav-tab">
        <span class="nav-icon">&#9776;</span>
        <span class="nav-label">Tasks</span>
      </a>
      <button class="nav-tab nav-tab-button" (click)="logout()">
        <span class="nav-icon">&#x21AA;</span>
        <span class="nav-label">Sign out</span>
      </button>
    </nav>
  `,
  styles: [`
    .bottom-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 60px;
      background: var(--ink);
      border-top: none;
      display: flex;
      align-items: stretch;
      z-index: 100;
    }
    .nav-tab {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      color: rgba(245,242,234,0.7);
      font-size: 11px;
      gap: 2px;
      transition: color 0.15s;
      position: relative;
    }
    .nav-tab.active {
      color: var(--paper);
    }
    .nav-tab.active::after {
      content: '';
      position: absolute;
      bottom: 6px;
      left: 50%;
      transform: translateX(-50%);
      width: 20px;
      height: 2px;
      background: var(--accent);
      border-radius: 1px;
    }
    .nav-icon {
      font-size: 20px;
      line-height: 1;
    }
    .nav-label {
      font-family: var(--mono);
      font-size: 10px;
      line-height: 1;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .nav-tab-button {
      background: none;
      border: none;
      cursor: pointer;
      font: inherit;
      padding: 0;
    }
  `],
})
export class TechBottomNavComponent {
  private auth   = inject(AuthService);
  private router = inject(Router);

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
