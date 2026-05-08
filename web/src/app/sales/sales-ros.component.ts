import {
  Component, OnInit, inject, signal, DestroyRef, ViewChild, ElementRef,
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { startWith, switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../core/auth.service';
import { ActiveRo } from '../dashboard/dashboard.service';
import { ActiveRosTableComponent } from '../dashboard/active-ros-table.component';
import { NotificationBellComponent } from '../core/notification-bell.component';

@Component({
  selector: 'app-sales-ros',
  standalone: true,
  imports: [CommonModule, DatePipe, ActiveRosTableComponent, NotificationBellComponent],
  template: `
    <div class="topbar">
      <div class="brand">
        <img class="brand-logo" src="assets/nee-logo.png" alt="North East Engineering" />
        <span class="brand-sub">Production Platform</span>
      </div>
      <div class="topbar-right">
        @if (user(); as u) {
          <span class="user-label">{{ u.fullName }} · <span class="role">{{ u.roles.join(', ') }}</span></span>
        }
        <app-notification-bell />
        <button class="logout" (click)="logout()">Sign out</button>
      </div>
    </div>

    <main class="stage">
      <div class="page-header">
        <h1 class="page-title">Repair Orders</h1>
        <div class="header-actions">
          <input #pdfInput type="file" accept="application/pdf" style="display:none"
                 (change)="onPdfSelected($any($event.target).files[0])" />
          <button class="btn-secondary" [disabled]="uploading()"
                  (click)="pdfInput.click()">
            {{ uploading() ? 'Uploading…' : '↑ Upload PDF' }}
          </button>
          <button class="btn-primary" (click)="router.navigate(['/sales/new-ro'])">+ New RO</button>
        </div>
      </div>

      @if (uploadError()) {
        <div class="alert-error">{{ uploadError() }}</div>
      }

      @if (loadError()) {
        <div class="alert-error">Could not load repair orders. Retrying…</div>
      }

      <section class="panel">
        <app-active-ros-table [rows]="ros()" />
      </section>
    </main>
  `,
  styles: [`
    .topbar { display: flex; justify-content: space-between; align-items: center;
              padding: 14px 28px; background: var(--ink); color: var(--paper);
              border-bottom: 0.5px solid rgba(245,242,234,0.1); position: relative; z-index: 10; }
    .brand  { display: flex; flex-direction: row; align-items: center; gap: 12px; }
    .brand-logo { height: 48px; width: auto; filter: brightness(0) invert(1); }
    .brand-sub  { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: rgba(245,242,234,0.5); }
    .topbar-right { display: flex; align-items: center; gap: 16px; }
    .user-label { font-size: 13px; color: rgba(245,242,234,0.8); }
    .role  { opacity: 0.65; }
    .logout { background: transparent; border: 0.5px solid rgba(245,242,234,0.3); color: var(--paper);
              padding: 5px 12px; border-radius: 5px; cursor: pointer; font-size: 12px; }
    .logout:hover { background: rgba(245,242,234,0.1); }

    .stage { background: var(--paper); min-height: calc(100vh - 57px); padding-bottom: 40px; position: relative; z-index: 1; }
    .page-header { display: flex; align-items: center; justify-content: space-between;
                   padding: 24px 28px 0; margin-bottom: 16px; }
    .page-title { font-family: var(--display); font-size: 28px; font-weight: 500; color: var(--ink);
                  letter-spacing: -0.02em; margin: 0; }
    .header-actions { display: flex; gap: 10px; align-items: center; }
    .btn-primary { background: var(--accent); color: white; border: none; padding: 10px 20px;
                   border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer;
                   transition: background 0.15s, transform 0.15s; }
    .btn-primary:hover { background: #9a3412; transform: translateY(-1px); }
    .btn-secondary { background: transparent; color: var(--ink); border: 0.5px solid var(--rule-strong);
                     padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 500;
                     cursor: pointer; transition: background 0.15s; }
    .btn-secondary:hover:not(:disabled) { background: var(--paper-2); }
    .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

    .alert-error { background: #fef2f2; color: var(--bad); border-left: 4px solid var(--bad);
                   border-radius: 6px; padding: 10px 16px; margin: 0 28px 16px; font-size: 13px; }
    .panel { background: white; border: 0.5px solid var(--rule); border-radius: 12px;
             padding: 24px; margin: 0 28px; }
  `],
})
export class SalesRosComponent implements OnInit {
  private auth = inject(AuthService);
  private http = inject(HttpClient);
  private destroyRef = inject(DestroyRef);
  router = inject(Router);

  user = this.auth.user;
  ros = signal<ActiveRo[]>([]);
  loadError = signal(false);
  uploading = signal(false);
  uploadError = signal<string | null>(null);

  ngOnInit() {
    interval(60_000).pipe(
      startWith(0),
      switchMap(() =>
        this.http.get<ActiveRo[]>('/api/repair-orders').pipe(
          catchError(() => { this.loadError.set(true); return of([]); }),
        )
      ),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(rows => {
      this.loadError.set(false);
      this.ros.set(rows);
    });
  }

  onPdfSelected(file: File | null | undefined) {
    if (!file) return;
    this.uploading.set(true);
    this.uploadError.set(null);

    const form = new FormData();
    form.append('file', file);

    this.http.post<{ uploadId: string; fileName: string; sizeBytes: number }>('/api/sales/pdf-upload', form)
      .subscribe({
        next: res => {
          this.uploading.set(false);
          this.router.navigate(['/sales/pdf-review', res.uploadId]);
        },
        error: err => {
          this.uploading.set(false);
          const msg = err?.error?.message ?? 'Upload failed. Please try again.';
          this.uploadError.set(msg);
        },
      });
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
