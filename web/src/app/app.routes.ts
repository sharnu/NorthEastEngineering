import { Routes } from '@angular/router';
import { isDevMode } from '@angular/core';
import { authGuard, roleGuard } from './core/auth.guard';
import { adminGuard } from './core/admin.guard';
// Drafter shell + children loaded lazily

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./auth/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [authGuard, roleGuard(['SUPERVISOR', 'ADMIN'])],
  },
  {
    path: 'kanban',
    loadComponent: () => import('./kanban/kanban-board.component').then(m => m.KanbanBoardComponent),
    canActivate: [authGuard],
  },
  {
    path: 'sales/ros',
    loadComponent: () => import('./sales/sales-ros.component').then(m => m.SalesRosComponent),
    canActivate: [authGuard, roleGuard(['SALES', 'SUPERVISOR', 'ADMIN'])],
  },
  {
    path: 'sales/new-ro',
    loadComponent: () => import('./sales/new-ro.component').then(m => m.NewRoComponent),
    canActivate: [authGuard, roleGuard(['SALES', 'ADMIN'])],
  },
  {
    path: 'sales/ro/:id',
    loadComponent: () => import('./sales/ro-detail.component').then(m => m.RoDetailComponent),
    canActivate: [authGuard, roleGuard(['SALES', 'SUPERVISOR', 'ADMIN'])],
  },
  {
    path: 'sales/pdf-review/:uploadId',
    loadComponent: () => import('./sales/pdf-review.component').then(m => m.PdfReviewComponent),
    canActivate: [authGuard, roleGuard(['SALES', 'ADMIN'])],
  },
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
  {
    path: 'admin',
    loadComponent: () => import('./admin/admin-shell.component').then(m => m.AdminShellComponent),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'drafter',
    loadComponent: () => import('./drafter/drafter-shell.component').then(m => m.DrafterShellComponent),
    canActivate: [authGuard, roleGuard(['DRAFTER', 'ADMIN'])],
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
  // Dev-only preview routes (stripped from production builds)
  ...(isDevMode() ? [{
    path: '_dev/station-card',
    loadComponent: () => import('./kanban/station-card-dev.component').then(m => m.StationCardDevComponent),
  }] : []),
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: '**', redirectTo: 'login' },
];
