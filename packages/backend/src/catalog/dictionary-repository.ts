import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import {
  DictionaryPolicyError,
  normalizeDisplayTemplate,
  normalizeLabels,
  rejectKeyMutation,
  validateColorToken,
  validateDisplayOrder,
  validateExpectedVersion,
  validateStableKey,
  type LocalizedLabel,
} from './dictionary-policy.js';

type CatalogClient = Pick<PrismaClient, 'category' | 'lifecycleStatus'>;

export interface CategoryRecord {
  id: string;
  parentId: string | null;
  key: string;
  labels: LocalizedLabel;
  displayTemplate: string | null;
  displayOrder: number;
  version: number;
  archivedAt: Date | null;
}

export interface LifecycleStatusRecord {
  id: string;
  key: string;
  labels: LocalizedLabel;
  colorToken: string;
  displayOrder: number;
  version: number;
  archivedAt: Date | null;
}

export class CatalogDictionaryRepository {
  constructor(
    private readonly prisma: CatalogClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listCategories(includeArchived = false): Promise<CategoryRecord[]> {
    const rows = await this.prisma.category.findMany({
      ...(includeArchived ? {} : { where: { archivedAt: null } }),
      orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }],
    });
    return rows.map(toCategoryRecord);
  }

  async findCategoryByKey(key: string, includeArchived = true): Promise<CategoryRecord | null> {
    const row = await this.prisma.category.findUnique({ where: { key: validateStableKey(key) } });
    if (!row || (!includeArchived && row.archivedAt)) return null;
    return toCategoryRecord(row);
  }

  async createCategory(input: {
    key: string;
    labels: LocalizedLabel;
    parentId?: string | null;
    displayTemplate?: string | null;
    displayOrder: number;
  }): Promise<CategoryRecord> {
    const parentId = input.parentId ?? null;
    if (parentId) await this.requireWritableParent(parentId);
    const now = this.now();
    const row = await this.prisma.category.create({
      data: {
        id: randomUUID(),
        key: validateStableKey(input.key),
        labelI18n: toJsonLabels(normalizeLabels(input.labels)),
        parentId,
        displayTemplate: normalizeDisplayTemplate(input.displayTemplate),
        displayOrder: validateDisplayOrder(input.displayOrder),
        createdAt: now,
        updatedAt: now,
      },
    });
    return toCategoryRecord(row);
  }

  async updateCategory(
    id: string,
    expectedVersion: number,
    input: {
      labels?: LocalizedLabel;
      parentId?: string | null;
      displayTemplate?: string | null;
      displayOrder?: number;
    },
  ): Promise<CategoryRecord> {
    rejectKeyMutation(input);
    const version = validateExpectedVersion(expectedVersion);
    if (input.parentId !== undefined) await this.validateCategoryParent(id, input.parentId);
    const data: Prisma.CategoryUncheckedUpdateManyInput = {
      updatedAt: this.now(),
      version: { increment: 1 },
    };
    if (input.labels !== undefined) data.labelI18n = toJsonLabels(normalizeLabels(input.labels));
    if (input.parentId !== undefined) data.parentId = input.parentId;
    if (input.displayTemplate !== undefined)
      data.displayTemplate = normalizeDisplayTemplate(input.displayTemplate);
    if (input.displayOrder !== undefined)
      data.displayOrder = validateDisplayOrder(input.displayOrder);
    const [row] = await this.prisma.category.updateManyAndReturn({
      where: { id, version: BigInt(version), archivedAt: null },
      data,
    });
    if (!row) return this.throwMissingOrConflict('category', id, version);
    return toCategoryRecord(row);
  }

  async archiveCategory(id: string, expectedVersion: number): Promise<CategoryRecord> {
    const version = validateExpectedVersion(expectedVersion);
    const now = this.now();
    const [row] = await this.prisma.category.updateManyAndReturn({
      where: { id, version: BigInt(version), archivedAt: null },
      data: { archivedAt: now, updatedAt: now, version: { increment: 1 } },
    });
    if (!row) return this.throwMissingOrConflict('category', id, version);
    return toCategoryRecord(row);
  }

  async listLifecycleStatuses(includeArchived = false): Promise<LifecycleStatusRecord[]> {
    const rows = await this.prisma.lifecycleStatus.findMany({
      ...(includeArchived ? {} : { where: { archivedAt: null } }),
      orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }],
    });
    return rows.map(toLifecycleStatusRecord);
  }

  async findLifecycleStatusByKey(
    key: string,
    includeArchived = true,
  ): Promise<LifecycleStatusRecord | null> {
    const row = await this.prisma.lifecycleStatus.findUnique({
      where: { key: validateStableKey(key) },
    });
    if (!row || (!includeArchived && row.archivedAt)) return null;
    return toLifecycleStatusRecord(row);
  }

  async createLifecycleStatus(input: {
    key: string;
    labels: LocalizedLabel;
    colorToken: string;
    displayOrder: number;
  }): Promise<LifecycleStatusRecord> {
    const now = this.now();
    const row = await this.prisma.lifecycleStatus.create({
      data: {
        id: randomUUID(),
        key: validateStableKey(input.key),
        labelI18n: toJsonLabels(normalizeLabels(input.labels)),
        colorToken: validateColorToken(input.colorToken),
        displayOrder: validateDisplayOrder(input.displayOrder),
        createdAt: now,
        updatedAt: now,
      },
    });
    return toLifecycleStatusRecord(row);
  }

  async updateLifecycleStatus(
    id: string,
    expectedVersion: number,
    input: { labels?: LocalizedLabel; colorToken?: string; displayOrder?: number },
  ): Promise<LifecycleStatusRecord> {
    rejectKeyMutation(input);
    const version = validateExpectedVersion(expectedVersion);
    const data: Prisma.LifecycleStatusUpdateManyMutationInput = {
      updatedAt: this.now(),
      version: { increment: 1 },
    };
    if (input.labels !== undefined) data.labelI18n = toJsonLabels(normalizeLabels(input.labels));
    if (input.colorToken !== undefined) data.colorToken = validateColorToken(input.colorToken);
    if (input.displayOrder !== undefined)
      data.displayOrder = validateDisplayOrder(input.displayOrder);
    const [row] = await this.prisma.lifecycleStatus.updateManyAndReturn({
      where: { id, version: BigInt(version), archivedAt: null },
      data,
    });
    if (!row) return this.throwMissingOrConflict('lifecycleStatus', id, version);
    return toLifecycleStatusRecord(row);
  }

  async archiveLifecycleStatus(
    id: string,
    expectedVersion: number,
  ): Promise<LifecycleStatusRecord> {
    const version = validateExpectedVersion(expectedVersion);
    const now = this.now();
    const [row] = await this.prisma.lifecycleStatus.updateManyAndReturn({
      where: { id, version: BigInt(version), archivedAt: null },
      data: { archivedAt: now, updatedAt: now, version: { increment: 1 } },
    });
    if (!row) return this.throwMissingOrConflict('lifecycleStatus', id, version);
    return toLifecycleStatusRecord(row);
  }

  private async validateCategoryParent(id: string, parentId: string | null): Promise<void> {
    if (parentId === null) return;
    if (parentId === id) throw invalidParent();
    let cursor: string | null = parentId;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === id || visited.has(cursor)) throw invalidParent();
      visited.add(cursor);
      const parent: { parentId: string | null; archivedAt: Date | null } | null =
        await this.prisma.category.findUnique({
          where: { id: cursor },
          select: { parentId: true, archivedAt: true },
        });
      if (!parent || parent.archivedAt) throw invalidParent();
      cursor = parent.parentId;
    }
  }

  private async requireWritableParent(parentId: string): Promise<void> {
    const parent = await this.prisma.category.findUnique({
      where: { id: parentId },
      select: { archivedAt: true },
    });
    if (!parent || parent.archivedAt) throw invalidParent();
  }

  private async throwMissingOrConflict(
    kind: 'category' | 'lifecycleStatus',
    id: string,
    expectedVersion: number,
  ): Promise<never> {
    const row =
      kind === 'category'
        ? await this.prisma.category.findUnique({
            where: { id },
            select: { version: true, archivedAt: true },
          })
        : await this.prisma.lifecycleStatus.findUnique({
            where: { id },
            select: { version: true, archivedAt: true },
          });
    if (!row || row.archivedAt) {
      throw new DictionaryPolicyError(
        'CATALOG_DICTIONARY_NOT_FOUND',
        'The dictionary entry was not found.',
      );
    }
    throw new DictionaryPolicyError(
      'CATALOG_DICTIONARY_VERSION_CONFLICT',
      `Expected version ${expectedVersion} but found ${row.version.toString()}.`,
    );
  }
}

