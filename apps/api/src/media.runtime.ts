import type { MediaService } from '@inventory-atlas/backend';

export const MEDIA_RUNTIME = Symbol('MEDIA_RUNTIME');

export interface MediaRuntimePort {
  media(): Pick<
    MediaService,
    | 'beginUpload'
    | 'receiveContent'
    | 'finalizeUpload'
    | 'listItemMedia'
    | 'reorderGallery'
    | 'setPrimary'
    | 'detachRelation'
    | 'openAssetContent'
  >;
}
