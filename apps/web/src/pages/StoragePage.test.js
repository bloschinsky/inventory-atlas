// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installUi } from '@inventory-atlas/ui';
import { messages } from '@inventory-atlas/i18n';
import { sessionContextKey } from '../shared/auth/session-context.js';
import StoragePage from './StoragePage.vue';

afterEach(() => vi.unstubAllGlobals());

describe('storage tree page', () => {
  it('browses roots and creates a node from the mobile-ready form', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
      })),
    );
    const requests = /** @type {{url: string, init: RequestInit}[]} */ ([]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.includes('/field-definitions')) return json([]);
        if (init.method === 'POST')
          return json(
            {
              publicId: '0198f40c-92f3-7a12-bc9a-653f97786c60',
              parentPublicId: null,
              nodeType: 'container',
              title: 'New box',
              code: null,
              visibility: 'authenticated',
              depth: 0,
              version: 1,
            },
            201,
          );
        return json({
          entries: [
            {
              publicId: '0198f40c-92f3-7a12-bc9a-653f97786c61',
              parentPublicId: null,
              nodeType: 'site',
              title: 'Workshop',
              code: 'WS',
              visibility: 'authenticated',
              depth: 0,
              version: 1,
            },
          ],
          nextCursor: null,
        });
      }),
    );
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/storage', component: StoragePage },
        { path: '/storage/:publicId', component: { template: '<p>Storage detail</p>' } },
      ],
    });
    await router.push('/storage');
    await router.isReady();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = mount(StoragePage, {
      global: {
        plugins: [
          router,
          createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages }),
          [VueQueryPlugin, { queryClient }],
          { install: installUi },
        ],
        provide: {
          [sessionContextKey]: {
            summary: {
              permissions: ['editItems', 'viewPrivateFields'],
              csrfToken: 'c'.repeat(43),
            },
          },
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Workshop');
    await wrapper.get('#storage-title').setValue('New box');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const createRequest = requests.find(({ init }) => init.method === 'POST');
    expect(createRequest).toBeDefined();
    const createBody = createRequest?.init.body;
    if (typeof createBody !== 'string') throw new Error('Expected a JSON request body.');
    expect(JSON.parse(createBody)).toMatchObject({
      title: 'New box',
      nodeType: 'container',
      attributes: {},
    });
    expect(router.currentRoute.value.path).toBe('/storage/0198f40c-92f3-7a12-bc9a-653f97786c60');
    wrapper.unmount();
  });
});

/** @param {unknown} body @param {number} [status] */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
