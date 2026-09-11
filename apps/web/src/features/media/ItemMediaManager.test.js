// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installUi } from '@inventory-atlas/ui';
import { messages } from '@inventory-atlas/i18n';
import ItemMediaManager from './ItemMediaManager.vue';

const itemPublicId = '0198f40c-92f3-7a12-bc9a-653f97786004';
const primaryId = '0198f40c-92f3-7a12-bc9a-653f97786101';
const galleryOneId = '0198f40c-92f3-7a12-bc9a-653f97786102';
const galleryTwoId = '0198f40c-92f3-7a12-bc9a-653f97786103';

afterEach(() => vi.unstubAllGlobals());

describe('MED-01C Item media manager', () => {
  it('renders the primary image, the gallery order and the processing state', async () => {
    stubApi(() => mediaList());
    const wrapper = await mountManager('en', true);

    const images = wrapper.findAll('img');
    expect(images).toHaveLength(3);
    expect(images[0].attributes('src')).toBe(`/api/v1/media/assets/${primaryId}/content`);
    expect(images[0].attributes('alt')).toBe('Front view');
    expect(wrapper.text()).toContain('Primary image: front.jpg');
    expect(wrapper.text()).toContain('Processing');
    expect(wrapper.text()).toContain('second.jpg');
  });

  it('sends the owner version when promoting, reordering and removing', async () => {
    const requests = stubApi(() => mediaList());
    const wrapper = await mountManager('en', true);

    await clickButton(wrapper, 'Make primary');
    await flushPromises();
    const promote = requests.find(({ url }) => url.includes('/primary'));
    if (!promote) throw new Error('Expected the primary request.');
    expect(promote.url).toContain(`/media/relations/${galleryOneId}/primary`);
    expect(new Headers(promote.init.headers).get('If-Match')).toBe('"7"');

    await clickButton(wrapper, 'Move second.jpg later');
    await flushPromises();
    const reorder = requests.find(({ init }) => init.method === 'PATCH');
    if (!reorder) throw new Error('Expected the reorder request.');
    expect(JSON.parse(String(reorder.init.body))).toEqual({
      itemPublicId,
      expectedVersion: 7,
      order: [galleryTwoId, galleryOneId],
    });

    await clickButton(wrapper, 'Remove front.jpg');
    await flushPromises();
    const detach = requests.find(({ init }) => init.method === 'DELETE');
    if (!detach) throw new Error('Expected the detach request.');
    expect(detach.url).toContain(`/media/relations/${primaryId}`);
    expect(new Headers(detach.init.headers).get('If-Match')).toBe('"7"');
  });

  it('reports a rejected upload with a localized message and no API prose', async () => {
    stubApi(
      () => mediaList(),
      () =>
        json(
          {
            code: 'VALIDATION_FAILED',
            detail: 'Only JPEG, PNG, WebP and HEIC images are accepted.',
            fieldErrors: [{ field: 'mimeType', messages: ['MEDIA_TYPE_UNSUPPORTED'] }],
          },
          400,
        ),
    );
    const wrapper = await mountManager('uk', true);

    wrapper.findComponent({ name: 'AppFileUpload' }).vm.$emit('select', {
      files: [new File(['x'], 'notes.gif', { type: 'image/gif' })],
    });
    await flushPromises();
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe(
      'Можна завантажувати лише зображення JPEG, PNG, WebP і HEIC.',
    );
    expect(wrapper.text()).not.toContain('Only JPEG, PNG, WebP and HEIC images are accepted.');
  });

  it('shows a Viewer the images without any management action', async () => {
    stubApi(() => mediaList());
    const wrapper = await mountManager('en', false);

    expect(wrapper.findAll('img')).toHaveLength(3);
    expect(wrapper.findAll('button')).toHaveLength(0);
    expect(wrapper.findComponent({ name: 'AppFileUpload' }).exists()).toBe(false);
  });

  it('explains that the category placeholder is used when nothing is attached', async () => {
    stubApi(() => json([]));
    const wrapper = await mountManager('en', true);

    expect(wrapper.text()).toContain('No images yet. The category placeholder is shown instead.');
    expect(wrapper.findAll('img')).toHaveLength(0);
  });
});

function mediaList() {
  return json([
    media(primaryId, 'primary', 0, 'front.jpg', 'Front view', 'pending'),
    media(galleryOneId, 'gallery', 0, 'second.jpg', null, 'ready'),
    media(galleryTwoId, 'gallery', 1, 'third.jpg', null, 'ready'),
  ]);
}

/**
 * @param {string} relationId @param {string} role @param {number} position
 * @param {string} originalFilename @param {string|null} altText @param {string} processingState
 */
function media(relationId, role, position, originalFilename, altText, processingState) {
  return {
    relationId,
    assetId: relationId,
    role,
    position,
    altText,
    visibility: 'authenticated',
    originalFilename,
    mimeType: 'image/jpeg',
    byteSize: 1_024,
    width: null,
    height: null,
    checksumSha256: 'a'.repeat(64),
    processingState,
    contentUrl: `/api/v1/media/assets/${relationId}/content`,
    variants:
      processingState === 'ready'
        ? [
            {
              name: 'thumb',
              mimeType: 'image/webp',
              byteSize: 512,
              width: 320,
              height: 240,
              contentUrl: `/api/v1/media/assets/${relationId}-thumb/content`,
            },
          ]
        : [],
    thumbnailUrl:
      processingState === 'ready' ? `/api/v1/media/assets/${relationId}-thumb/content` : null,
  };
}

/** @param {() => Response} onList @param {(() => Response)} [onBegin] */
function stubApi(onList, onBegin) {
  const requests = /** @type {{ url: string, init: RequestInit }[]} */ ([]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request, init = {}) => {
      const url = String(request);
      requests.push({ url, init });
      if (url.includes('/media/upload-sessions') && !url.includes('finalize'))
        return onBegin ? onBegin() : json({ sessionId: 'session-1' });
      if (url.includes('finalize'))
        return json(media(primaryId, 'gallery', 2, 'new.jpg', null, 'pending'));
      if (url.includes('/media/relations')) return json([]);
      return onList();
    }),
  );
  return requests;
}

/** @param {import('@vue/test-utils').VueWrapper} wrapper @param {string} label */
async function clickButton(wrapper, label) {
  const button = wrapper
    .findAll('button')
    .find(
      (candidate) => candidate.text() === label || candidate.attributes('aria-label') === label,
    );
  if (!button) throw new Error(`Expected a button labelled ${label}.`);
  await button.trigger('click');
}

/** @param {'en'|'uk'} locale @param {boolean} canEdit */
async function mountManager(locale, canEdit) {
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
  const wrapper = mount(ItemMediaManager, {
    props: { itemPublicId, expectedVersion: 7, csrfToken: 'c'.repeat(43), canEdit },
    global: {
      plugins: [
        createI18n({ legacy: false, locale, fallbackLocale: 'en', messages }),
        [VueQueryPlugin, { queryClient }],
        { install: installUi },
      ],
    },
  });
  await flushPromises();
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
