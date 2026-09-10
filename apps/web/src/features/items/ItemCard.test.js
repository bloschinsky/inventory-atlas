// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';
import { AppBreadcrumb } from '@inventory-atlas/ui';
import { messages } from '@inventory-atlas/i18n';
import ItemCard from './ItemCard.vue';

describe('ItemCard breadcrumb policy', () => {
  it('uses only the public-safe breadcrumb without private-path permission', async () => {
    const publicBreadcrumb = [{ label: 'Workshop' }];
    const privateBreadcrumb = [{ label: 'Workshop / Locked cabinet' }];
    const wrapper = mount(ItemCard, {
      props: {
        item: {
          publicId: '0198f40c-92f3-7a12-bc9a-653f97786004',
          displayName: 'Cordless drill',
          visibility: 'authenticated',
          attributes: {},
          tags: [],
        },
        category: { labels: { en: 'Tools', uk: 'Інструменти' } },
        lifecycleStatus: { labels: { en: 'Stored', uk: 'Зберігається' } },
        publicBreadcrumb,
        breadcrumb: privateBreadcrumb,
        canViewPrivatePath: false,
      },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })],
        stubs: { AppBreadcrumb: true },
      },
    });

    expect(wrapper.getComponent(AppBreadcrumb).props('items')).toEqual(publicBreadcrumb);
    await wrapper.setProps({ canViewPrivatePath: true });
    expect(wrapper.getComponent(AppBreadcrumb).props('items')).toEqual(privateBreadcrumb);
  });
});
