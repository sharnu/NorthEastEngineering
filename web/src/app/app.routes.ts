import { Routes } from '@angular/router';
import { isDevMode } from '@angular/core';
import { authGuard, roleGuard } from './core/auth.guard';
import { adminGuard } from './core/admin.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./auth/login.component').then(m => m.LoginComponent),
  },

  // Mobile / standalone routes — must be declared BEFORE the AppShell (path:'')
  // so they are matched first and not swallowed by the prefix-match parent.
  {
    path: 'tech/tasks',
    loadComponent: () => import('./tech/task-list.component').then(m => m.TechTaskListComponent),
    canActivate: [authGuard],
  },
  {
    path: 'tech/tasks/:id',
    loadComponent: () => import('./tech/task-detail.component').then(m => m.TechTaskDetailComponent),
    canActivate: [authGuard],
  },
  {
    path: 'tech/qc/:roId',
    loadComponent: () => import('./tech/qc.component').then(m => m.QcComponent),
    canActivate: [authGuard],
  },

  // Dev-only preview routes (stripped from production builds)
  ...(isDevMode() ? [{
    path: '_dev/station-card',
    loadComponent: () => import('./kanban/station-card-dev.component').then(m => m.StationCardDevComponent),
  }] : []),

  // Desktop routes — wrapped in AppShell (provides sidebar + topbar in SaaS theme).
  // path:'' with prefix matching catches all remaining URLs.
  {
    path: '',
    loadComponent: () => import('./core/shell/app-shell.component').then(m => m.AppShellComponent),
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent),
        canActivate: [roleGuard(['SUPERVISOR', 'ADMIN'])],
      },
      {
        path: 'dashboard/archive',
        loadComponent: () => import('./dashboard/archive.component').then(m => m.ArchiveComponent),
        canActivate: [roleGuard(['SUPERVISOR', 'ADMIN'])],
      },
      {
        path: 'kanban',
        loadComponent: () => import('./kanban/kanban-board.component').then(m => m.KanbanBoardComponent),
      },
      {
        path: 'sales/ros',
        loadComponent: () => import('./sales/sales-ros.component').then(m => m.SalesRosComponent),
        canActivate: [roleGuard(['SALES', 'SUPERVISOR', 'ADMIN'])],
      },
      {
        path: 'sales/new-ro',
        loadComponent: () => import('./sales/new-ro.component').then(m => m.NewRoComponent),
        canActivate: [roleGuard(['SALES', 'ADMIN'])],
      },
      {
        path: 'sales/ro/:id',
        loadComponent: () => import('./sales/ro-detail.component').then(m => m.RoDetailComponent),
        canActivate: [roleGuard(['SALES', 'SUPERVISOR', 'ADMIN'])],
      },
      {
        path: 'sales/pdf-review/:uploadId',
        loadComponent: () => import('./sales/pdf-review.component').then(m => m.PdfReviewComponent),
        canActivate: [roleGuard(['SALES', 'ADMIN'])],
      },
      {
        path: 'admin',
        loadComponent: () => import('./admin/admin-shell.component').then(m => m.AdminShellComponent),
        canActivate: [adminGuard],
      },
      {
        path: 'admin/chassis-stock',
        loadComponent: () => import('./admin/chassis-stock-upload.component').then(m => m.ChassisStockUploadComponent),
        canActivate: [adminGuard],
      },
      {
        path: 'drafter',
        loadComponent: () => import('./drafter/drafter-shell.component').then(m => m.DrafterShellComponent),
        canActivate: [roleGuard(['DRAFTER', 'ADMIN'])],
        children: [
          {
            path: '',
            loadComponent: () => import('./drafter/drafter-queue.component').then(m => m.DrafterQueueComponent),
          },
          {
            path: 'ros/:id',
            loadComponent: () => import('./drafter/drafter-ro-detail.component').then(m => m.DrafterRoDetailComponent),
          },
        ],
      },
      // Root URL for authenticated users → redirect to kanban (accessible by all roles)
      { path: '', pathMatch: 'full', redirectTo: 'kanban' },
    ],
  },

  { path: '**', redirectTo: 'login' },
];
