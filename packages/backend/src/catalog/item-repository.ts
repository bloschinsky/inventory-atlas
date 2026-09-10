import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

type ItemClient = Pick<PrismaClient, 'item' | 'tag' | '$transaction'>;
export type ItemTransaction = Prisma.TransactionClient;

export const itemVisibilities = ['public', 'authenticated', 'private', 'unlisted'] as const;
export type ItemVisibility = (typeof itemVisibilities)[number];

export interface ItemCoreRecord {
  id: string;
  publicId: string;
  slug: string;
  categoryId: string;
  lifecycleStatusId: string;
  storageNodeId: string | null;
  displayName: string;
  description: string | null;
  visibility: ItemVisibility;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface CreateItemCoreInput {
  categoryId: string;
  lifecycleStatusId: string;
  storageNodeId?: string | null;
  displayName: string;
  description?: string | null;
  visibility?: ItemVisibility;
  slug?: string;
}

export function normalizeItemVisibility(value: string | undefined): ItemVisibility {
  const normalized = value ?? 'authenticated';
  if (!itemVisibilities.includes(normalized as ItemVisibility))
    throw new Error('Item visibility is invalid.');
  return normalized as ItemVisibility;
}

export function itemSlug(displayName: string, publicId: string): string {
  const slug = displayName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 160)
    .replace(/-$/u, '');
  return slug || `item-${publicId.replaceAll('-', '').slice(0, 12)}`;
}

export class ItemRepository {
  constructor(
    private readonly prisma: ItemClient,
    private readonly newId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  transaction<T>(work: (transaction: ItemTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  async createCore(
    transaction: ItemTransaction,
    input: CreateItemCoreInput,
  ): Promise<ItemCoreRecord> {
    const id = this.newId();
    const publicId = this.newId();
    const displayName = input.displayName.trim();
    if (!displayName) throw new Error('Item display name is required.');
    const now = this.now();
    const row = await transaction.item.create({
      data: {
        id,
        publicId,
        slug: itemSlug(input.slug?.trim() || displayName, publicId),
        categoryId: input.categoryId,
        lifecycleStatusId: input.lifecycleStatusId,
        storageNodeId: input.storageNodeId ?? null,
        displayName,
        description: input.description?.trim() || null,
        visibility: normalizeItemVisibility(input.visibility),
        createdAt: now,
        updatedAt: now,
      },
    });
    return toItemCoreRecord(row);
  }

  async findByPublicId(publicId: string): Promise<ItemCoreRecord | null> {
    const row = await this.prisma.item.findUnique({ where: { publicId } });
    return row ? toItemCoreRecord(row) : null;
  }

  async replaceTags(
    transaction: ItemTransaction,
    itemId: string,
    names: readonly string[],
  ): Promise<void> {
    const normalized = [
      ...new Map(names.map((name) => [normalizeTagName(name), name.trim()])).entries(),
    ];
    await transaction.itemTag.deleteMany({ where: { itemId } });
    for (const [nameNormalized, name] of normalized) {
      const tag = await transaction.tag.upsert({
        where: { nameNormalized },
        create: {
          id: this.newId(),
          name,
          nameNormalized,
          createdAt: this.now(),
          updatedAt: this.now(),
        },
        update: { name, archivedAt: null, updatedAt: this.now() },
      });
      await transaction.itemTag.create({ data: { itemId, tagId: tag.id, createdAt: this.now() } });
    }
  }
}

export function normalizeTagName(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
  if (!normalized) throw new Error('Tag name is required.');
  return normalized;
}

function toItemCoreRecord(row: {
  id: string;
  publicId: string;
  slug: string;
  categoryId: string;
  lifecycleStatusId: string;
  storageNodeId: string | null;
  displayName: string;
  description: string | null;
  visibility: string;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}): ItemCoreRecord {
  return {
    ...row,
    visibility: normalizeItemVisibility(row.visibility),
    version: Number(row.version),
  };
}
