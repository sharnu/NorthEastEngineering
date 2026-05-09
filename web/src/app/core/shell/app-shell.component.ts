import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from '../theme.service';
import { SidebarComponent } from './sidebar.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent],
  template: `
    @if (theme.current() === 'saas') {
      <div class="shell">
        <app-sidebar />
        <div class="shell-main">
          <router-outlet />
        </div>
      </div>
    } @else {
      <router-outlet />
    }
  `,
  styles: [`
    .shell { display: flex; min-height: 100vh; }
    .shell-main { flex: 1; margin-left: 64px; }
  `],
})
export class AppShellComponent {
  theme = inject(ThemeService);
}
