import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

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
      <a routerLink="/tech/history" routerLinkActive="active" class="nav-tab">
        <span class="nav-icon">&#128337;</span>
        <span class="nav-label">History</span>
      </a>
      <a routerLink="/tech/profile" routerLinkActive="active" class="nav-tab">
        <span class="nav-icon">&#128100;</span>
        <span class="nav-label">Profile</span>
      </a>
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
  `],
})
export class TechBottomNavComponent {}
