# E31 — Theme Switcher: Light (default) ↔ SaaS Dashboard

**Status:** Plan · not yet implemented  
**Requested:** 2026-05-08  
**Design reference:** `design/saas-dashboard-theme.html`

---

## Goal

Let users switch between two visual themes at runtime, persisted to
`localStorage`. The current warm-paper style stays the default. The new
SaaS theme (`design/saas-dashboard-theme.html`) becomes the second option:
cool blue-gray background, white shadow-only cards, steel-blue accent, and
a left icon sidebar replacing the dark topbar.

---

## Two-phase approach

The SaaS theme has two distinct parts:

| Part | Complexity | Phase |
|---|---|---|
| **Token swap** — new colour values, shadow-only cards | Low | 1 |
| **Layout swap** — sidebar replaces topbar | Medium | 2 |

Phase 1 is self-contained and ships value immediately. Phase 2 builds on it.

---

## Phase 1 — Token swap

### 1.1 · Global CSS (`web/src/styles.css`)

Add a second token block after `:root`. All existing component CSS already
uses the variables, so a single block flips the entire colour system.

```css
/* ── SaaS theme ─────────────────────────────────────────────── */
[data-theme="saas"] {
  --paper:        #f0f4f8;
  --paper-2:      #e4ecf4;
  --paper-3:      #d2dfe9;
  --ink:          #0d1b2e;
  --ink-2:        #2d4059;
  --ink-3:        #6b88a4;
  --rule:         rgba(13,27,46,0.08);
  --rule-strong:  rgba(13,27,46,0.15);
  --accent:       #3b6fd4;
  --accent-dim:   rgba(59,111,212,0.10);
  --good:         #16a34a;
  --good-dim:     rgba(22,163,74,0.10);
  --warn:         #d97706;
  --warn-dim:     rgba(217,119,6,0.10);
  --bad:          #dc2626;
  --bad-dim:      rgba(220,38,38,0.10);
  --info:         #0369a1;
  --info-dim:     rgba(3,105,161,0.10);

  /* Topbar switches from dark → white */
  --topbar-bg:     #ffffff;
  --topbar-text:   #0d1b2e;
  --topbar-sub:    rgba(13,27,46,0.45);
  --topbar-muted:  rgba(13,27,46,0.55);
  --topbar-border: rgba(13,27,46,0.08);
}
```

Also add a global card-shadow rule so components that currently use
`border: 0.5px solid var(--rule)` can optionally get shadow-only treatment:

```css
[data-theme="saas"] .card,
[data-theme="saas"] .kanban-card,
[data-theme="saas"] section.card {
  box-shadow: 0 4px 16px rgba(13,27,46,0.07), 0 1px 4px rgba(13,27,46,0.05);
  border-color: transparent;
}
```

### 1.2 · Topbar components — use CSS variables

Each of the 10 topbar components currently hardcodes topbar colours.
Move them to variables so the theme token block above can override them.

Affected files (all have the same pattern):

| File |
|---|
| `dashboard/dashboard.component.ts` |
| `dashboard/archive.component.ts` |
| `sales/sales-ros.component.ts` |
| `sales/ro-detail.component.ts` |
| `sales/new-ro.component.ts` |
| `sales/pdf-review.component.ts` |
| `admin/admin-shell.component.ts` |
| `admin/chassis-stock-upload.component.ts` |
| `drafter/drafter-shell.component.ts` |
| `kanban/kanban-board.component.ts` |

Change in each component's inline CSS:

```css
/* BEFORE (hardcoded) */
.topbar { background: #0a0e0f; }
.brand-name { color: #f5f2ea; }
.nav-link { color: rgba(245,242,234,0.65); }
.nav-link.active { color: #f5f2ea; }

/* AFTER (variable-driven) */
.topbar { background: var(--topbar-bg); border-bottom: 0.5px solid var(--topbar-border); }
.brand-logo { filter: var(--logo-filter, brightness(0) invert(1)); }
.nav-link { color: var(--topbar-muted); }
.nav-link.active { color: var(--topbar-text); }
```

Add to `:root` in `styles.css`:
```css
--topbar-bg:     #0a0e0f;
--topbar-text:   #f5f2ea;
--topbar-sub:    rgba(245,242,234,0.45);
--topbar-muted:  rgba(245,242,234,0.65);
--topbar-border: rgba(245,242,234,0.10);
--logo-filter:   brightness(0) invert(1);
```

