import { Component, inject, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { AdminUsersComponent } from './admin-users.component';
import { AdminStationsComponent } from './admin-stations.component';
import { CustomersListComponent } from './customers-list.component';
import { CustomerFormComponent } from './customer-form.component';
import { CustomerDetailComponent } from './customer-detail.component';
import { CustomerSummary } from './admin.service';

@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [CommonModule, AdminUsersComponent, AdminStationsComponent,
            CustomersListComponent, CustomerFormComponent, CustomerDetailComponent],
  template: `
    <div class="topbar">
      <div class="brand">
        <img class="brand-logo" src="assets/nee-logo.png" alt="North East Engineering" />
        <span class="brand-sub">Admin</span>
      </div>
      <div class="topbar-right">
        @if (user(); as u) {
          <span class="user-label">{{ u.fullName }}</span>
        }
        <a class="nav-link" (click)="router.navigate(['/admin/chassis-stock'])">Chassis stock</a>
        <a class="nav-link" (click)="router.navigate(['/dashboard'])">Dashboard</a>
        <button class="logout" (click)="logout()">Sign out</button>
      </div>
    </div>

    <main class="stage">
      <div class="tab-bar">
        <button class="tab-btn" [class.tab-active]="tab() === 'users'"     (click)="tab.set('users')">Users</button>
        <button class="tab-btn" [class.tab-active]="tab() === 'stations'"  (click)="tab.set('stations')">Stations</button>
        <button class="tab-btn" [class.tab-active]="tab() === 'customers'" (click)="tab.set('customers')">Customers</button>
      </div>

      <div class="tab-content">
        @if (tab() === 'users') {
          <app-admin-users />
        } @else if (tab() === 'stations') {
          <app-admin-stations />
        } @else {
          <app-customers-list
            (openCreate)="showCustomerForm.set(true)"
            (openDetail)="openCustomerDetail($event)"
            #customersList />
        }
      </div>
    </main>

    @if (showCustomerForm()) {
      <app-customer-form
        [editId]="null"
        (saved)="onCustomerSaved()"
        (closed)="showCustomerForm.set(false)" />
    }

    @if (activeCustomerId()) {
      <app-customer-detail
        [customerId]="activeCustomerId()!"
        (closed)="activeCustomerId.set(null)"
        (refresh)="refreshCustomers()" />
    }
  `,
  styles: [`
    .topbar { display: flex; justify-content: space-between; align-items: center;
              padding: 14px 28px; background: var(--ink); color: var(--paper); }
    .brand  { display: flex; flex-direction: column; gap: 2px; }
    .brand-logo { height: 36px; width: auto; filter: brightness(0) invert(1); }
    .brand-sub  { font-family: var(--mono); font-size: 11px; text-transform: uppercase;
                  letter-spacing: 0.12em; color: rgba(245,242,234,0.5); }
    .topbar-right { display: flex; align-items: center; gap: 16px; }
    .user-label { font-size: 13px; color: rgba(245,242,234,0.8); }
    .nav-link { font-size: 13px; color: rgba(245,242,234,0.8); cursor: pointer;
                padding: 5px 0; border-bottom: 1px solid transparent; }
    .nav-link:hover { color: var(--paper); border-bottom-color: rgba(245,242,234,0.4); }
    .logout { background: transparent; border: 0.5px solid rgba(245,242,234,0.3); color: var(--paper);
              padding: 5px 12px; border-radius: 5px; cursor: pointer; font-size: 12px; }
    .stage { background: var(--paper); min-height: calc(100vh - 57px); }
    .tab-bar { display: flex; gap: 2px; padding: 0 28px; border-bottom: 1px solid var(--rule); }
    .tab-btn { background: none; border: none; padding: 12px 18px; font-size: 13px; color: var(--ink-3);
               cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .tab-btn:hover { color: var(--ink); }
    .tab-active { color: var(--ink) !important; border-bottom-color: var(--ink) !important; font-weight: 500; }
    .tab-content { padding: 24px 28px; }
  `],
})
export class AdminShellComponent {
  router = inject(Router);
  private auth = inject(AuthService);
  user = this.auth.user;
  tab = signal<'users' | 'stations' | 'customers'>('users');

  showCustomerForm  = signal(false);
  activeCustomerId  = signal<string | null>(null);

  @ViewChild(CustomersListComponent) private customersList?: CustomersListComponent;

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  openCustomerDetail(c: CustomerSummary) {
    this.activeCustomerId.set(c.id);
  }

  onCustomerSaved() {
    this.showCustomerForm.set(false);
    this.refreshCustomers();
  }

  refreshCustomers() {
    this.customersList?.load();
  }
}