function toJsonLabels(labels: LocalizedLabel): Prisma.InputJsonObject {
  return labels.uk === undefined ? { en: labels.en } : { en: labels.en, uk: labels.uk };
}

function invalidParent(): DictionaryPolicyError {
  return new DictionaryPolicyError(
    'CATALOG_CATEGORY_PARENT_INVALID',
    'Category parent must be an active category outside its own subtree.',
  );
}

function toCategoryRecord(row: {
  id: string;
  parentId: string | null;
  key: string;
  labelI18n: unknown;
  displayTemplate: string | null;
  displayOrder: number;
  version: bigint;
  archivedAt: Date | null;
}): CategoryRecord {
  return {
    id: row.id,
    parentId: row.parentId,
    key: row.key,
    labels: normalizeLabels(row.labelI18n),
    displayTemplate: row.displayTemplate,
    displayOrder: row.displayOrder,
    version: Number(row.version),
    archivedAt: row.archivedAt,
  };
}

function toLifecycleStatusRecord(row: {
  id: string;
  key: string;
  labelI18n: unknown;
  colorToken: string;
  displayOrder: number;
  version: bigint;
  archivedAt: Date | null;
}): LifecycleStatusRecord {
  return {
    id: row.id,
    key: row.key,
    labels: normalizeLabels(row.labelI18n),
    colorToken: row.colorToken,
    displayOrder: row.displayOrder,
    version: Number(row.version),
    archivedAt: row.archivedAt,
  };
}
