import {
  Component, OnInit, inject, signal, input, output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AdminService, CustomerDetail } from './admin.service';

@Component({
  selector: 'app-customer-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="form-overlay" (click)="onClose()">
      <div class="form-card" (click)="$event.stopPropagation()">
        <div class="form-header">
          <h2 class="form-title">{{ editId() ? 'Edit Customer' : 'New Customer' }}</h2>
          <button class="close-btn" (click)="onClose()">✕</button>
        </div>

        @if (error()) {
          <div class="alert-error">{{ error() }}</div>
        }

        <div class="field">
          <label>Name *</label>
          <input [(ngModel)]="name" placeholder="Customer name" />
        </div>

        <div class="field-row">
          <div class="field">
            <label>Code</label>
            <input [(ngModel)]="code" placeholder="DFE" minlength="2" maxlength="20"
                   (input)="onCodeInput($event)" />
            @if (codeError()) {
              <span class="field-error">{{ codeError() }}</span>
            }
          </div>
          <div class="field">
            <label>Customer No</label>
            <input [(ngModel)]="customerNo" placeholder="649" maxlength="20"
                   (input)="onCustomerNoInput($event)" />
            @if (customerNoError()) {
              <span class="field-error">{{ customerNoError() }}</span>
            }
          </div>
        </div>

        <div class="field">
          <label>ABN</label>
          <input [(ngModel)]="abn" placeholder="12 345 678 901" maxlength="20" />
        </div>

        <div class="field">
          <label>Bill To Name</label>
          <input [(ngModel)]="billToName" placeholder="Accounts Payable" />
        </div>

        <div class="field">
          <label>Bill To Address</label>
          <textarea [(ngModel)]="billToAddress" placeholder="Street address…" rows="2"></textarea>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Contact Email</label>
            <input [(ngModel)]="contactEmail" type="email" placeholder="contact@example.com" />
          </div>
          <div class="field">
            <label>Contact Phone</label>
            <input [(ngModel)]="contactPhone" placeholder="+61 2 9999 0000" />
          </div>
        </div>

        <div class="field">
          <label>Email Distribution List</label>
          <div class="dl-chips">
            @for (addr of dlChips(); track addr) {
              <span class="chip">
                {{ addr }}
                <button class="chip-remove" (click)="removeChip(addr)">×</button>
              </span>
            }
          </div>
          <input class="dl-input" [(ngModel)]="dlInput"
                 placeholder="Type address and press Enter or comma…"
                 (keydown)="onDlKey($event)"
                 (blur)="flushDlInput()" />
          @if (dlInputError()) {
            <span class="field-error">{{ dlInputError() }}</span>
          }
        </div>

        <div class="form-actions">
          @if (editId()) {
            @if (!confirmDeactivate()) {
              <button class="btn-deactivate" (click)="confirmDeactivate.set(true)">
                Deactivate customer
              </button>
            } @else {
              <div class="deactivate-confirm">
                @if (deactivateRoCount() > 0) {
                  <span class="deact-warn">⚠ {{ deactivateRoCount() }} active RO{{ deactivateRoCount() !== 1 ? 's' : '' }} will continue, but no new ROs can be created.</span>
                }
                <span>Confirm deactivation?</span>
                <button class="btn-danger-sm" (click)="doDeactivate()">Yes, deactivate</button>
                <button class="btn-sm" (click)="confirmDeactivate.set(false)">Cancel</button>
              </div>
            }
          }
          <div class="form-actions-right">
            <button class="btn-secondary" (click)="onClose()">Cancel</button>
            <button class="btn-primary" [disabled]="saving()" (click)="save()">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .form-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 600;
                    display: flex; align-items: flex-start; justify-content: center; padding-top: 60px; }
    .form-card { background: white; border-radius: 10px; padding: 28px; width: 540px; max-width: 95vw;
                 max-height: 85vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
    .form-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .form-title  { font-family: var(--display); font-size: 20px; font-weight: 500; margin: 0; }
    .close-btn   { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--ink-3); }
    .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field label { font-size: 12px; font-weight: 500; color: var(--ink-3); text-transform: uppercase;
                   letter-spacing: 0.06em; font-family: var(--mono); }
    .field input, .field textarea, .dl-input {
      border: 1px solid var(--rule); border-radius: 6px; padding: 8px 10px; font-size: 13px;
      font-family: inherit; outline: none; }
    .field input:focus, .field textarea:focus, .dl-input:focus { border-color: var(--ink); }
    .dl-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; min-height: 24px; }
    .chip { display: inline-flex; align-items: center; gap: 4px; background: #ede9fe; color: #5b21b6;
            padding: 3px 8px; border-radius: 12px; font-size: 12px; font-family: var(--mono); }
    .chip-remove { background: none; border: none; cursor: pointer; padding: 0; font-size: 14px;
                   color: #7c3aed; line-height: 1; }
    .dl-input { width: 100%; }
    .field-error { font-size: 11px; color: var(--bad); margin-top: 2px; }
    .alert-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px;
                   padding: 10px 14px; font-size: 13px; color: var(--bad); margin-bottom: 16px; }
    .form-actions { display: flex; justify-content: space-between; align-items: flex-end;
                    margin-top: 24px; flex-wrap: wrap; gap: 12px; }
    .form-actions-right { display: flex; gap: 8px; }
    .btn-primary  { background: var(--ink); color: var(--paper); border: none; border-radius: 6px;
                    padding: 9px 20px; font-size: 13px; cursor: pointer; }
    .btn-primary:hover:not(:disabled) { opacity: 0.85; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: white; color: var(--ink); border: 1px solid var(--rule); border-radius: 6px;
                     padding: 9px 20px; font-size: 13px; cursor: pointer; }
    .btn-deactivate { background: none; border: none; color: var(--bad); font-size: 12px;
                      cursor: pointer; text-decoration: underline; padding: 0; }
    .deactivate-confirm { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
                          background: #fef2f2; border-radius: 6px; padding: 8px 12px; }
    .deact-warn { font-size: 12px; color: var(--bad); }
    .btn-danger-sm { background: var(--bad); color: white; border: none; border-radius: 5px;
                     padding: 5px 12px; font-size: 12px; cursor: pointer; }
    .btn-sm { border: 1px solid var(--rule); background: white; border-radius: 5px;
              padding: 5px 12px; font-size: 12px; cursor: pointer; }
  `],
})
export class CustomerFormComponent implements OnInit {
  private svc = inject(AdminService);

  editId = input<string | null>(null);
  saved  = output<void>();
  closed = output<void>();

  // Form fields
  name         = '';
  code         = '';
  customerNo   = '';
  abn          = '';
  billToName   = '';
  billToAddress = '';
  contactEmail = '';
  contactPhone = '';
  dlChips      = signal<string[]>([]);
  dlInput      = '';
  dlInputError = signal<string | null>(null);

  saving             = signal(false);
  error              = signal<string | null>(null);
  confirmDeactivate  = signal(false);
  deactivateRoCount  = signal(0);
  codeError          = signal<string | null>(null);
  customerNoError    = signal<string | null>(null);

  private emailRegex  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  private codeRegex   = /^[A-Z0-9]+$/;
  private numericRegex = /^[0-9]+$/;

  ngOnInit() {
    const id = this.editId();
    if (!id) return;
    this.svc.getCustomer(id).subscribe(c => {
      this.name          = c.name;
      this.code          = c.code ?? '';
      this.customerNo    = c.customerNo ?? '';
      this.abn           = c.abn ?? '';
      this.billToName    = c.billToName ?? '';
      this.billToAddress = c.billToAddress ?? '';
      this.contactEmail  = c.contactEmail ?? '';
      this.contactPhone  = c.contactPhone ?? '';
      if (c.emailDl) {
        this.dlChips.set(c.emailDl.split(',').map(a => a.trim()).filter(a => a));
      }
      this.deactivateRoCount.set(c.activeRoCount);
    });
  }

  onDlKey(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.flushDlInput();
    }
    if (event.key === 'Backspace' && this.dlInput === '') {
      const chips = this.dlChips();
      if (chips.length > 0) this.dlChips.set(chips.slice(0, -1));
    }
  }

  flushDlInput() {
    const val = this.dlInput.replace(/,/g, '').trim();
    if (!val) return;
    if (!this.emailRegex.test(val)) {
      this.dlInputError.set(`"${val}" is not a valid email address`);
      return;
    }
    if (!this.dlChips().includes(val)) {
      this.dlChips.update(chips => [...chips, val]);
    }
    this.dlInput = '';
    this.dlInputError.set(null);
  }

  removeChip(addr: string) {
    this.dlChips.update(chips => chips.filter(c => c !== addr));
  }

  onCodeInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const val = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    this.code = val;
    input.value = val;
    if (val.length > 0 && val.length < 2)
      this.codeError.set('Code must be at least 2 characters.');
    else
      this.codeError.set(null);
  }

  onCustomerNoInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const val = input.value.replace(/[^0-9]/g, '');
    this.customerNo = val;
    input.value = val;
    this.customerNoError.set(null);
  }

  async save() {
    if (!this.name.trim()) { this.error.set('Customer name is required.'); return; }
    if (this.codeError() || this.customerNoError()) return;
    this.saving.set(true);
    this.error.set(null);

    const emailDl = this.dlChips().length > 0 ? this.dlChips().join(', ') : null;

    try {
      const id = this.editId();
      if (id) {
        await firstValueFrom(this.svc.updateCustomer(id, {
          name:          this.name.trim() || undefined,
          code:          this.code.trim() || null,
          customerNo:    this.customerNo.trim() || null,
          abn:           this.abn.trim() || null,
          billToName:    this.billToName.trim() || null,
          billToAddress: this.billToAddress.trim() || null,
          contactEmail:  this.contactEmail.trim() || null,
          contactPhone:  this.contactPhone.trim() || null,
          emailDl,
        }));
      } else {
        await firstValueFrom(this.svc.createCustomer({
          name:          this.name.trim(),
          code:          this.code.trim() || null,
          customerNo:    this.customerNo.trim() || null,
          abn:           this.abn.trim() || null,
          billToName:    this.billToName.trim() || null,
          billToAddress: this.billToAddress.trim() || null,
          contactEmail:  this.contactEmail.trim() || null,
          contactPhone:  this.contactPhone.trim() || null,
          emailDl,
        }));
      }
      this.saved.emit();
    } catch (e: any) {
      this.error.set(e?.error?.message ?? 'Save failed. Please try again.');
    } finally {
      this.saving.set(false);
    }
  }

  async doDeactivate() {
    this.saving.set(true);
    try {
      await firstValueFrom(this.svc.deactivateCustomer(this.editId()!));
      this.saved.emit();
    } catch (e: any) {
      this.error.set(e?.error?.message ?? 'Deactivation failed.');
    } finally {
      this.saving.set(false);
      this.confirmDeactivate.set(false);
    }
  }

  onClose() { this.closed.emit(); }
}
