// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installUi } from '@inventory-atlas/ui';
import { messages } from '@inventory-atlas/i18n';
import FieldDesignerPage from './FieldDesignerPage.vue';
import { sessionContextKey } from '../shared/auth/session-context.js';

const csrfToken = 'c'.repeat(43);
const fieldId = '0198f40c-92f3-7a12-bc9a-653f97786c30';
const optionId = '0198f40c-92f3-7a12-bc9a-653f97786c31';

const materials = {
  id: fieldId,
  key: 'materials',
  scope: 'item',
  categoryId: null,
  labels: { en: 'Materials', uk: 'Матеріали' },
  help: null,
  dataType: 'multiselect',
  required: false,
  repeatable: false,
  searchable: true,
  filterable: true,
  sortable: false,
  visibility: 'public',
  unit: null,
  defaultValue: null,
  validation: { maxSelected: 2 },
  displayOrder: 1,
  version: 3,
  archivedAt: null,
  options: [
    {
      id: optionId,
      key: 'metal',
      labels: { en: 'Metal', uk: 'Метал' },
      displayOrder: 0,
      archivedAt: null,
    },
    {
      id: '0198f40c-92f3-7a12-bc9a-653f97786c32',
      key: 'wood',
      labels: { en: 'Wood', uk: 'Дерево' },
      displayOrder: 1,
      archivedAt: '2026-09-09T10:00:00.000Z',
    },
  ],
};
const archivedField = {
  ...materials,
  id: '0198f40c-92f3-7a12-bc9a-653f97786c33',
  key: 'retired_field',
  labels: { en: 'Retired field' },
  dataType: 'text',
  options: [],
  archivedAt: '2026-09-09T10:00:00.000Z',
};

/** @param {unknown} body @param {number} [status] */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** PrimeVue's Select observes the viewport orientation, which jsdom does not provide. */
function stubMatchMedia() {
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
}

/** @param {Record<string, unknown>} [overrides] */
function stubFetch(overrides = {}) {
  const calls = /** @type {{ url: string, method: string, init: RequestInit }[]} */ ([]);
  const fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', init });
    const path = String(url);
    if (path.startsWith('/api/v1/categories')) return json([]);
    if (path.includes('conversion-preview'))
      return json(
        overrides.preview ?? {
          fieldDefinitionId: fieldId,
          fieldKey: 'materials',
          currentDataType: 'multiselect',
          targetDataType: 'select',
          supported: true,
          lossless: false,
          totalValues: 4,
          analyzedValues: 4,
          convertibleValues: 3,
          blockingValues: 1,
          truncated: false,
          requiresBackgroundConversion: true,
          reindexRequired: true,
          blockingIssues: ['TYPE_MISMATCH'],
        },
      );
    if (init.method === 'PATCH')
      return json(
        overrides.update ?? {
          definition: { ...materials, visibility: 'private', version: 4 },
          reindex: {
            massReindexRequired: true,
            reasons: ['visibility'],
            topic: 'search.rebuild-items.v1',
          },
        },
      );
    if (init.method === 'DELETE')
      return json({
        definition: archivedField,
        reindex: {
          massReindexRequired: true,
          reasons: ['archived'],
          topic: 'search.rebuild-items.v1',
        },
      });
    return json(overrides.list ?? [materials, archivedField]);
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, calls };
}

async function mountPage() {
  stubMatchMedia();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/fields', component: FieldDesignerPage }],
  });
  await router.push('/admin/fields');
  await router.isReady();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(FieldDesignerPage, {
    global: {
      plugins: [
        router,
        createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages }),
        [VueQueryPlugin, { queryClient }],
        { install: installUi },
      ],
      provide: {
        [sessionContextKey]: { summary: { permissions: ['manageSchema'], csrfToken } },
      },
    },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

afterEach(() => vi.unstubAllGlobals());

describe('field designer Admin page', () => {
  it('lists bilingual definitions with their flags and archived history', async () => {
    stubFetch();
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('Materials / Матеріали');
    expect(wrapper.text()).toContain('materials');
    expect(wrapper.text()).toContain('Multiselect');
    expect(wrapper.text()).toContain('Public');
    expect(wrapper.text()).toContain('Searchable');
    expect(wrapper.text()).toContain('Archived');
    expect(wrapper.text()).toContain('Create field');
    wrapper.unmount();
  });

  it('requests the item scope with archived definitions included', async () => {
    const { calls } = stubFetch();
    const wrapper = await mountPage();
    expect(
      calls.some(
        (call) => call.url === '/api/v1/field-definitions?scope=item&includeArchived=true',
      ),
    ).toBe(true);
    wrapper.unmount();
  });

  it('opens the editor with a dynamic preview control and its active options', async () => {
    stubFetch();
    const wrapper = await mountPage();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Edit')
      ?.trigger('click');
    await flushPromises();

    const dialog = document.body.textContent ?? '';
    expect(dialog).toContain('Editor preview');
    expect(dialog).toContain('Maximum selected options');
    // Select and multiselect cannot be repeatable, and take no stored default.
    expect(dialog).toContain('Select and multiselect cannot be repeatable');
    expect(dialog).toContain('Options');
    expect(dialog).toContain('Metal / Метал');
    expect(dialog).not.toContain('Wood / Дерево');
    expect(document.querySelector('#field-key')?.getAttribute('disabled')).not.toBeNull();
    wrapper.unmount();
  });

  it('archives a definition and reports the required mass reindex', async () => {
    const { calls } = stubFetch();
    const wrapper = await mountPage();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Archive')
      ?.trigger('click');
    await flushPromises();

    const archiveCall = calls.find((call) => call.method === 'DELETE');
    expect(archiveCall?.url).toBe(`/api/v1/field-definitions/${fieldId}`);
    expect(new Headers(archiveCall?.init.headers).get('If-Match')).toBe('3');
    expect(new Headers(archiveCall?.init.headers).get('X-CSRF-Token')).toBe(csrfToken);
    expect(wrapper.text()).toContain('A mass reindex is required because of: archived field.');
    wrapper.unmount();
  });

  it('sends the expected version and surfaces the reindex reasons after saving', async () => {
    const { calls } = stubFetch();
    const wrapper = await mountPage();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Edit')
      ?.trigger('click');
    await flushPromises();
    // The dialog footer is teleported out of the page component.
    [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Save')
      ?.click();
    await flushPromises();

    const saveCall = calls.find((call) => call.method === 'PATCH');
    expect(saveCall?.url).toBe(`/api/v1/field-definitions/${fieldId}`);
    const body = JSON.parse(String(saveCall?.init.body));
    expect(body).toMatchObject({
      expectedVersion: 3,
      dataType: 'multiselect',
      repeatable: false,
      visibility: 'public',
      validation: { maxSelected: 2 },
      // Select and multiselect take their values from options, never a stored default.
      defaultValue: null,
    });
    expect(body).not.toHaveProperty('key');
    expect(body).not.toHaveProperty('scope');
    expect(wrapper.text()).toContain('A mass reindex is required because of: visibility change.');
    wrapper.unmount();
  });
});
