import { createRouter, createWebHistory } from 'vue-router';
import FoundationPage from '../pages/FoundationPage.vue';
import ErrorPage from '../pages/ErrorPage.vue';
import NotFoundPage from '../pages/NotFoundPage.vue';
import InvitationAcceptancePage from '../pages/InvitationAcceptancePage.vue';
import SessionsPage from '../pages/SessionsPage.vue';
import SignInPage from '../pages/SignInPage.vue';
import UsersPage from '../pages/UsersPage.vue';
import DictionaryPage from '../pages/DictionaryPage.vue';
import FieldDesignerPage from '../pages/FieldDesignerPage.vue';
import ItemsPage from '../pages/ItemsPage.vue';
import ItemCreatePage from '../pages/ItemCreatePage.vue';
import ItemEditPage from '../pages/ItemEditPage.vue';
import StoragePage from '../pages/StoragePage.vue';
import StorageDetailPage from '../pages/StorageDetailPage.vue';

const routeComponents = {
  '/items': ItemsPage,
  '/items/new': ItemCreatePage,
  '/items/:publicId/edit': ItemEditPage,
  '/storage': StoragePage,
  '/storage/:publicId': StorageDetailPage,
  '/admin/categories': DictionaryPage,
  '/admin/statuses': DictionaryPage,
  '/admin/fields': FieldDesignerPage,
  '/admin/users': UsersPage,
};

/** Routes without a delivered page fall back to the foundation placeholder. @param {string} path */
function componentFor(path) {
  return Object.hasOwn(routeComponents, path)
    ? routeComponents[/** @type {keyof typeof routeComponents} */ (path)]
    : FoundationPage;
}

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
  component: componentFor(path),
  meta: {
    titleKey,
    layout: ['/', '/items/:publicId'].includes(path) ? 'public' : 'authenticated',
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
