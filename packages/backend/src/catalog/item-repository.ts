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

export interface UpdateItemCoreInput {
  categoryId?: string;
  lifecycleStatusId?: string;
  displayName?: string;
  description?: string | null;
  visibility?: ItemVisibility;
  storageNodeId?: string | null;
}

export type ItemPolicyCode =
  | 'ITEM_DISPLAY_NAME_REQUIRED'
  | 'ITEM_CATEGORY_INVALID'
  | 'ITEM_LIFECYCLE_STATUS_INVALID'
  | 'ITEM_STORAGE_DESTINATION_UNAVAILABLE'
  | 'ITEM_VISIBILITY_INVALID'
  | 'ITEM_EXPECTED_VERSION_INVALID';

export class ItemPolicyError extends Error {
  constructor(
    readonly code: ItemPolicyCode,
    readonly fieldKey: string,
    message: string,
  ) {
    super(message);
    this.name = 'ItemPolicyError';
  }
}

export function normalizeItemVisibility(value: string | undefined): ItemVisibility {
  const normalized = value ?? 'authenticated';
  if (!itemVisibilities.includes(normalized as ItemVisibility))
    throw new ItemPolicyError(
      'ITEM_VISIBILITY_INVALID',
      'visibility',
      'Item visibility is invalid.',
    );
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
    if (!displayName)
      throw new ItemPolicyError(
        'ITEM_DISPLAY_NAME_REQUIRED',
        'displayName',
        'Item display name is required.',
      );
    const [category, lifecycleStatus] = await Promise.all([
      transaction.category.findFirst({ where: { id: input.categoryId, archivedAt: null } }),
      transaction.lifecycleStatus.findFirst({
        where: { id: input.lifecycleStatusId, archivedAt: null },
      }),
    ]);
    if (!category)
      throw new ItemPolicyError('ITEM_CATEGORY_INVALID', 'categoryId', 'Category is not active.');
    if (!lifecycleStatus)
      throw new ItemPolicyError(
        'ITEM_LIFECYCLE_STATUS_INVALID',
        'lifecycleStatusId',
        'Lifecycle status is not active.',
      );
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

  async findByPublicId(
    publicId: string,
    transaction?: ItemTransaction,
  ): Promise<ItemCoreRecord | null> {
    const row = transaction
      ? await transaction.item.findUnique({ where: { publicId } })
      : await this.prisma.item.findUnique({ where: { publicId } });
    return row ? toItemCoreRecord(row) : null;
  }

  async findById(id: string, transaction?: ItemTransaction): Promise<ItemCoreRecord | null> {
    const row = transaction
      ? await transaction.item.findUnique({ where: { id } })
      : await this.prisma.item.findUnique({ where: { id } });
    return row ? toItemCoreRecord(row) : null;
  }

  /**
   * Compare-and-swap on the aggregate version. The row is rewritten only when the caller's
   * expected version still matches, so a concurrent editor can never be overwritten silently.
   * A stale expected version, a missing Item, or an archived Item all return `null`; the caller
   * re-reads the current row to build the conflict payload.
   */
  async updateCore(
    transaction: ItemTransaction,
    id: string,
    expectedVersion: number,
    input: UpdateItemCoreInput,
    updatedAt: Date,
  ): Promise<ItemCoreRecord | null> {
    const data: Prisma.ItemUncheckedUpdateManyInput = {
      updatedAt,
      version: { increment: 1 },
    };
    if (input.categoryId !== undefined) data.categoryId = input.categoryId;
    if (input.lifecycleStatusId !== undefined) data.lifecycleStatusId = input.lifecycleStatusId;
    if (input.displayName !== undefined) {
      const displayName = input.displayName.trim();
      if (!displayName)
        throw new ItemPolicyError(
          'ITEM_DISPLAY_NAME_REQUIRED',
          'displayName',
          'Item display name is required.',
        );
      data.displayName = displayName;
    }
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    if (input.visibility !== undefined) data.visibility = normalizeItemVisibility(input.visibility);
    if (input.storageNodeId !== undefined) data.storageNodeId = input.storageNodeId;
    if (data.categoryId !== undefined || data.lifecycleStatusId !== undefined)
      await this.requireActiveDictionaries(transaction, input);
    const [row] = await transaction.item.updateManyAndReturn({
      where: { id, version: BigInt(expectedVersion), archivedAt: null },
      data,
    });
    return row ? toItemCoreRecord(row) : null;
  }

  async listTagNames(transaction: ItemTransaction, itemId: string): Promise<string[]> {
    const rows = await transaction.itemTag.findMany({
      where: { itemId },
      include: { tag: true },
      orderBy: { tag: { nameNormalized: 'asc' } },
    });
    return rows.map((row) => row.tag.name);
  }

  private async requireActiveDictionaries(
    transaction: ItemTransaction,
    input: UpdateItemCoreInput,
  ): Promise<void> {
    if (input.categoryId !== undefined) {
      const category = await transaction.category.findFirst({
        where: { id: input.categoryId, archivedAt: null },
      });
      if (!category)
        throw new ItemPolicyError('ITEM_CATEGORY_INVALID', 'categoryId', 'Category is not active.');
    }
    if (input.lifecycleStatusId !== undefined) {
      const lifecycleStatus = await transaction.lifecycleStatus.findFirst({
        where: { id: input.lifecycleStatusId, archivedAt: null },
      });
      if (!lifecycleStatus)
        throw new ItemPolicyError(
          'ITEM_LIFECYCLE_STATUS_INVALID',
          'lifecycleStatusId',
          'Lifecycle status is not active.',
        );
    }
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
