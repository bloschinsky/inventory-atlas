// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installUi } from '@inventory-atlas/ui';
import { messages } from '@inventory-atlas/i18n';
import ItemEditPage from './ItemEditPage.vue';
import ItemAttributeField from '../features/items/ItemAttributeField.vue';
import { sessionContextKey } from '../shared/auth/session-context.js';

const categoryId = '0198f40c-92f3-7a12-bc9a-653f97786001';
const statusId = '0198f40c-92f3-7a12-bc9a-653f97786002';
const publicId = '0198f40b-92f3-7a12-bc9a-653f97786004';

afterEach(() => vi.unstubAllGlobals());

describe('CAT-04C conflict-aware Item edit page', () => {
  it('sends the loaded version as If-Match and reports the saved change', async () => {
    const requests = stubApi({ item: () => storedItem(3) });
    const wrapper = await mountPage('en', ['editItems']);
    await flushPromises();
    await flushPromises();

    expect(wrapper.text()).toContain('Version 3');
    expect(/** @type {HTMLInputElement} */ (wrapper.get('#item-name').element).value).toBe(
      'Cordless drill',
    );
    const serial = wrapper
      .findAllComponents(ItemAttributeField)
      .find((entry) => entry.props('definition').key === 'serial_number');
    if (!serial) throw new Error('Expected the serial number field.');
    expect(serial.props('modelValue')).toBe('SN-42');

    serial.vm.$emit('update:modelValue', 'SN-43');
    await wrapper.get('#item-name').setValue('Cordless drill mk2');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const update = requests.find(({ init }) => init.method === 'PATCH');
    if (!update) throw new Error('Expected the update request.');
    expect(new Headers(update.init.headers).get('If-Match')).toBe('"3"');
    expect(JSON.parse(String(update.init.body))).toMatchObject({
      expectedVersion: 3,
      displayName: 'Cordless drill mk2',
      attributes: { serial_number: 'SN-43' },
    });
    expect(wrapper.text()).toContain('Your changes were saved.');
  });

  it('opens a compare/reload/abandon workflow on conflict without overwriting', async () => {
    let version = 3;
    const requests = stubApi({
      item: () => storedItem(version),
      update: () =>
        json(
          {
            code: 'ITEM_VERSION_CONFLICT',
            currentVersion: 4,
            safeDiff: {
              displayName: { current: 'Cordless drill (workshop)', submitted: 'Mine' },
              'attributes.serial_number': { current: 'SN-99', submitted: 'SN-43' },
            },
          },
          409,
        ),
    });
    const wrapper = await mountPage('en', ['editItems']);
    await flushPromises();
    await flushPromises();

    await wrapper.get('#item-name').setValue('Mine');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.text()).toContain('This item changed while you were editing');
    expect(wrapper.text()).toContain('This item is now at version 4.');
    expect(requests.filter(({ init }) => init.method === 'PATCH')).toHaveLength(1);

    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Cordless drill (workshop)');
    expect(wrapper.text()).toContain('SN-99');
    expect(wrapper.text()).toContain('Serial number');

    version = 4;
    const buttons = wrapper.findAll('button');
    const reload = buttons.find((button) => button.text() === 'Reload the saved version');
    if (!reload) throw new Error('Expected the reload action.');
    await reload.trigger('click');
    await flushPromises();
    await flushPromises();

    expect(wrapper.find('form').exists()).toBe(true);
    expect(wrapper.text()).toContain('Version 4');
    expect(/** @type {HTMLInputElement} */ (wrapper.get('#item-name').element).value).toBe(
      'Cordless drill',
    );
    expect(requests.filter(({ init }) => init.method === 'PATCH')).toHaveLength(1);
  });

  it('shows Ukrainian conflict guidance and hides the form from a Viewer', async () => {
    const fetch = vi.fn(async () => json([]));
    vi.stubGlobal('fetch', fetch);
    const wrapper = await mountPage('uk', ['viewAuthenticatedFields']);
    await flushPromises();

    expect(wrapper.get('h1').text()).toBe('Редагування речі');
    expect(wrapper.text()).toContain('У вас немає дозволу на цю дію.');
    expect(wrapper.find('form').exists()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(messages.uk.items.conflictReload).toBe('Перезавантажити збережену версію');
  });
});

/** @param {number} version */
function storedItem(version) {
  return {
    publicId,
    slug: 'cordless-drill',
    displayName: 'Cordless drill',
    description: null,
    categoryId,
    lifecycleStatusId: statusId,
    storageNodeId: null,
    visibility: 'authenticated',
    version,
    tags: ['workshop'],
    attributes: { serial_number: 'SN-42' },
    updatedAt: '2026-09-10T12:00:00.000Z',
  };
}

/** @param {{ item: () => unknown, update?: () => Response }} handlers */
function stubApi(handlers) {
  const requests = /** @type {{ url: string, init: RequestInit }[]} */ ([]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request, init = {}) => {
      const url = String(request);
      requests.push({ url, init });
      if (init.method === 'PATCH')
        return handlers.update
          ? handlers.update()
          : json({ publicId, slug: 'cordless-drill', displayName: 'Saved', version: 4 });
      if (url.includes('/categories'))
        return json([{ id: categoryId, labels: { en: 'Tools', uk: 'Інструменти' } }]);
      if (url.includes('/lifecycle-statuses'))
        return json([{ id: statusId, labels: { en: 'Stored', uk: 'Зберігається' } }]);
      if (url.includes('/media')) return json([]);
      if (url.includes('/field-definitions'))
        return json([
          {
            id: 'field-serial_number',
            key: 'serial_number',
            labels: { en: 'Serial number', uk: 'Серійний номер' },
            help: null,
            dataType: 'text',
            required: true,
            repeatable: false,
            visibility: 'authenticated',
            defaultValue: null,
            options: [],
          },
        ]);
      return json(handlers.item());
    }),
  );
  return requests;
}

/** @param {'en'|'uk'} locale @param {string[]} permissions */
async function mountPage(locale, permissions) {
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/items/:publicId', component: { template: '<p />' } },
      { path: '/items/:publicId/edit', component: ItemEditPage },
    ],
  });
  await router.push(`/items/${publicId}/edit`);
  await router.isReady();
  return mount(ItemEditPage, {
    global: {
      plugins: [
        createI18n({ legacy: false, locale, fallbackLocale: 'en', messages }),
        [VueQueryPlugin, { queryClient }],
        router,
        { install: installUi },
      ],
      provide: {
        [sessionContextKey]: { summary: { permissions, csrfToken: 'c'.repeat(43) } },
      },
    },
  });
}

/** @param {unknown} body @param {number} [status] */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
