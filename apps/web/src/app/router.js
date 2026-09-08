import { createRouter, createWebHistory } from 'vue-router';
import FoundationPage from '../pages/FoundationPage.vue';
import ErrorPage from '../pages/ErrorPage.vue';
import NotFoundPage from '../pages/NotFoundPage.vue';
import InvitationAcceptancePage from '../pages/InvitationAcceptancePage.vue';
import SessionsPage from '../pages/SessionsPage.vue';
import SignInPage from '../pages/SignInPage.vue';
import UsersPage from '../pages/UsersPage.vue';

export const routeRecords = [
  ['/', 'routes.home'],
  ['/items', 'routes.items'],
  ['/items/new', 'routes.itemNew'],
  ['/items/:publicId', 'routes.itemDetail'],
  ['/items/:publicId/edit', 'routes.itemEdit'],
  ['/storage', 'routes.storage'],
  ['/storage/:publicId', 'routes.storageDetail'],
  ['/scan', 'routes.scan'],
  ['/labels', 'routes.labels'],
  ['/labels/batches/:id', 'routes.labelBatch'],
  ['/portability', 'routes.portability'],
  ['/admin/fields', 'routes.adminFields'],
  ['/admin/categories', 'routes.adminCategories'],
  ['/admin/statuses', 'routes.adminStatuses'],
  ['/admin/users', 'routes.adminUsers'],
  ['/admin/settings', 'routes.adminSettings'],
  ['/admin/audit', 'routes.adminAudit'],
].map(([path, titleKey]) => ({
  path,
  component: path === '/admin/users' ? UsersPage : FoundationPage,
  meta: {
    titleKey,
    layout: ['/', '/items/:publicId', '/storage/:publicId'].includes(path)
      ? 'public'
      : 'authenticated',
  },
}));

export const supportRoutes = [
  {
    path: '/auth/sign-in',
    component: SignInPage,
    meta: { layout: 'public', titleKey: 'auth.signIn' },
  },
  {
    path: '/auth/invitations/accept',
    component: InvitationAcceptancePage,
    meta: { layout: 'public', titleKey: 'auth.acceptInvitation' },
  },
  {
    path: '/account/sessions',
    component: SessionsPage,
    meta: { layout: 'authenticated', titleKey: 'auth.sessions' },
  },
  { path: '/error', component: ErrorPage, meta: { layout: 'public', titleKey: 'routes.error' } },
  {
    path: '/:pathMatch(.*)*',
    component: NotFoundPage,
    meta: { layout: 'public', titleKey: 'routes.notFound' },
  },
];

export function createAppRouter() {
  return createRouter({ history: createWebHistory(), routes: [...routeRecords, ...supportRoutes] });
}
