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
    this.set(next);
  }

  set(theme: AppTheme): void {
    this.current.set(theme);
    localStorage.setItem(this.KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  }
}
