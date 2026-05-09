import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from '../theme.service';
import { SidebarComponent } from './sidebar.component';
import { ShellTopbarComponent } from './shell-topbar.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, ShellTopbarComponent],
  template: `
    @if (theme.current() === 'saas') {
      <div class="shell">
        <app-sidebar />
        <div class="shell-main">
          <app-shell-topbar />
          <div class="shell-content">
            <router-outlet />
          </div>
        </div>
      </div>
    } @else {
      <router-outlet />
    }
  `,
  styles: [`
    .shell { display: flex; min-height: 100vh; }
    .shell-main { flex: 1; display: flex; flex-direction: column; margin-left: 64px; }
    .shell-content { flex: 1; }
  `],
})
export class AppShellComponent {
  theme = inject(ThemeService);
}
