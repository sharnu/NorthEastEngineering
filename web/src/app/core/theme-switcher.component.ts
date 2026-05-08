import { Component, inject, computed } from '@angular/core';
import { ThemeService } from './theme.service';

@Component({
  selector: 'app-theme-switcher',
  standalone: true,
  template: `
    <button class="switcher" (click)="theme.toggle()" [title]="label()">
      @if (theme.current() === 'light') {
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6">
          <circle cx="10" cy="10" r="3.5"/>
          <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.1 4.1l1.4 1.4M14.5 14.5l1.4 1.4M4.1 15.9l1.4-1.4M14.5 5.5l1.4-1.4"/>
        </svg>
      } @else {
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6">
          <path d="M17 12.3A7 7 0 0 1 7.7 3a7 7 0 1 0 9.3 9.3z"/>
        </svg>
      }
    </button>
  `,
  styles: [`
    .switcher {
      width: 32px; height: 32px; border-radius: 6px;
      background: none; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: var(--topbar-muted);
      transition: background 0.15s, color 0.15s;
    }
    .switcher:hover {
      background: var(--topbar-hover);
      color: var(--topbar-text);
    }
  `],
})
export class ThemeSwitcherComponent {
  theme = inject(ThemeService);
  label = computed(() =>
    this.theme.current() === 'light' ? 'Switch to SaaS theme' : 'Switch to Light theme'
  );
}
