// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createI18n } from 'vue-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installUi } from '@inventory-atlas/ui';
import { messages } from '@inventory-atlas/i18n';
import DisplayTemplateEditor from './DisplayTemplateEditor.vue';

const categoryId = '0198f40c-92f3-7a12-bc9a-653f97786001';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CAT-05B display-name template editor', () => {
  it('inserts tokens, previews both locales, and hides private fields', async () => {
    const previews = /** @type {Record<string, unknown>[]} */ ([]);
    stubApi((body) => {
      previews.push(body);
      return json({
        template: body.template,
        tokens: [{ key: 'brand', kind: 'field', labels: null, dataType: 'text' }],
        rendered: { en: 'Cameras Pentax', uk: 'Фотокамери Pentax' },
        missingTokens: ['model'],
      });
    });
    const wrapper = await mountEditor('en');

    const tokenButtons = wrapper.findAll('.template-editor__tokens button');
    expect(tokenButtons.map((button) => button.text())).toEqual([
      'Category',
      'Lifecycle status',
      'Brand',
      'Model',
    ]);
    expect(wrapper.text()).not.toContain('Owner note');

    await tokenButtons[0].trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['{{category}}']);
    await wrapper.setProps({ modelValue: '{{category}}' });
    await tokenButtons[2].trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['{{category}} {{brand}}']);

    await wrapper.setProps({ modelValue: '{{category}} {{brand}}' });
    await settle();
    expect(previews.at(-1)).toMatchObject({ template: '{{category}} {{brand}}' });
    expect(wrapper.text()).toContain('Cameras Pentax');
    expect(wrapper.text()).toContain('Фотокамери Pentax');
    expect(wrapper.text()).toContain('Skipped with no sample value: model');
  });

  it('sends a sample value for a token the template uses', async () => {
    const previews = /** @type {Record<string, unknown>[]} */ ([]);
    stubApi((body) => {
      previews.push(body);
      return json({
        template: body.template,
        tokens: [],
        rendered: { en: 'Nikon', uk: 'Nikon' },
        missingTokens: [],
      });
    });
    const wrapper = await mountEditor('en', '{{brand}}');
    await settle();

    const sampleInput = wrapper.get('#template-sample-brand');
    await sampleInput.setValue('Nikon');
    await settle();

    expect(previews.at(-1)).toMatchObject({
      template: '{{brand}}',
      sample: { brand: 'Nikon' },
    });
  });

  it('reports a rejected template with a localized message and no API prose', async () => {
    stubApi(() =>
      json(
        {
          code: 'VALIDATION_FAILED',
          detail: 'The display-name template is invalid.',
          fieldErrors: [
            { field: 'displayTemplate', messages: ['TEMPLATE_PRIVATE_TOKEN:owner_note'] },
          ],
        },
        400,
      ),
    );
    const wrapper = await mountEditor('uk', '{{owner_note}}');
    await settle();

    expect(wrapper.get('[role="alert"]').text()).toBe(
      'Приватне поле не може бути в назві. (owner_note)',
    );
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('The display-name template is invalid.');
    expect(messages.uk.catalog.templateIssues.unknownToken).toBe(
      'У цієї категорії немає такого поля.',
    );
  });

  it('defers the preview until the category is saved', async () => {
    const fetch = stubApi(() => json({}));
    const wrapper = await mountEditor('en', '{{brand}}', '');
    await settle();

    expect(wrapper.text()).toContain('Save the category to preview its rendered name.');
    expect(
      fetch.mock.calls.filter(([url]) => String(url).includes('display-name-preview')),
    ).toHaveLength(0);
  });
});

async function settle() {
  await flushPromises();
  vi.advanceTimersByTime(300);
  await flushPromises();
  await flushPromises();
}

/** @param {(body: Record<string, any>) => Response} onPreview */
function stubApi(onPreview) {
  const fetch = vi.fn(async (request, init = {}) => {
    const url = String(request);
    if (url.includes('display-name-preview'))
      return onPreview(JSON.parse(String(init.body ?? '{}')));
    if (url.includes('/field-definitions'))
      return json([
        field('brand', 'Brand', 'Бренд'),
        field('model', 'Model', 'Модель'),
        field('owner_note', 'Owner note', 'Нотатка власника', { visibility: 'private' }),
        field('insured', 'Insured', 'Застраховано', { dataType: 'boolean' }),
      ]);
    return json([]);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** @param {string} key @param {string} en @param {string} uk @param {Record<string, unknown>} [overrides] */
function field(key, en, uk, overrides = {}) {
  return {
    id: `field-${key}`,
    key,
    labels: { en, uk },
    dataType: 'text',
    visibility: 'authenticated',
    defaultValue: null,
    ...overrides,
  };
}

/** @param {'en'|'uk'} locale @param {string} modelValue @param {string} [category] */
async function mountEditor(locale, modelValue = '', category = categoryId) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(DisplayTemplateEditor, {
    props: { modelValue, categoryId: category, csrfToken: 'c'.repeat(43) },
    global: {
      plugins: [
        createI18n({ legacy: false, locale, fallbackLocale: 'en', messages }),
        [VueQueryPlugin, { queryClient }],
        { install: installUi },
      ],
    },
  });
  await flushPromises();
  return wrapper;
}

/** @param {unknown} body @param {number} [status] */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
