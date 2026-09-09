import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import {
  TransactionalAuditPort,
  TransactionalOutboxPort,
  type AuditPort,
  type OutboxPort,
} from '../infrastructure/index.js';
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

type CatalogReadClient = Pick<Prisma.TransactionClient, 'category' | 'lifecycleStatus'>;
type CatalogClient = Pick<PrismaClient, 'category' | 'lifecycleStatus' | '$transaction'>;

export interface DictionaryMutationMetadata {
  actorId: string | null;
  correlationId?: string;
  requestId?: string;
}

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
    private readonly auditPort: AuditPort = new TransactionalAuditPort(),
    private readonly outboxPort: OutboxPort = new TransactionalOutboxPort(),
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

  async findCategoryById(id: string, includeArchived = true): Promise<CategoryRecord | null> {
    const row = await this.prisma.category.findUnique({ where: { id } });
    if (!row || (!includeArchived && row.archivedAt)) return null;
    return toCategoryRecord(row);
  }

  async createCategory(
    input: {
      key: string;
      labels: LocalizedLabel;
      parentId?: string | null;
      displayTemplate?: string | null;
      displayOrder: number;
    },
    metadata: DictionaryMutationMetadata = { actorId: null },
  ): Promise<CategoryRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const parentId = input.parentId ?? null;
      if (parentId) await this.requireWritableParent(transaction, parentId);
      const now = this.now();
      const row = await transaction.category.create({
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
      const record = toCategoryRecord(row);
      await this.audit(
        transaction,
        metadata,
        'catalog.category.created',
        'category',
        null,
        record,
        now,
      );
      return record;
    });
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
    metadata: DictionaryMutationMetadata = { actorId: null },
  ): Promise<CategoryRecord> {
    rejectKeyMutation(input);
    const version = validateExpectedVersion(expectedVersion);
    return this.prisma.$transaction(async (transaction) => {
      if (input.parentId !== undefined)
        await this.validateCategoryParent(transaction, id, input.parentId);
      const beforeRow = await transaction.category.findUnique({ where: { id } });
      const now = this.now();
      const data: Prisma.CategoryUncheckedUpdateManyInput = {
        updatedAt: now,
        version: { increment: 1 },
      };
      if (input.labels !== undefined) data.labelI18n = toJsonLabels(normalizeLabels(input.labels));
      if (input.parentId !== undefined) data.parentId = input.parentId;
      if (input.displayTemplate !== undefined)
        data.displayTemplate = normalizeDisplayTemplate(input.displayTemplate);
      if (input.displayOrder !== undefined)
        data.displayOrder = validateDisplayOrder(input.displayOrder);
      const [row] = await transaction.category.updateManyAndReturn({
        where: { id, version: BigInt(version), archivedAt: null },
        data,
      });
      if (!row) return this.throwMissingOrConflict(transaction, 'category', id, version);
      const before = beforeRow ? toCategoryRecord(beforeRow) : null;
      const after = toCategoryRecord(row);
      await this.audit(
        transaction,
        metadata,
        'catalog.category.updated',
        'category',
        before,
        after,
        now,
      );
      if (before && !sameLabels(before.labels, after.labels)) {
        await this.outboxPort.enqueue(
          { kind: 'prisma', trx: transaction },
          {
            topic: 'search.rebuild-items.v1',
            aggregateType: 'category',
            aggregateId: after.id,
            payload: {
              event: 'CategoryRenamed',
              payloadVersion: 1,
              categoryId: after.id,
              dictionaryVersion: after.version,
            },
            deduplicationKey: `category-renamed:${after.id}:v${after.version}`,
            createdAt: now,
          },
        );
      }
      return after;
    });
  }

  async archiveCategory(
    id: string,
    expectedVersion: number,
    metadata: DictionaryMutationMetadata = { actorId: null },
  ): Promise<CategoryRecord> {
    const version = validateExpectedVersion(expectedVersion);
    return this.prisma.$transaction(async (transaction) => {
      const beforeRow = await transaction.category.findUnique({ where: { id } });
      const now = this.now();
      const [row] = await transaction.category.updateManyAndReturn({
        where: { id, version: BigInt(version), archivedAt: null },
        data: { archivedAt: now, updatedAt: now, version: { increment: 1 } },
      });
      if (!row) return this.throwMissingOrConflict(transaction, 'category', id, version);
      const after = toCategoryRecord(row);
      await this.audit(
        transaction,
        metadata,
        'catalog.category.archived',
        'category',
        beforeRow ? toCategoryRecord(beforeRow) : null,
        after,
        now,
      );
      return after;
    });
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

  async findLifecycleStatusById(
    id: string,
    includeArchived = true,
  ): Promise<LifecycleStatusRecord | null> {
    const row = await this.prisma.lifecycleStatus.findUnique({ where: { id } });
    if (!row || (!includeArchived && row.archivedAt)) return null;
    return toLifecycleStatusRecord(row);
  }

  async createLifecycleStatus(
    input: {
      key: string;
      labels: LocalizedLabel;
      colorToken: string;
      displayOrder: number;
    },
    metadata: DictionaryMutationMetadata = { actorId: null },
  ): Promise<LifecycleStatusRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const now = this.now();
      const row = await transaction.lifecycleStatus.create({
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
      const record = toLifecycleStatusRecord(row);
      await this.audit(
        transaction,
        metadata,
        'catalog.lifecycle-status.created',
        'lifecycle_status',
        null,
        record,
        now,
      );
      return record;
    });
  }

  async updateLifecycleStatus(
    id: string,
    expectedVersion: number,
    input: { labels?: LocalizedLabel; colorToken?: string; displayOrder?: number },
    metadata: DictionaryMutationMetadata = { actorId: null },
  ): Promise<LifecycleStatusRecord> {
    rejectKeyMutation(input);
    const version = validateExpectedVersion(expectedVersion);
    return this.prisma.$transaction(async (transaction) => {
      const beforeRow = await transaction.lifecycleStatus.findUnique({ where: { id } });
      const now = this.now();
      const data: Prisma.LifecycleStatusUpdateManyMutationInput = {
        updatedAt: now,
        version: { increment: 1 },
      };
      if (input.labels !== undefined) data.labelI18n = toJsonLabels(normalizeLabels(input.labels));
      if (input.colorToken !== undefined) data.colorToken = validateColorToken(input.colorToken);
      if (input.displayOrder !== undefined)
        data.displayOrder = validateDisplayOrder(input.displayOrder);
      const [row] = await transaction.lifecycleStatus.updateManyAndReturn({
        where: { id, version: BigInt(version), archivedAt: null },
        data,
      });
      if (!row) return this.throwMissingOrConflict(transaction, 'lifecycleStatus', id, version);
      const after = toLifecycleStatusRecord(row);
      await this.audit(
        transaction,
        metadata,
        'catalog.lifecycle-status.updated',
        'lifecycle_status',
        beforeRow ? toLifecycleStatusRecord(beforeRow) : null,
        after,
        now,
      );
      return after;
    });
  }

  async archiveLifecycleStatus(
    id: string,
    expectedVersion: number,
    metadata: DictionaryMutationMetadata = { actorId: null },
  ): Promise<LifecycleStatusRecord> {
    const version = validateExpectedVersion(expectedVersion);
    return this.prisma.$transaction(async (transaction) => {
      const beforeRow = await transaction.lifecycleStatus.findUnique({ where: { id } });
      const now = this.now();
      const [row] = await transaction.lifecycleStatus.updateManyAndReturn({
        where: { id, version: BigInt(version), archivedAt: null },
        data: { archivedAt: now, updatedAt: now, version: { increment: 1 } },
      });
      if (!row) return this.throwMissingOrConflict(transaction, 'lifecycleStatus', id, version);
      const after = toLifecycleStatusRecord(row);
      await this.audit(
        transaction,
        metadata,
        'catalog.lifecycle-status.archived',
        'lifecycle_status',
        beforeRow ? toLifecycleStatusRecord(beforeRow) : null,
        after,
        now,
      );
      return after;
    });
  }

  private async validateCategoryParent(
    client: CatalogReadClient,
    id: string,
    parentId: string | null,
  ): Promise<void> {
    if (parentId === null) return;
    if (parentId === id) throw invalidParent();
    let cursor: string | null = parentId;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === id || visited.has(cursor)) throw invalidParent();
      visited.add(cursor);
      const parent: { parentId: string | null; archivedAt: Date | null } | null =
        await client.category.findUnique({
          where: { id: cursor },
          select: { parentId: true, archivedAt: true },
        });
      if (!parent || parent.archivedAt) throw invalidParent();
      cursor = parent.parentId;
    }
  }

  private async requireWritableParent(client: CatalogReadClient, parentId: string): Promise<void> {
    const parent = await client.category.findUnique({
      where: { id: parentId },
      select: { archivedAt: true },
    });
    if (!parent || parent.archivedAt) throw invalidParent();
  }

  private async throwMissingOrConflict(
    client: CatalogReadClient,
    kind: 'category' | 'lifecycleStatus',
    id: string,
    expectedVersion: number,
  ): Promise<never> {
    const row =
      kind === 'category'
        ? await client.category.findUnique({
            where: { id },
            select: { version: true, archivedAt: true },
          })
        : await client.lifecycleStatus.findUnique({
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

  private audit(
    transaction: Prisma.TransactionClient,
    metadata: DictionaryMutationMetadata,
    action: string,
    entityType: string,
    before: CategoryRecord | LifecycleStatusRecord | null,
    after: CategoryRecord | LifecycleStatusRecord,
    createdAt: Date,
  ): Promise<void> {
    return this.auditPort.record(
      { kind: 'prisma', trx: transaction },
      {
        actorId: metadata.actorId,
        action,
        entityType,
        entityId: after.id,
        ...(metadata.correlationId === undefined ? {} : { correlationId: metadata.correlationId }),
        ...(metadata.requestId === undefined ? {} : { requestId: metadata.requestId }),
        before: before ? dictionarySnapshot(before) : null,
        after: dictionarySnapshot(after),
        createdAt,
      },
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

function sameLabels(left: LocalizedLabel, right: LocalizedLabel): boolean {
  return left.en === right.en && left.uk === right.uk;
}

function dictionarySnapshot(
  record: CategoryRecord | LifecycleStatusRecord,
): Record<string, unknown> {
  const common = {
    key: record.key,
    labels: record.labels,
    displayOrder: record.displayOrder,
    version: record.version,
    archivedAt: record.archivedAt?.toISOString() ?? null,
  };
  return 'parentId' in record
    ? {
        ...common,
        parentId: record.parentId,
        displayTemplate: record.displayTemplate,
      }
    : { ...common, colorToken: record.colorToken };
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
