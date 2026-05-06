import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;

  router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
  return false;
};

/** Role-based guard factory: roleGuard(['SALES','ADMIN']) */
export function roleGuard(allowed: string[]): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (!auth.isAuthenticated()) {
      router.navigate(['/login']);
      return false;
    }
    const ok = allowed.some(r => auth.hasRole(r));
    if (!ok) {
      // Route to the user's natural home rather than looping back to /dashboard
      const user = auth.user();
      const home = !user ? '/login'
        : user.roles.some(r => r === 'SUPERVISOR' || r === 'ADMIN') ? '/dashboard'
        : user.roles.some(r => r === 'DRAFTER') ? '/drafter'
        : user.roles.some(r => r === 'STATION_OWNER') ? '/kanban'
        : user.roles.some(r => r === 'TECHNICIAN') ? '/tech/tasks'
        : '/sales/ros';
      router.navigate([home]);
      return false;
    }
    return true;
  };
}
