import {
  Component, OnInit, inject, signal, DestroyRef,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, switchMap, debounceTime, startWith, catchError, of } from 'rxjs';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AuthService } from '../core/auth.service';
import { ThemeSwitcherComponent } from '../core/theme-switcher.component';

interface ScoredField {
  value: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  suggestion?: { customerId: string; customerName: string } | null;
}

interface ParseResult {
  uploadId: string;
  fields: Record<string, ScoredField>;
  rawText: string;
}

interface Customer { id: string; code: string; name: string; }
interface JobType { id: number; code: string; name: string; }
interface TemplateSummary { code: string; displayName: string; bodyType: string; customerVariant: string | null; totalHours: number | null; }
interface TemplateOperation { sequence: number; operationCode: string; operationName: string; estimatedHours: number; }
interface TemplateDetail extends TemplateSummary { operations: TemplateOperation[]; }

@Component({
  selector: 'app-pdf-review',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, ThemeSwitcherComponent],
  template: `
    <div class="topbar">
      <div class="brand">
        <img class="brand-logo" src="assets/nee-logo.png" alt="North East Engineering" />
        <span class="brand-sub">Production Platform</span>
      </div>
      <div class="topbar-right">
        <a class="back-link" (click)="router.navigate(['/sales/ros'])">&#8592; Repair Orders</a>
        @if (user(); as u) { <span class="user-label">{{ u.fullName }}</span> }
        <app-theme-switcher />
        <button class="logout" (click)="logout()">Sign out</button>
      </div>
    </div>

    <div class="pdf-review-layout">
      <!-- Left panel: PDF iframe -->
      <div class="pdf-panel">
        @if (pdfUrl()) {
          <iframe [src]="pdfUrl()!" class="pdf-frame" title="Source PDF"></iframe>
        } @else {
          <div class="pdf-loading">Loading PDF&#8230;</div>
        }
      </div>

      <!-- Right panel: pre-filled form -->
      <div class="form-panel">
        @if (parsing()) {
          <div class="parsing-state">Parsing PDF&#8230;</div>
        } @else if (parseError()) {
          <div class="alert-error">{{ parseError() }}</div>
        } @else {
          <div class="form-header">
            <h1 class="page-title">Review Extracted Fields</h1>
            <p class="form-hint">Fields highlighted in amber need your attention before creating the RO.</p>
          </div>

          @if (apiError()) {
            <div class="alert-error">{{ apiError() }}</div>
          }

          <form [formGroup]="form" (ngSubmit)="submit()">
            <!-- Customer & Job section -->
            <h2 class="section-title">Customer &amp; Job</h2>

            <div class="field-with-confidence">
              <label>
                Customer <span class="req">*</span>
                <ng-container *ngTemplateOutlet="confBadge; context: { field: 'customerName' }"></ng-container>
              </label>
              <select formControlName="customerId" [class.needs-review]="isLowConf('customerName')">
                <option value="">Select customer&#8230;</option>
                @for (c of customers(); track c.id) {
                  <option [value]="c.id">{{ c.name }}</option>
                }
              </select>
              @if (hasSuggestion('customerName')) {
                <span class="suggestion">
                  Did you mean <strong>{{ suggestion('customerName')!.customerName }}</strong>?
                  <a (click)="acceptCustomer('customerName')">Accept</a>
                </span>
              }
              @if (touched('customerId') && form.get('customerId')?.errors?.['required']) {
                <span class="field-error">Required</span>
              }
            </div>

            <div class="form-row">
              <div class="field-with-confidence">
                <label>Job Type <span class="req">*</span></label>
                <select formControlName="jobTypeId">
                  <option value="">Select job type&#8230;</option>
                  @for (j of jobTypes(); track j.id) {
                    <option [value]="j.id">{{ j.name }}</option>
                  }
                </select>
                @if (touched('jobTypeId') && form.get('jobTypeId')?.errors?.['required']) {
                  <span class="field-error">Required</span>
                }
              </div>

              <div class="field-with-confidence">
                <label>Priority <span class="req">*</span></label>
                <select formControlName="priority">
                  <option value="1">1 &#8212; Urgent</option>
                  <option value="2">2 &#8212; High</option>
                  <option value="3">3 &#8212; Normal</option>
                  <option value="4">4 &#8212; Low</option>
                </select>
              </div>
            </div>

            <div class="form-row">
              <div class="field-with-confidence">
                <label>
                  Required Date <span class="req">*</span>
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'requiredDate' }"></ng-container>
                </label>
                <input type="date" formControlName="requiredDate" [class.needs-review]="isLowConf('requiredDate')" />
                @if (touched('requiredDate') && form.get('requiredDate')?.errors?.['required']) {
                  <span class="field-error">Required</span>
                }
              </div>

              <div class="field-with-confidence">
                <label>
                  C/Order No
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'customerOrderNo' }"></ng-container>
                </label>
                <input formControlName="customerOrderNo" [class.needs-review]="isLowConf('customerOrderNo')" placeholder="Customer order number" />
              </div>
            </div>

            <!-- Source Document section -->
            <h2 class="section-title">Source Document</h2>

            <div class="form-row">
              <div class="field-with-confidence">
                <label>
                  Source RO No
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'sourceRoNumber' }"></ng-container>
                </label>
                <input formControlName="sourceRoNumber" [class.needs-review]="isLowConf('sourceRoNumber')" placeholder="e.g. 58053" />
              </div>

              <div class="field-with-confidence">
                <label>
                  Source RO Date
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'sourceRoDate' }"></ng-container>
                </label>
                <input type="date" formControlName="sourceRoDate" [class.needs-review]="isLowConf('sourceRoDate')" />
              </div>
            </div>

            <div class="form-row">
              <div class="field-with-confidence">
                <label>
                  Customer No
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'customerNo' }"></ng-container>
                </label>
                <input formControlName="customerNo" [class.needs-review]="isLowConf('customerNo')" placeholder="e.g. C001" />
              </div>

              <div class="field-with-confidence">
                <label>
                  ABN
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'customerAbn' }"></ng-container>
                </label>
                <input formControlName="customerAbn" [class.needs-review]="isLowConf('customerAbn')" placeholder="11 digits" />
              </div>
            </div>

            <div class="form-row">
              <div class="field-with-confidence">
                <label>
                  Owner Name
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'ownerName' }"></ng-container>
                </label>
                <input formControlName="ownerName" [class.needs-review]="isLowConf('ownerName')" placeholder="Vehicle owner" />
              </div>

              <div class="field-with-confidence">
                <label>
                  Mobile Phone
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'contactPhone' }"></ng-container>
                </label>
                <input formControlName="contactPhone" [class.needs-review]="isLowConf('contactPhone')" placeholder="e.g. 0412 345 678" />
              </div>
            </div>

            <div class="form-row">
              <div class="field-with-confidence">
                <label>
                  Business Phone
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'businessPhone' }"></ng-container>
                </label>
                <input formControlName="businessPhone" [class.needs-review]="isLowConf('businessPhone')" placeholder="e.g. 08 8280 9899" />
              </div>

              <div class="field-with-confidence">
                <label>
                  Contact Email
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'contactEmail' }"></ng-container>
                </label>
                <input formControlName="contactEmail" [class.needs-review]="isLowConf('contactEmail')" placeholder="e.g. owner@example.com" />
              </div>
            </div>

            <!-- Vehicle section -->
            <h2 class="section-title">Vehicle</h2>

            <div class="form-row">
              <div class="field-with-confidence">
                <label>
                  Rego <span class="req">*</span>
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'rego' }"></ng-container>
                </label>
                <input formControlName="rego" [class.needs-review]="isLowConf('rego')" placeholder="e.g. ABC123" />
                @if (touched('rego') && form.get('rego')?.errors?.['required']) {
                  <span class="field-error">Required</span>
                }
              </div>

              <div class="field-with-confidence">
                <label>
                  VIN
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'vin' }"></ng-container>
                </label>
                <input formControlName="vin" [class.needs-review]="isLowConf('vin')" placeholder="17 characters" />
              </div>
            </div>

            <div class="form-row">
              <div class="field-with-confidence">
                <label>
                  Make
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'make' }"></ng-container>
                </label>
                <input formControlName="make" [class.needs-review]="isLowConf('make')" placeholder="e.g. Isuzu" />
              </div>

              <div class="field-with-confidence">
                <label>
                  Model
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'model' }"></ng-container>
                </label>
                <input formControlName="model" [class.needs-review]="isLowConf('model')" placeholder="e.g. NPR75" />
              </div>
            </div>

            <div class="form-row">
              <div class="field-with-confidence">
                <label>Paint Colour</label>
                <input formControlName="paintColour" placeholder="e.g. White" />
              </div>

              <div class="field-with-confidence">
                <label>
                  Build Date
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'buildDate' }"></ng-container>
                </label>
                <input type="date" formControlName="buildDate" [class.needs-review]="isLowConf('buildDate')" />
              </div>
            </div>

            <div class="form-row">
              <div class="field-with-confidence">
                <label>
                  Chassis No
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'chassisNumber' }"></ng-container>
                </label>
                <input formControlName="chassisNumber" [class.needs-review]="isLowConf('chassisNumber')" placeholder="Chassis number" />
              </div>

              <div class="field-with-confidence">
                <label>
                  Engine No
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'engineNumber' }"></ng-container>
                </label>
                <input formControlName="engineNumber" [class.needs-review]="isLowConf('engineNumber')" placeholder="Engine number" />
              </div>
            </div>

            <div class="form-row">
              <div class="field-with-confidence">
                <label>
                  Odometer (km)
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'odometer' }"></ng-container>
                </label>
                <input type="number" formControlName="odometer" [class.needs-review]="isLowConf('odometer')" placeholder="km reading" />
              </div>

              <div class="field-with-confidence">
                <label>
                  Key Tag No
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'keyTagNo' }"></ng-container>
                </label>
                <input formControlName="keyTagNo" [class.needs-review]="isLowConf('keyTagNo')" placeholder="Key tag number" />
              </div>
            </div>

            <div class="form-row">
              <div class="field-with-confidence">
                <label>
                  Expected In Date
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'expectedInDate' }"></ng-container>
                </label>
                <input type="date" formControlName="expectedInDate" [class.needs-review]="isLowConf('expectedInDate')" />
              </div>

              <div class="field-with-confidence">
                <label>
                  Delivery Date
                  <ng-container *ngTemplateOutlet="confBadge; context: { field: 'deliveryDate' }"></ng-container>
                </label>
                <input type="date" formControlName="deliveryDate" [class.needs-review]="isLowConf('deliveryDate')" />
              </div>
            </div>

            <!-- Template section -->
            <h2 class="section-title">
              Template
              <ng-container *ngTemplateOutlet="confBadge; context: { field: 'templateCode' }"></ng-container>
            </h2>

            <input class="search-input"
                   (input)="search$.next($any($event.target).value)"
                   placeholder="Search templates&#8230;" />

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
                    <span>{{ t.bodyType }}</span>
                    @if (t.customerVariant) { <span class="tpl-variant">{{ t.customerVariant }}</span> }
                    @if (t.totalHours) { <span>{{ t.totalHours }}h</span> }
                  </div>
                </div>
              }
            </div>

            <div class="form-footer">
              <button type="button" class="btn-secondary" (click)="router.navigate(['/sales/ros'])">Cancel</button>
              <button type="submit" class="btn-primary" [disabled]="form.invalid || submitting()">
                {{ submitting() ? 'Creating&#8230;' : 'Confirm &amp; Create RO' }}
              </button>
            </div>
          </form>
        }
      </div>
    </div>

    <!-- Shared confidence badge template -->
    <ng-template #confBadge let-field="field">
      @if (fieldConf(field) === 'MEDIUM') {
        <span class="conf-badge conf-medium">&#9888; Review</span>
      } @else if (fieldConf(field) === 'LOW') {
        <span class="conf-badge conf-low">Needs review</span>
      } @else if (fieldConf(field) === 'NONE') {
        <span class="conf-badge conf-low">Not found</span>
      }
    </ng-template>
  `,
  styles: [`
    .topbar { display: flex; justify-content: space-between; align-items: center;
              padding: 14px 28px; background: var(--topbar-bg); color: var(--topbar-text);
              border-bottom: 0.5px solid var(--topbar-border); }
    .brand { display: flex; flex-direction: row; align-items: center; gap: 12px; }
    .brand-logo { height: 48px; width: auto; filter: var(--logo-filter); }
    .brand-sub  { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--topbar-sub); }
    .topbar-right { display: flex; align-items: center; gap: 16px; }
    .back-link { font-size: 13px; color: var(--topbar-muted); cursor: pointer; transition: color 0.15s; }
    .back-link:hover { color: var(--paper); }
    .user-label { font-size: 13px; color: var(--topbar-muted); }
    .logout { background: transparent; border: 0.5px solid var(--topbar-border); color: var(--topbar-text);
              padding: 5px 12px; border-radius: 5px; cursor: pointer; font-size: 12px; }
    .logout:hover { background: var(--topbar-hover); }

    .pdf-review-layout { display: grid; grid-template-columns: 1fr 1fr; height: calc(100vh - 57px); }
    @media (max-width: 900px) { .pdf-review-layout { grid-template-columns: 1fr; } }

    .pdf-panel { border-right: 0.5px solid var(--rule); overflow: hidden; background: var(--paper-2); }
    .pdf-frame { width: 100%; height: 100%; border: none; }
    .pdf-loading { display: flex; align-items: center; justify-content: center; height: 100%;
                   color: var(--ink-3); font-size: 14px; }

    .form-panel { overflow-y: auto; padding: 20px 24px 40px; background: var(--paper); }
    .form-header { margin-bottom: 20px; }
    .page-title { font-family: var(--display); font-size: 24px; font-weight: 500; color: var(--ink);
                  letter-spacing: -0.02em; margin: 0 0 6px; }
    .form-hint { font-size: 12px; color: var(--ink-3); margin: 0; }

    .parsing-state { padding: 40px; color: var(--ink-3); font-size: 14px; text-align: center; }
    .alert-error { background: #fef2f2; color: var(--bad); border-left: 4px solid var(--bad);
                   border-radius: 6px; padding: 10px 16px; margin-bottom: 16px; font-size: 13px; }

    .section-title { font-family: var(--mono); font-size: 11px; font-weight: 500; text-transform: uppercase;
                     letter-spacing: 0.12em; color: var(--ink-3); margin: 20px 0 12px; display: flex;
                     align-items: center; gap: 8px; }

    .field-with-confidence { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }
    .field-with-confidence label { font-family: var(--mono); font-size: 11px; text-transform: uppercase;
                                   letter-spacing: 0.05em; color: var(--ink-3); font-weight: 500;
                                   display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .req { color: var(--bad); }
    .field-with-confidence input, .field-with-confidence select {
      padding: 8px 10px; border: 0.5px solid var(--rule-strong); border-radius: 6px;
      font-family: inherit; font-size: 13px; font-weight: 400;
      background: var(--paper); color: var(--ink); }
    .field-with-confidence input:focus, .field-with-confidence select:focus {
      outline: none; border-color: var(--accent); background: white; }
    .needs-review { border-color: var(--warn) !important; background: #fffbeb !important; }
    .field-error { font-family: var(--mono); font-size: 11px; color: var(--bad); }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

    .conf-badge { font-family: var(--mono); font-size: 10px; padding: 2px 6px; border-radius: 3px;
                  font-weight: 500; }
    .conf-medium { background: #fef9c3; color: var(--warn); }
    .conf-low { background: #fee2e2; color: var(--bad); }

    .suggestion { font-size: 12px; color: var(--ink-3); display: block; margin-top: 2px; }
    .suggestion a { color: var(--accent); cursor: pointer; text-decoration: underline; margin-left: 4px; }

    .search-input { width: 100%; padding: 8px 10px; border: 0.5px solid var(--rule-strong); border-radius: 6px;
                    font-size: 13px; background: var(--paper); color: var(--ink); margin-bottom: 10px;
                    box-sizing: border-box; }
    .search-input:focus { outline: none; border-color: var(--accent); background: white; }
    .template-list { max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;
                     margin-bottom: 14px; }
    .template-card { padding: 10px 12px; border: 0.5px solid var(--rule); border-radius: 8px; cursor: pointer;
                     transition: background 0.15s, border-color 0.15s; }
    .template-card:hover { border-color: var(--ink-3); background: var(--paper-2); }
    .template-card.selected { background: var(--ink); border-color: var(--ink); }
    .template-card.selected .tpl-code,
    .template-card.selected .tpl-name,
    .template-card.selected .tpl-meta,
    .template-card.selected .tpl-meta span,
    .template-card.selected .tpl-variant { color: rgba(245,242,234,0.85); }
    .tpl-main { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
    .tpl-code { font-family: var(--mono); font-size: 11px; font-weight: 500; color: var(--ink-3); }
    .tpl-name { font-size: 13px; font-weight: 500; color: var(--ink); }
    .tpl-meta { display: flex; gap: 8px; font-size: 11px; color: var(--ink-3); }
    .tpl-variant { color: var(--warn); }
    .empty-text { font-size: 13px; color: var(--ink-3); text-align: center; padding: 20px 0; }

    .form-footer { display: flex; justify-content: flex-end; gap: 10px; padding-top: 16px; }
    .btn-primary { background: var(--accent); color: white; border: none; padding: 12px 22px;
                   border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer; }
    .btn-primary:hover:not(:disabled) { background: #9a3412; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: transparent; color: var(--ink); border: 0.5px solid var(--rule-strong);
                     padding: 10px 18px; border-radius: 999px; font-size: 13px; font-weight: 500; cursor: pointer; }
    .btn-secondary:hover { background: var(--topbar-bg); color: var(--topbar-text); border-color: var(--ink); }
  `],
})
export class PdfReviewComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);
  private http = inject(HttpClient);
  private sanitizer = inject(DomSanitizer);
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);
  router = inject(Router);

  user = this.auth.user;
  uploadId = '';

  parsing = signal(true);
  parseError = signal<string | null>(null);
  pdfUrl = signal<SafeResourceUrl | null>(null);
  parseResult = signal<ParseResult | null>(null);

  customers = signal<Customer[]>([]);
  jobTypes = signal<JobType[]>([]);
  templates = signal<TemplateSummary[]>([]);
  selectedTemplate = signal<TemplateDetail | null>(null);
  submitting = signal(false);
  apiError = signal<string | null>(null);
  search$ = new Subject<string>();

  form = this.fb.nonNullable.group({
    // Core
    customerId:       ['', Validators.required],
    jobTypeId:        ['', Validators.required],
    rego:             ['', Validators.required],
    vin:              [''],
    make:             [''],
    model:            [''],
    paintColour:      [''],
    priority:         ['3', Validators.required],
    requiredDate:     ['', Validators.required],
    // Source document
    customerOrderNo:  [''],
    sourceRoNumber:   [''],
    sourceRoDate:     [''],
    customerNo:       [''],
    customerAbn:      [''],
    ownerName:        [''],
    contactPhone:     [''],
    businessPhone:    [''],
    contactEmail:     [''],
    // Extended vehicle
    chassisNumber:    [''],
    engineNumber:     [''],
    buildDate:        [''],
    keyTagNo:         [''],
    odometer:         [null as number | null],
    expectedInDate:   [''],
    deliveryDate:     [''],
  });

  ngOnInit() {
    this.uploadId = this.route.snapshot.paramMap.get('uploadId')!;

    this.http.get<Customer[]>('/api/customers').subscribe(c => this.customers.set(c));
    this.http.get<JobType[]>('/api/job-types').subscribe(j => this.jobTypes.set(j));

    this.search$.pipe(
      startWith(''),
      debounceTime(200),
      switchMap(q => this.http.get<TemplateSummary[]>(`/api/templates${q ? '?q=' + encodeURIComponent(q) : ''}`).pipe(catchError(() => of([])))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(t => this.templates.set(t));

    this.http.get<{ uploadId: string; blobPath: string; fileName: string }>(`/api/sales/pdf-upload/${this.uploadId}`)
      .subscribe({
        next: info => {
          const url = `/uploads/${info.blobPath}`;
          this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
          this.triggerParse();
        },
        error: () => {
          this.parseError.set('Could not load upload info.');
          this.parsing.set(false);
        },
      });
  }

  private triggerParse() {
    this.http.post<ParseResult>(`/api/sales/pdf-upload/${this.uploadId}/parse`, {})
      .subscribe({
        next: result => {
          this.parseResult.set(result);
          this.parsing.set(false);
          this.prefillForm(result);
        },
        error: () => {
          this.parseError.set('PDF parsing failed. Please fill in the form manually.');
          this.parsing.set(false);
        },
      });
  }

  private prefillForm(result: ParseResult) {
    const f = result.fields;
    const patch: Record<string, string | number | null> = {};

    const str = (key: string) => {
      const field = f[key];
      if (field?.value && field.confidence !== 'NONE') patch[key] = field.value;
    };

    str('rego'); str('vin'); str('make'); str('model'); str('paintColour');
    str('chassisNumber'); str('engineNumber');
    str('keyTagNo'); str('sourceRoNumber');
    str('customerNo'); str('ownerName');
    str('contactPhone'); str('businessPhone'); str('contactEmail');
    str('customerOrderNo');

    const date = (key: string) => {
      if (f[key]?.value && f[key].confidence !== 'NONE') patch[key] = f[key].value!;
    };
    date('requiredDate'); date('sourceRoDate'); date('buildDate');
    date('expectedInDate'); date('deliveryDate');

    if (f['odometer']?.value && f['odometer'].confidence !== 'NONE')
      patch['odometer'] = parseInt(f['odometer'].value!, 10);
    if (f['customerAbn']?.value && f['customerAbn'].confidence !== 'NONE')
      patch['customerAbn'] = f['customerAbn'].value!;

    this.form.patchValue(patch as any);

    // Auto-accept HIGH confidence customer
    const cn = f['customerName'];
    if (cn?.confidence === 'HIGH' && cn.suggestion?.customerId)
      this.form.patchValue({ customerId: cn.suggestion.customerId });

    // Auto-select template if MEDIUM confidence (matched DB record)
    const tc = f['templateCode'];
    if (tc?.value && tc.confidence === 'MEDIUM') {
      this.http.get<TemplateDetail>(`/api/templates/${tc.value}`)
        .pipe(catchError(() => of(null)))
        .subscribe(d => { if (d) this.selectedTemplate.set(d); });
    }
  }

  selectTemplate(code: string) {
    if (this.selectedTemplate()?.code === code) {
      this.selectedTemplate.set(null);
      return;
    }
    this.http.get<TemplateDetail>(`/api/templates/${code}`).subscribe(d => this.selectedTemplate.set(d));
  }

  acceptCustomer(fieldKey: string) {
    const s = this.parseResult()?.fields[fieldKey]?.suggestion;
    if (s) this.form.patchValue({ customerId: s.customerId });
  }

  fieldConf(key: string): string {
    return this.parseResult()?.fields[key]?.confidence ?? '';
  }

  isLowConf(key: string): boolean {
    const c = this.fieldConf(key);
    return c === 'LOW' || c === 'NONE';
  }

  hasSuggestion(key: string): boolean {
    return !!this.parseResult()?.fields[key]?.suggestion;
  }

  suggestion(key: string) {
    return this.parseResult()?.fields[key]?.suggestion ?? null;
  }

  touched(field: string) {
    return this.form.get(field)?.touched;
  }

  submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.submitting.set(true);
    this.apiError.set(null);

    const v = this.form.getRawValue();
    const payload: Record<string, unknown> = {
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
      // Source document
      customerOrderNo: v.customerOrderNo || undefined,
      sourceRoNumber:  v.sourceRoNumber || undefined,
      sourceRoDate:    v.sourceRoDate || undefined,
      customerNo:      v.customerNo || undefined,
      customerAbn:     v.customerAbn || undefined,
      ownerName:       v.ownerName || undefined,
      contactPhone:    v.contactPhone || undefined,
      businessPhone:   v.businessPhone || undefined,
      contactEmail:    v.contactEmail || undefined,
      // Extended vehicle
      chassisNumber:   v.chassisNumber || undefined,
      engineNumber:    v.engineNumber || undefined,
      buildDate:       v.buildDate || undefined,
      keyTagNo:        v.keyTagNo || undefined,
      odometer:        v.odometer ?? undefined,
      expectedInDate:  v.expectedInDate ? new Date(v.expectedInDate).toISOString() : undefined,
      deliveryDate:    v.deliveryDate || undefined,
    };

    this.http.post<{ roId: string; roNumber: string; tasksCreated: number }>('/api/repair-orders', payload)
      .subscribe({
        next: res => {
          this.http.patch(`/api/sales/pdf-upload/${this.uploadId}/link`, { roId: res.roId })
            .pipe(catchError(() => of(null)))
            .subscribe(() => {
              this.router.navigate(['/sales/ro', res.roId], { queryParams: { created: '1' } });
            });
        },
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
