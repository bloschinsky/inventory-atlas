import type { MediaOwner, MediaOwnerPort } from '../media/media-service.js';
import type { ItemCoreRecord, ItemRepository } from './item-repository.js';

/**
 * Catalog's implementation of the Media module's owner port. Media never reads the `items` table
 * itself; it receives only the identity, version and visibility it needs for authorization and
 * optimistic concurrency.
 */
export class CatalogMediaOwnerAdapter implements MediaOwnerPort {
  constructor(private readonly items: ItemRepository) {}

  async resolveItem(publicId: string): Promise<MediaOwner | null> {
    return toMediaOwner(await this.items.findByPublicId(publicId));
  }

  async resolveItemById(id: string): Promise<MediaOwner | null> {
    return toMediaOwner(await this.items.findById(id));
  }
}

function toMediaOwner(item: ItemCoreRecord | null): MediaOwner | null {
  return item
    ? {
        id: item.id,
        publicId: item.publicId,
        version: item.version,
        visibility: item.visibility,
        archivedAt: item.archivedAt,
      }
    : null;
}
