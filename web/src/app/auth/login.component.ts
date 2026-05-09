import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  styleUrls: ['./login.component.css'],
  template: `
    <div class="login-stage">
      <div class="login-hero" aria-hidden="true">
        <img src="assets/nee-login-bg.jpg" alt="" />
      </div>

      <div class="login-panel">
        <div class="login-card">
          <div class="brand">
            <img class="brand-logo" src="assets/nee-logo.png" alt="North East Engineering" />
            <span class="brand-sub">Production Platform</span>
          </div>

          <form [formGroup]="form" (ngSubmit)="submit()">
            <div class="field">
              <label for="username">Username</label>
              <input id="username" type="text" formControlName="username" autocomplete="username" autofocus />
            </div>
            <div class="field">
              <label for="password">Password</label>
              <input id="password" type="password" formControlName="password" autocomplete="current-password" />
            </div>

            @if (error()) {
              <div class="error">{{ error() }}</div>
            }

            <button type="submit" class="primary" [disabled]="form.invalid || busy()">
              {{ busy() ? 'Signing in…' : 'Sign in' }}
            </button>
          </form>

          <p class="hint">Dev users: <code>sales</code>, <code>drafter</code>, <code>supervisor</code>, <code>adam</code>, <code>peter</code>, <code>kane</code>. Password: <code>nee2026</code>.</p>
        </div>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  busy = signal(false);
  error = signal<string | null>(null);

  form = this.fb.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  async submit() {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const { username, password } = this.form.getRawValue();
      const user = await this.auth.login(username, password);
      const dest = user.roles.some(r => r === 'SUPERVISOR' || r === 'ADMIN')
        ? '/dashboard'
        : user.roles.some(r => r === 'DRAFTER')
          ? '/drafter'
          : user.roles.some(r => r === 'STATION_OWNER')
            ? '/kanban'
            : user.roles.some(r => r === 'TECHNICIAN')
              ? '/tech/tasks'
              : '/sales/ros';
      this.router.navigate([dest]);
    } catch (e: unknown) {
      const msg = (e as { error?: { message?: string } })?.error?.message ?? 'Sign-in failed.';
      this.error.set(msg);
    } finally {
      this.busy.set(false);
    }
  }
}
