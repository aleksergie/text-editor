import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '**',
    loadComponent: () => import('@text-editor/editor').then(m => m.EditorComponent),
  },
];
