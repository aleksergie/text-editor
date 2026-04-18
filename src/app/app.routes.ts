import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () =>
      import('./demo/formatting-demo.component').then((m) => m.FormattingDemoComponent),
  },
  {
    path: 'plain',
    loadComponent: () => import('@text-editor/editor').then((m) => m.EditorComponent),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
