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
    /* min-width:0 overrides the flex default (min-width:auto) so this child
       cannot grow wider than the remaining viewport space. overflow-x:hidden
       clips page-level overflow while each component's own overflow-x:auto
       scroll areas (e.g. kanban columns) still scroll independently. */
    .shell-main { flex: 1; margin-left: 64px; min-width: 0; overflow-x: hidden; }
  `],
})
export class AppShellComponent {
  theme = inject(ThemeService);
}