In `[data-theme="saas"]` override:
```css
--topbar-bg:     #ffffff;
--topbar-text:   #0d1b2e;
--topbar-muted:  rgba(13,27,46,0.55);
--topbar-border: rgba(13,27,46,0.08);
--logo-filter:   none;   /* logo is already dark — no invert needed */
```

### 1.3 · ThemeService (`web/src/app/core/theme.service.ts`)

```typescript
import { Injectable, signal } from '@angular/core';

export type AppTheme = 'light' | 'saas';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly KEY = 'nee-theme';

  current = signal<AppTheme>(
    (localStorage.getItem(this.KEY) as AppTheme) ?? 'light'
  );

  init(): void {
    document.documentElement.setAttribute('data-theme', this.current());
  }

  toggle(): void {
    const next: AppTheme = this.current() === 'light' ? 'saas' : 'light';
    this.current.set(next);
    localStorage.setItem(this.KEY, next);
    document.documentElement.setAttribute('data-theme', next);
  }

  set(theme: AppTheme): void {
    this.current.set(theme);
    localStorage.setItem(this.KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  }
}
```

### 1.4 · AppComponent — apply theme on boot

```typescript
// app.component.ts
export class AppComponent {
  constructor() {
    inject(ThemeService).init();
  }
}
```

### 1.5 · ThemeSwitcherComponent (`web/src/app/core/theme-switcher.component.ts`)

Small icon button that lives inside each existing topbar's right-side actions.

