// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installUi } from '@inventory-atlas/ui';
import { messages } from '@inventory-atlas/i18n';
import DictionaryPage from './DictionaryPage.vue';
import { sessionContextKey } from '../shared/auth/session-context.js';

afterEach(() => vi.unstubAllGlobals());

describe('dictionary Admin page', () => {
  it('renders bilingual entries including archived history', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                id: 'category-id',
                key: 'tools',
                labels: { en: 'Tools', uk: 'Інструменти' },
                displayOrder: 1,
                version: 2,
                archivedAt: '2026-09-09T10:00:00.000Z',
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/admin/categories', component: DictionaryPage }],
    });
    await router.push('/admin/categories');
    await router.isReady();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = mount(DictionaryPage, {
      global: {
        plugins: [
          router,
          createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages }),
          [VueQueryPlugin, { queryClient }],
          { install: installUi },
        ],
        provide: {
          [sessionContextKey]: {
            summary: { permissions: ['manageSchema'], csrfToken: 'c'.repeat(43) },
          },
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Tools / Інструменти');
    expect(wrapper.text()).toContain('Archived');
    expect(wrapper.text()).toContain('Create entry');
  });
});
