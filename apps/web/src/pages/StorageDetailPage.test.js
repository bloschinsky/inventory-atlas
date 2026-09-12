// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppSelect, installUi } from '@inventory-atlas/ui';
import { messages } from '@inventory-atlas/i18n';
import { sessionContextKey } from '../shared/auth/session-context.js';
import StorageDetailPage from './StorageDetailPage.vue';

const sourcePublicId = '0198f40c-92f3-7a12-bc9a-653f97786c60';
const oldParentPublicId = '0198f40c-92f3-7a12-bc9a-653f97786c61';
const targetPublicId = '0198f40c-92f3-7a12-bc9a-653f97786c62';

afterEach(() => vi.unstubAllGlobals());

describe('STO-02 storage move workflow', () => {
  it('confirms a destination, sends the loaded version and refreshes the moved breadcrumb', async () => {
    let moved = false;
    const requests = /** @type {Array<{url:string, init:RequestInit}>} */ ([]);
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.includes('/field-definitions')) return json([]);
        if (init.method === 'POST') {
          moved = true;
          return json({
            ...nodeSummary(),
            parentPublicId: targetPublicId,
            depth: 1,
            version: 4,
          });
        }
        if (url.includes(`/storage-nodes/${sourcePublicId}`)) return json(nodeDetail(moved));
        const parent = new URL(url, 'http://inventory.test').searchParams.get('parentPublicId');
        if (parent) return json({ entries: [], nextCursor: null });
        return json({
          entries: [
            {
              ...nodeSummary(),
              publicId: oldParentPublicId,
              parentPublicId: null,
              title: 'Old warehouse',
              depth: 0,
            },
            {
              ...nodeSummary(),
              publicId: targetPublicId,
              parentPublicId: null,
              title: 'New warehouse',
              depth: 0,
            },
          ],
          nextCursor: null,
        });
      }),
    );

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/storage/:publicId', component: StorageDetailPage },
        { path: '/storage', component: { template: '<p />' } },
      ],
    });
    await router.push(`/storage/${sourcePublicId}`);
    await router.isReady();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = mount(StorageDetailPage, {
      global: {
        plugins: [
          router,
          createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages }),
          [VueQueryPlugin, { queryClient }],
          { install: installUi },
        ],
        provide: {
          [sessionContextKey]: {
            summary: { permissions: ['editItems'], csrfToken: 'c'.repeat(43) },
          },
        },
        stubs: { teleport: true },
      },
    });
    await flushPromises();

    await button(wrapper, 'Move location').trigger('click');
    await flushPromises();
    const destination = wrapper
      .findAllComponents(AppSelect)
      .find((component) => component.props('inputId') === 'move-destination');
    if (!destination) throw new Error('Expected the destination picker.');
    destination.vm.$emit('update:modelValue', targetPublicId);
    await flushPromises();
    await button(wrapper, 'Review move').trigger('click');
    expect(wrapper.text()).toContain('Move Source box into New warehouse?');

    await button(wrapper, 'Move location', true).trigger('click');
    await flushPromises();
    await flushPromises();

    const request = requests.find(({ init }) => init.method === 'POST');
    if (!request) throw new Error('Expected the move request.');
    expect(request.url).toContain(`/storage-nodes/${sourcePublicId}/move`);
    expect(new Headers(request.init.headers).get('If-Match')).toBe('"3"');
    expect(JSON.parse(String(request.init.body))).toEqual({
      targetParentPublicId: targetPublicId,
      expectedVersion: 3,
    });
    expect(wrapper.text()).toContain('New warehouse');
    wrapper.unmount();
  });
});

function nodeSummary() {
  return {
    publicId: sourcePublicId,
    parentPublicId: oldParentPublicId,
    nodeType: 'container',
    title: 'Source box',
    code: null,
    visibility: 'authenticated',
    depth: 1,
    version: 3,
  };
}

/** @param {boolean} moved */
function nodeDetail(moved) {
  return {
    ...nodeSummary(),
    ...(moved ? { parentPublicId: targetPublicId, version: 4 } : {}),
    breadcrumb: moved
      ? [
          { publicId: targetPublicId, title: 'New warehouse', depth: 0 },
          { publicId: sourcePublicId, title: 'Source box', depth: 1 },
        ]
      : [
          { publicId: oldParentPublicId, title: 'Old warehouse', depth: 0 },
          { publicId: sourcePublicId, title: 'Source box', depth: 1 },
        ],
    contents: { entries: [], nextCursor: null },
    attributes: {},
    updatedAt: '2026-09-12T10:00:00.000Z',
  };
}

/** @param {import('@vue/test-utils').VueWrapper} wrapper @param {string} label @param {boolean} [last] */
function button(wrapper, label, last = false) {
  const matches = wrapper.findAll('button').filter((entry) => entry.text() === label);
  const result = last ? matches.at(-1) : matches[0];
  if (!result) throw new Error(`Expected button: ${label}`);
  return result;
}

/** @param {unknown} body @param {number} [status] */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