```typescript
@Component({
  selector: 'app-theme-switcher',
  standalone: true,
  template: `
    <button class="switcher" (click)="theme.toggle()" [title]="label()">
      @if (theme.current() === 'light') {
        <!-- Sun icon → switch to SaaS -->
        <svg>...</svg>
      } @else {
        <!-- Moon/palette icon → switch to Light -->
        <svg>...</svg>
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
    .switcher:hover { background: rgba(128,128,128,0.1); color: var(--topbar-text); }
  `],
})
export class ThemeSwitcherComponent {
  theme = inject(ThemeService);
  label = computed(() => this.theme.current() === 'light' ? 'Switch to SaaS theme' : 'Switch to Light theme');
}
```

Add `<app-theme-switcher />` to the right section of every topbar.

---

## Phase 2 — Layout swap (sidebar replaces topbar)

Phase 2 adds the icon sidebar when the SaaS theme is active. It does not
remove the existing topbar components — instead, `AppShellComponent`
wraps desktop routes and conditionally shows sidebar + white topbar OR
passes through to the existing topbar (light theme).

### 2.1 · AppShellComponent (`web/src/app/core/shell/app-shell.component.ts`)

```
<div class="shell" [class.shell-saas]="theme.current() === 'saas'">
  @if (theme.current() === 'saas') {
    <app-sidebar />
    <div class="shell-main">
      <app-shell-topbar />
      <div class="shell-content">
        <router-outlet />
      </div>
    </div>
  } @else {
    <!-- Light theme: feature components render their own topbar -->
    <router-outlet />
  }
</div>
```

CSS:
```css
.shell         { display: flex; min-height: 100vh; }
.shell-main    { flex: 1; display: flex; flex-direction: column; margin-left: 64px; }
.shell-content { flex: 1; }
```

### 2.2 · SidebarComponent (`web/src/app/core/shell/sidebar.component.ts`)

Narrow 64px icon-nav matching `design/saas-dashboard-theme.html` section 1.

Nav items driven by the same route structure as the existing topbar:

| Icon | Route | Roles |
|---|---|---|
| Grid / Dashboard | `/dashboard` | SUPERVISOR, ADMIN |
| Kanban columns | `/kanban` | all |
| List / Sales | `/sales/ros` | SALES, SUPERVISOR, ADMIN |
| Clock / Scheduling | `/scheduling` | SUPERVISOR, ADMIN |
| Pencil / Drafter | `/drafter` | DRAFTER, ADMIN |
| Person / Tech | `/tech/tasks` | TECHNICIAN and others |
| Star / QC | `/tech/qc` | QC, SUPERVISOR |
| Gear / Admin | `/admin` | ADMIN |

Pinned bottom: settings · logout.

Tooltip on hover (position: fixed, left: 64px).

### 2.3 · ShellTopbarComponent (`web/src/app/core/shell/shell-topbar.component.ts`)

White topbar with:
- Page title (derived from current route's `data.title`)
- Search bar (pill input, placeholder "Search ROs, customers… ⌘K")
- Notification bell (reuse `NotificationBellComponent`)
- `<app-theme-switcher />`
- User avatar → logout

### 2.4 · Feature components — hide own topbar in SaaS mode

When `data-theme="saas"` the shell provides the topbar. Feature components
must not render their own. Two options:

**Option A — CSS global rule (zero component changes):**
```css
[data-theme="saas"] .topbar { display: none; }
```
Simple. The topbar DOM exists but is hidden. Fine for Phase 2 MVP.

**Option B — Conditional in each component:**
```typescript
theme = inject(ThemeService);
// template:
@if (theme.current() !== 'saas') {
  <header class="topbar">…</header>
}
```
Cleaner long-term — removes unnecessary DOM. Can be done as a follow-up.

Recommendation: ship Phase 2 with **Option A**, plan Option B cleanup later.

### 2.5 · Route change (`app.routes.ts`)

Wrap desktop routes in AppShell:

```typescript
{
  path: '',
  component: AppShellComponent,
  canActivate: [authGuard],
  children: [
    { path: 'dashboard', loadComponent: … },
    { path: 'kanban',    loadComponent: … },
    { path: 'sales/ros', loadComponent: … },
    // … all desktop routes
  ]
},
// Tech routes stay outside shell (mobile layout, own nav)
{ path: 'tech/tasks',   loadComponent: … },
{ path: 'tech/tasks/:id', loadComponent: … },
{ path: 'login', loadComponent: … },
```

---

## Files changed — full list

### New files

| File | Purpose |
|---|---|
| `web/src/app/core/theme.service.ts` | Theme state + localStorage persistence |
| `web/src/app/core/theme-switcher.component.ts` | Toggle button |
| `web/src/app/core/shell/app-shell.component.ts` | Conditional shell wrapper *(Phase 2)* |
| `web/src/app/core/shell/sidebar.component.ts` | Icon sidebar *(Phase 2)* |
| `web/src/app/core/shell/shell-topbar.component.ts` | White topbar for SaaS layout *(Phase 2)* |

### Modified files

| File | Change |
|---|---|
| `web/src/styles.css` | Add `[data-theme="saas"]` token block + topbar variables in `:root` |
| `web/src/app/app.component.ts` | Call `ThemeService.init()` on boot |
| `web/src/app/app.routes.ts` | Wrap desktop routes in AppShell *(Phase 2)* |
| All 10 topbar components | Replace hardcoded topbar colours with CSS variables; add `<app-theme-switcher />` |

---

## Token diff — Light → SaaS

| Token | Light | SaaS |
|---|---|---|
| `--paper` | `#f5f2ea` warm parchment | `#f0f4f8` cool blue-gray |
| `--paper-2` | `#ebe7dc` | `#e4ecf4` |
| `--ink-3` | `#2a3033` | `#6b88a4` steel-gray |
| `--accent` | `#c2410c` burnt orange | `#3b6fd4` steel blue |
| `--topbar-bg` | `#0a0e0f` near-black | `#ffffff` white |
| `--logo-filter` | `brightness(0) invert(1)` | `none` |
| Card border | `0.5px solid var(--rule)` | `transparent` (shadow only) |

Semantic colours (`--good`, `--bad`, `--warn`, `--info`) are unchanged.
Typography stack unchanged.

---

## Implementation order

```
Phase 1
  1. Add CSS variables to styles.css (topbar vars in :root, saas token block)
  2. Update topbar CSS in all 10 feature components to use variables
  3. Create ThemeService
  4. Wire ThemeService.init() into AppComponent constructor
  5. Create ThemeSwitcherComponent
  6. Add <app-theme-switcher /> to each topbar
  7. Test: toggle light ↔ saas — colours and topbar change, layout unchanged

Phase 2
  8. Create SidebarComponent
  9. Create ShellTopbarComponent (white topbar, search, user)
  10. Create AppShellComponent (conditional sidebar vs pass-through)
  11. Add [data-theme="saas"] .topbar { display:none } to styles.css
  12. Restructure app.routes.ts (desktop routes under AppShell)
  13. Test: saas theme shows sidebar + white topbar, light theme unchanged
  14. (Optional cleanup) Replace CSS display:none with @if in each component
```

---

## Out of scope

- Per-user theme stored server-side (localStorage is sufficient)
- Auto dark-mode based on `prefers-color-scheme`
- Mobile sidebar drawer (tech views stay as-is)
- Animated theme transition
