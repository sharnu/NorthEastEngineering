import {
  Component, OnInit, inject, signal, DestroyRef,
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors, FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, switchMap, debounceTime, startWith, catchError, of } from 'rxjs';
import { AuthService } from '../core/auth.service';

interface Customer { id: string; code: string; name: string; }
interface JobType { id: number; code: string; name: string; }
interface TemplateSummary { code: string; displayName: string; bodyType: string; customerVariant: string | null; totalHours: number | null; }
interface TemplateOperation { sequence: number; operationCode: string; operationName: string; estimatedHours: number; }
interface TemplateDetail extends TemplateSummary { operations: TemplateOperation[]; }

function futureDate(ctrl: AbstractControl): ValidationErrors | null {
  if (!ctrl.value) return null;
  return new Date(ctrl.value) > new Date() ? null : { pastDate: true };
}

@Component({
  selector: 'app-new-ro',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  template: `
    <div class="topbar">
      <div class="brand">
        <img class="brand-logo" src="assets/nee-logo.png" alt="North East Engineering" />
        <span class="brand-sub">Production Platform</span>
      </div>
      <div class="topbar-right">
        <a class="back-link" (click)="router.navigate(['/sales/ros'])">← Repair Orders</a>
        @if (user(); as u) {
          <span class="user-label">{{ u.fullName }}</span>
        }
        <button class="logout" (click)="logout()">Sign out</button>
      </div>
    </div>

    <main class="stage">
      <div class="page-header">
        <h1 class="page-title">New Repair Order</h1>
      </div>

      @if (apiError()) {
        <div class="alert-error">{{ apiError() }}</div>
      }

      <form [formGroup]="form" (ngSubmit)="submit()">
        <div class="two-col">

          <!-- LEFT: Customer + Vehicle -->
          <section class="panel">
            <h2 class="panel-title">Customer &amp; Vehicle</h2>

            <div class="field">
              <label>Customer <span class="req">*</span></label>
              <select formControlName="customerId">
                <option value="">Select customer…</option>
                @for (c of customers(); track c.id) {
                  <option [value]="c.id">{{ c.name }}</option>
                }
              </select>
              @if (touched('customerId') && form.get('customerId')?.errors?.['required']) {
                <span class="field-error">Required</span>
              }
            </div>

            <div class="field">
              <label>Job Type <span class="req">*</span></label>
              <select formControlName="jobTypeId">
                <option value="">Select job type…</option>
                @for (j of jobTypes(); track j.id) {
                  <option [value]="j.id">{{ j.name }}</option>
                }
              </select>
              @if (touched('jobTypeId') && form.get('jobTypeId')?.errors?.['required']) {
                <span class="field-error">Required</span>
              }
            </div>

            <div class="form-row">
              <div class="field">
                <label>Rego <span class="req">*</span></label>
                <input formControlName="rego" placeholder="e.g. ABC123" />
                @if (touched('rego') && form.get('rego')?.errors?.['required']) {
                  <span class="field-error">Required</span>
                }
              </div>
              <div class="field">
                <label>VIN</label>
                <input formControlName="vin" placeholder="17-char VIN" maxlength="17" />
                @if (touched('vin') && form.get('vin')?.errors?.['minlength']) {
                  <span class="field-error">Must be 17 characters</span>
                }
              </div>
            </div>

            <div class="form-row">
              <div class="field">
                <label>Make</label>
                <input formControlName="make" placeholder="e.g. Isuzu" />
              </div>
              <div class="field">
                <label>Model</label>
                <input formControlName="model" placeholder="e.g. NPR75" />
              </div>
            </div>

            <div class="form-row">
              <div class="field">
                <label>Paint Colour</label>
                <input formControlName="paintColour" placeholder="e.g. White" />
              </div>
              <div class="field">
                <label>Priority <span class="req">*</span></label>
                <select formControlName="priority">
                  <option value="1">1 — Urgent</option>
                  <option value="2">2 — High</option>
                  <option value="3">3 — Normal</option>
                  <option value="4">4 — Low</option>
                </select>
              </div>
            </div>

            <div class="field">
              <label>Required Date <span class="req">*</span></label>
              <input type="date" formControlName="requiredDate" />
              @if (touched('requiredDate') && form.get('requiredDate')?.errors?.['required']) {
                <span class="field-error">Required</span>
              }
              @if (touched('requiredDate') && form.get('requiredDate')?.errors?.['pastDate']) {
                <span class="field-error">Must be a future date</span>
              }
            </div>
          </section>

          <!-- RIGHT: Template picker -->
          <section class="panel">
            <h2 class="panel-title">Template</h2>

            <input class="search-input"
                   (input)="search$.next($any($event.target).value)"
                   placeholder="Search templates…" />

            <div class="template-list">
              @if (templates().length === 0) {
                <p class="empty-text">No templates found.</p>
              }
              @for (t of templates(); track t.code) {
                <div class="template-card" [class.selected]="selectedTemplate()?.code === t.code"
                     (click)="selectTemplate(t.code)">
                  <div class="tpl-main">
                    <span class="tpl-code">{{ t.code }}</span>
                    <span class="tpl-name">{{ t.displayName }}</span>
                  </div>
                  <div class="tpl-meta">
                    <span class="tpl-body">{{ t.bodyType }}</span>
                    @if (t.customerVariant) { <span class="tpl-variant">{{ t.customerVariant }}</span> }
                    @if (t.totalHours) { <span class="tpl-hours">{{ t.totalHours }}h</span> }
                  </div>
                </div>
              }
            </div>

            @if (selectedTemplate(); as tpl) {
              <div class="ops-preview">
                <div class="ops-header">
                  <span>{{ tpl.operations.length }} operations</span>
                  <span>{{ tplTotalHours(tpl) | number:'1.1-1' }}h total</span>
                  <span>{{ tplStationCount(tpl) }} stations</span>
                </div>
                @for (op of previewOps(tpl); track op.sequence) {
                  <div class="op-row" [class.op-ellipsis]="op.operationName === '…'">
                    @if (op.operationName !== '…') {
                      <span class="op-seq">{{ op.sequence }}</span>
                      <span class="op-name">{{ op.operationName }}</span>
                      <span class="op-hrs">{{ op.estimatedHours }}h</span>
                    } @else {
                      <span class="op-more">· · · {{ tpl.operations.length - 4 }} more operations · · ·</span>
                    }
                  </div>
                }
              </div>
            } @else {
              <p class="empty-text tpl-hint">
                Pick a template above, or
                <a class="skip-link" (click)="selectedTemplate.set(null)">create without template</a>.
              </p>
            }
          </section>
        </div>

        <div class="form-footer">
          <button type="button" class="btn-secondary" (click)="router.navigate(['/sales/ros'])">Cancel</button>
          <button type="submit" class="btn-primary" [disabled]="form.invalid || submitting()">
            {{ submitting() ? 'Creating…' : 'Create RO' }}
          </button>
        </div>
      </form>
    </main>
  `,
  styles: [`
    .topbar { display: flex; justify-content: space-between; align-items: center;
              padding: 14px 28px; background: var(--ink); color: var(--paper);
              border-bottom: 0.5px solid rgba(245,242,234,0.1); position: relative; z-index: 1; }
    .brand { display: flex; flex-direction: row; align-items: center; gap: 12px; }
    .brand-logo { height: 48px; width: auto; filter: brightness(0) invert(1); }
    .brand-sub  { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: rgba(245,242,234,0.5); }
    .topbar-right { display: flex; align-items: center; gap: 16px; }
    .back-link { font-size: 13px; color: rgba(245,242,234,0.7); cursor: pointer; transition: color 0.15s; }
    .back-link:hover { color: var(--paper); }
    .user-label { font-size: 13px; color: rgba(245,242,234,0.8); }
    .logout { background: transparent; border: 0.5px solid rgba(245,242,234,0.3); color: var(--paper);
              padding: 5px 12px; border-radius: 5px; cursor: pointer; font-size: 12px; }
    .logout:hover { background: rgba(245,242,234,0.1); }

    .stage { background: var(--paper); min-height: calc(100vh - 57px); padding-bottom: 40px; position: relative; z-index: 1; }
    .page-header { padding: 24px 28px 0; margin-bottom: 16px; }
    .page-title { font-family: var(--display); font-size: 28px; font-weight: 500; color: var(--ink);
                  letter-spacing: -0.02em; margin: 0; }
    .alert-error { background: #fef2f2; color: var(--bad); border-left: 4px solid var(--bad);
                   border-radius: 6px; padding: 10px 16px; margin: 0 28px 12px; font-size: 13px; }

    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 0 28px; }
    @media (max-width: 900px) { .two-col { grid-template-columns: 1fr; } }

    .panel { background: white; border: 0.5px solid var(--rule); border-radius: 12px; padding: 24px; }
    .panel-title { font-family: var(--mono); font-size: 11px; font-weight: 500; text-transform: uppercase;
                   letter-spacing: 0.12em; color: var(--ink-3); margin: 0 0 18px; }

    .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    .field label { font-family: var(--mono); font-size: 11px; text-transform: uppercase;
                   letter-spacing: 0.05em; color: var(--ink-3); font-weight: 500; }
    .req { color: var(--bad); }
    .field input, .field select {
      padding: 8px 10px; border: 0.5px solid var(--rule-strong); border-radius: 6px;
      font-size: 13px; background: var(--paper); color: var(--ink); }
    .field input:focus, .field select:focus { outline: none; border-color: var(--accent); background: white; }
    .field-error { font-family: var(--mono); font-size: 11px; color: var(--bad); }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

    /* Template picker */
    .search-input { width: 100%; padding: 8px 10px; border: 0.5px solid var(--rule-strong); border-radius: 6px;
                    font-size: 13px; background: var(--paper); color: var(--ink); margin-bottom: 10px; box-sizing: border-box; }
    .search-input:focus { outline: none; border-color: var(--accent); background: white; }
    .template-list { max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;
                     margin-bottom: 14px; }
    .template-card { padding: 10px 12px; border: 0.5px solid var(--rule); border-radius: 8px; cursor: pointer;
                     transition: background 0.15s, border-color 0.15s; }
    .template-card:hover { border-color: var(--ink-3); background: var(--paper-2); }
    .template-card.selected { background: var(--ink); border-color: var(--ink); }
    .template-card.selected .tpl-name { color: var(--paper); }
    .template-card.selected .tpl-code { color: var(--paper-3); }
    .template-card.selected .tpl-meta { color: rgba(245,242,234,0.6); }
    .template-card.selected .tpl-variant { color: rgba(245,242,234,0.7); }
    .template-card.selected .tpl-hours { color: var(--paper); }
    .tpl-main { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
    .tpl-code { font-family: var(--mono); font-size: 11px; font-weight: 500; color: var(--ink-3); }
    .tpl-name { font-size: 13px; font-weight: 500; color: var(--ink); }
    .tpl-meta { display: flex; gap: 8px; font-size: 11px; color: var(--ink-3); }
    .tpl-variant { color: var(--warn); }
    .tpl-hours { font-family: var(--mono); font-weight: 500; color: var(--ink); }

    .ops-preview { border: 0.5px solid var(--rule); border-radius: 8px; overflow: hidden; }
    .ops-header { display: flex; gap: 16px; padding: 8px 12px; background: var(--paper-2);
                  border-bottom: 0.5px solid var(--rule); font-family: var(--mono); font-size: 11px; font-weight: 500; color: var(--ink-3); }
    .op-row { display: flex; align-items: center; gap: 10px; padding: 6px 12px;
              border-bottom: 0.5px solid var(--rule); font-size: 12px; }
    .op-row:last-child { border-bottom: none; }
    .op-seq { font-family: var(--mono); width: 20px; color: var(--ink-3); flex-shrink: 0; font-size: 11px; }
    .op-name { flex: 1; color: var(--ink); font-size: 13px; }
    .op-hrs { font-family: var(--mono); font-size: 11px; color: var(--ink-3); }
    .op-more { font-family: var(--mono); color: var(--ink-3); font-size: 11px; padding: 4px 0; text-align: center; width: 100%; }
    .empty-text { font-size: 13px; color: var(--ink-3); text-align: center; padding: 20px 0; }
    .tpl-hint { margin-top: 12px; }
    .skip-link { color: var(--accent); cursor: pointer; text-decoration: underline; }

    .form-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 28px 0; }
    .btn-primary { background: var(--accent); color: white; border: none; padding: 12px 22px;
                   border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer;
                   transition: background 0.15s, transform 0.15s; }
    .btn-primary:hover:not(:disabled) { background: #9a3412; transform: translateY(-1px); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: transparent; color: var(--ink); border: 0.5px solid var(--rule-strong);
                     padding: 10px 18px; border-radius: 999px; font-size: 13px; font-weight: 500; cursor: pointer;
                     transition: background 0.15s, color 0.15s; }
    .btn-secondary:hover { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  `],
})
export class NewRoComponent implements OnInit {
  private fb = inject(FormBuilder);
  private http = inject(HttpClient);
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);
  router = inject(Router);

  user = this.auth.user;
  customers = signal<Customer[]>([]);
  jobTypes = signal<JobType[]>([]);
  templates = signal<TemplateSummary[]>([]);
  selectedTemplate = signal<TemplateDetail | null>(null);
  submitting = signal(false);
  apiError = signal<string | null>(null);
  searchQuery = '';
  search$ = new Subject<string>();

  form = this.fb.nonNullable.group({
    customerId:   ['', Validators.required],
    jobTypeId:    ['', Validators.required],
    rego:         ['', Validators.required],
    vin:          ['', [Validators.minLength(17), Validators.maxLength(17)]],
    make:         [''],
    model:        [''],
    paintColour:  [''],
    priority:     ['3', Validators.required],
    requiredDate: ['', [Validators.required, futureDate]],
  });

  ngOnInit() {
    this.http.get<Customer[]>('/api/customers').subscribe(c => this.customers.set(c));
    this.http.get<JobType[]>('/api/job-types').subscribe(j => this.jobTypes.set(j));

    this.search$.pipe(
      startWith(''),
      debounceTime(200),
      switchMap(q => this.http.get<TemplateSummary[]>(`/api/templates${q ? '?q=' + encodeURIComponent(q) : ''}`).pipe(catchError(() => of([])))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(t => this.templates.set(t));
  }

  selectTemplate(code: string) {
    if (this.selectedTemplate()?.code === code) {
      this.selectedTemplate.set(null);
      return;
    }
    this.http.get<TemplateDetail>(`/api/templates/${code}`).subscribe(d => this.selectedTemplate.set(d));
  }

  previewOps(tpl: TemplateDetail): (TemplateOperation | { sequence: number; operationName: string; estimatedHours: number; operationCode: string })[] {
    const ops = tpl.operations;
    if (ops.length <= 5) return ops;
    return [
      ...ops.slice(0, 3),
      { sequence: 0, operationCode: '', operationName: '…', estimatedHours: 0 },
      ops[ops.length - 1],
    ];
  }

  tplTotalHours(tpl: TemplateDetail) {
    return tpl.operations.reduce((s, o) => s + o.estimatedHours, 0);
  }

  tplStationCount(tpl: TemplateDetail) {
    return new Set(tpl.operations.map(o => o.operationCode.slice(0, 3))).size;
  }

  touched(field: string) {
    return this.form.get(field)?.touched;
  }

  async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.submitting.set(true);
    this.apiError.set(null);

    const v = this.form.getRawValue();
    const payload = {
      customerId:   v.customerId,
      jobTypeId:    Number(v.jobTypeId),
      rego:         v.rego,
      vin:          v.vin || undefined,
      make:         v.make || undefined,
      model:        v.model || undefined,
      paintColour:  v.paintColour || undefined,
      priority:     Number(v.priority),
      requiredDate: new Date(v.requiredDate).toISOString(),
      templateCode: this.selectedTemplate()?.code ?? undefined,
    };

    this.http.post<{ roId: string; roNumber: string; tasksCreated: number }>('/api/repair-orders', payload)
      .subscribe({
        next: res => this.router.navigate(['/sales/ro', res.roId], { queryParams: { created: '1' } }),
        error: err => {
          const msg = err?.error?.message ?? err?.error?.errors?.[0]?.message ?? 'Failed to create RO.';
          this.apiError.set(msg);
          this.submitting.set(false);
        },
      });
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
