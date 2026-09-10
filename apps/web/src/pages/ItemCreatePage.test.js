// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppSelect, installUi } from '@inventory-atlas/ui';
import { messages } from '@inventory-atlas/i18n';
import ItemCreatePage from './ItemCreatePage.vue';
import ItemAttributeField from '../features/items/ItemAttributeField.vue';
import { sessionContextKey } from '../shared/auth/session-context.js';

const categoryId = '0198f40c-92f3-7a12-bc9a-653f97786001';
const statusId = '0198f40c-92f3-7a12-bc9a-653f97786002';
const optionId = '0198f40c-92f3-7a12-bc9a-653f97786003';
const publicId = '0198f40b-92f3-7a12-bc9a-653f97786004';

afterEach(() => vi.unstubAllGlobals());

describe('CAT-03C Item creation page', () => {
  it('loads category fields for an Editor and immediately renders the created card', async () => {
    const requests = /** @type {{ url: string, init: RequestInit }[]} */ ([]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request, init = {}) => {
        const url = String(request);
        requests.push({ url, init });
        if (url.includes('/categories'))
          return json([{ id: categoryId, labels: { en: 'Tools', uk: 'Інструменти' } }]);
        if (url.includes('/lifecycle-statuses'))
          return json([{ id: statusId, labels: { en: 'Stored', uk: 'Зберігається' } }]);
        if (url.includes('/field-definitions'))
          return json([
            field('serial_number', 'Serial number', 'Серійний номер', { required: true }),
            field('condition', 'Condition', 'Стан', {
              dataType: 'select',
              options: [
                {
                  id: optionId,
                  labels: { en: 'Good', uk: 'Добрий' },
                  archivedAt: null,
                },
              ],
            }),
            field('owner_note', 'Owner note', 'Нотатка власника', { visibility: 'private' }),
          ]);
        return json(
          { publicId, slug: 'cordless-drill', displayName: 'Cordless drill', version: 1 },
          201,
        );
      }),
    );
    const wrapper = mountPage('en', ['editItems']);
    await flushPromises();

    select(wrapper, 'item-category', categoryId);
    select(wrapper, 'item-status', statusId);
    await flushPromises();
    expect(requests.some(({ url }) => url.includes(`categoryId=${categoryId}`))).toBe(true);
    expect(requests.every(({ url }) => !url.includes('includeArchived=true'))).toBe(true);
    expect(wrapper.text()).not.toContain('Owner note');

    await wrapper.get('#item-name').setValue('Cordless drill');
    const fields = wrapper.findAllComponents(ItemAttributeField);
    const serialField = fields.find((entry) => entry.props('definition').key === 'serial_number');
    const conditionField = fields.find((entry) => entry.props('definition').key === 'condition');
    if (!serialField || !conditionField)
      throw new Error('Expected category fields were not rendered.');
    serialField.vm.$emit('update:modelValue', 'SN-42');
    conditionField.vm.$emit('update:modelValue', optionId);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const createRequest = requests.find(({ url }) => url.endsWith('/api/v1/items'));
    expect(createRequest).toBeTruthy();
    if (!createRequest) throw new Error('Expected the create request.');
    expect(JSON.parse(String(createRequest.init.body))).toMatchObject({
      categoryId,
      lifecycleStatusId: statusId,
      displayName: 'Cordless drill',
      attributes: { serial_number: 'SN-42', condition: optionId },
    });
    expect(new Headers(createRequest.init.headers).get('Idempotency-Key')).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
    expect(wrapper.text()).toContain('The item was created and is ready to view.');
    expect(wrapper.text()).toContain('Cordless drill');
    expect(wrapper.text()).toContain('SN-42');
    expect(wrapper.text()).toContain('Good');
    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe(
      'Placeholder image for Tools',
    );
  });

  it('renders Ukrainian schema labels and exposes no create form to a Viewer', async () => {
    const fetch = vi.fn(async () => json([]));
    vi.stubGlobal('fetch', fetch);
    const wrapper = mountPage('uk', ['viewAuthenticatedFields']);
    await flushPromises();

    expect(wrapper.get('h1').text()).toBe('Нова річ');
    expect(wrapper.text()).toContain('У вас немає дозволу на цю дію.');
    expect(wrapper.find('form').exists()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

/** @param {'en'|'uk'} locale @param {string[]} permissions */
function mountPage(locale, permissions) {
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
  return mount(ItemCreatePage, {
    global: {
      plugins: [
        createI18n({ legacy: false, locale, fallbackLocale: 'en', messages }),
        [VueQueryPlugin, { queryClient }],
        { install: installUi },
      ],
      provide: {
        [sessionContextKey]: {
          summary: {
            permissions,
            csrfToken: 'c'.repeat(43),
          },
        },
      },
    },
  });
}

/**
 * @param {import('@vue/test-utils').VueWrapper} wrapper
 * @param {'item-category'|'item-status'|'item-visibility'} inputId
 * @param {unknown} value
 */
function select(wrapper, inputId, value) {
  const indexes = { 'item-category': 0, 'item-status': 1, 'item-visibility': 2 };
  const component = wrapper.findAllComponents(AppSelect)[indexes[inputId]];
  component.vm.$emit('update:modelValue', value);
}

/** @param {string} key @param {string} en @param {string} uk @param {Record<string, unknown>} [overrides] */
function field(key, en, uk, overrides = {}) {
  return {
    id: `field-${key}`,
    key,
    labels: { en, uk },
    help: null,
    dataType: 'text',
    required: false,
    repeatable: false,
    visibility: 'authenticated',
    defaultValue: null,
    options: [],
    ...overrides,
  };
}

/** @param {unknown} body @param {number} [status] */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
