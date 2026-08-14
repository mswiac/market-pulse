import { Routes } from '@angular/router';
import { adminGuard } from './core/auth/admin.guard';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./core/shell/shell').then((m) => m.Shell),
    canActivate: [authGuard],
    children: [
      { path: '', loadComponent: () => import('./features/home/home').then((m) => m.Home) },
      {
        path: 'history',
        loadComponent: () => import('./features/instrument-history/instrument-history').then((m) => m.InstrumentHistory),
      },
      {
        path: 'history/triggers',
        loadComponent: () => import('./features/trigger-history/trigger-history').then((m) => m.TriggerHistory),
      },
      {
        path: 'admin',
        loadComponent: () => import('./features/admin/admin-panel').then((m) => m.AdminPanel),
        canActivate: [adminGuard],
      },
      {
        path: 'admin/add-instrument',
        loadComponent: () => import('./features/admin/add-instrument/add-instrument').then((m) => m.AddInstrument),
        canActivate: [adminGuard],
      },
      {
        path: 'admin/remove-instrument',
        loadComponent: () => import('./features/admin/remove-instrument/remove-instrument').then((m) => m.RemoveInstrument),
        canActivate: [adminGuard],
      },
      {
        path: 'admin/remove-user',
        loadComponent: () => import('./features/admin/remove-user/remove-user').then((m) => m.RemoveUser),
        canActivate: [adminGuard],
      },
    ],
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register/register').then((m) => m.Register),
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
  },
  { path: '**', redirectTo: '' },
];
