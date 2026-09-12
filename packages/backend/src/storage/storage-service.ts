import { can, type SessionActor } from '../auth/index.js';
import type { AuditPort, OutboxPort } from '../infrastructure/index.js';
import type { StorageProjectionPort } from '../infrastructure/transaction-ports.js';
import type {
  AttributeValueAssignment,
  AttributeValuePort,
} from '../schema/attribute-value-port.js';
import {
  canonicalizeFieldValues,
  projectFieldValues,
  type FieldValueShape,
} from '../schema/field-policy.js';
import type {
  FieldDefinitionRecord,
  FieldDefinitionRepository,
} from '../schema/field-definition-repository.js';
import {
  StoragePolicyError,
  StorageRepository,
  type StorageBreadcrumb,
  type StorageContentRow,
  type StorageNodeRecord,
  type StorageNodeType,
  type StoragePage,
  type StorageVisibility,
} from './storage-repository.js';

export interface CreateStorageNodeInput {
  parentPublicId?: string | null;
  nodeType: StorageNodeType;
  title: string;
  code?: string | null;
  visibility?: StorageVisibility;
  attributes?: Readonly<Record<string, unknown>>;
}

export interface UpdateStorageNodeInput {
  nodeType?: StorageNodeType;
  title?: string;
  code?: string | null;
  visibility?: StorageVisibility;
  archived?: boolean;
  attributes?: Readonly<Record<string, unknown>>;
}

export interface StorageNodeSummary {
  publicId: string;
  parentPublicId: string | null;
  nodeType: StorageNodeType;
  title: string;
  code: string | null;
  visibility: StorageVisibility;
  depth: number;
  version: number;
}

export interface StorageNodeDetail extends StorageNodeSummary {
  breadcrumb: StorageBreadcrumb[];
  contents: StoragePage<StorageContentRow>;
  attributes: Record<string, unknown>;
  updatedAt: string;
}

export class StorageAccessError extends Error {
  constructor(
    readonly code: 'STORAGE_FORBIDDEN' | 'STORAGE_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'StorageAccessError';
  }
}

interface StoragePorts {
  attributes: AttributeValuePort;
  audit: AuditPort;
  outbox: OutboxPort;
  search: StorageProjectionPort;
}

export class StorageService {
  constructor(
    private readonly nodes: StorageRepository,
    private readonly fields: Pick<FieldDefinitionRepository, 'listDefinitions'>,
    private readonly ports: StoragePorts,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(
    actor: SessionActor,
    input: CreateStorageNodeInput,
    metadata: { correlationId?: string; requestId?: string } = {},
  ): Promise<StorageNodeSummary> {
    this.requireEditor(actor);
    const definitions = await this.fields.listDefinitions({
      scope: 'storage_node',
      categoryId: null,
    });
    const assignments = assignmentsFor(definitions, input.attributes ?? {}, actor);
    return this.nodes.transaction(async (transaction) => {
      const createdAt = this.now();
      const node = await this.nodes.createCore(
        transaction,
        input,
        can(actor.role, 'viewPrivateFields'),
      );
      const context = { kind: 'kysely' as const, trx: transaction };
      await this.ports.attributes.replace(context, {
        owner: { kind: 'storageNode', id: node.id },
        categoryId: null,
        assignments,
        now: createdAt,
      });
      await this.ports.audit.record(context, {
        actorId: actor.id,
        action: 'storage_node.created',
        entityType: 'storage_node',
        entityId: node.id,
        ...metadata,
        before: null,
        after: safeAudit(node, definitions, assignments),
        createdAt,
      });
      await this.ports.outbox.enqueue(context, {
        topic: 'storage.node-created.v1',
        aggregateType: 'storage_node',
        aggregateId: node.id,
        payload: { publicId: node.publicId, version: node.version, event: 'NodeCreated' },
        deduplicationKey: `storage-node-created:${node.id}:${node.version}`,
        createdAt,
      });
      return summary(node, input.parentPublicId ?? null);
    });
  }

  async update(
    actor: SessionActor,
    publicId: string,
    expectedVersion: number,
    input: UpdateStorageNodeInput,
    metadata: { correlationId?: string; requestId?: string } = {},
  ): Promise<StorageNodeSummary> {
    this.requireEditor(actor);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new StoragePolicyError(
        'STORAGE_VERSION_CONFLICT',
        'expectedVersion',
        'Expected version must be positive.',
      );
    const definitions = await this.fields.listDefinitions({
      scope: 'storage_node',
      categoryId: null,
    });
    const assignments =
      input.attributes === undefined ? null : assignmentsFor(definitions, input.attributes, actor);
    return this.nodes.transaction(async (transaction) => {
      const changedAt = this.now();
      const result = await this.nodes.updateCore(
        transaction,
        publicId,
        expectedVersion,
        input,
        can(actor.role, 'viewPrivateFields'),
      );
      const context = { kind: 'kysely' as const, trx: transaction };
      if (assignments)
        await this.ports.attributes.replace(context, {
          owner: { kind: 'storageNode', id: result.after.id },
          categoryId: null,
          assignments,
          now: changedAt,
        });
      if (
        result.before.title !== result.after.title ||
        result.before.visibility !== result.after.visibility ||
        Boolean(result.after.archivedAt)
      )
        await this.ports.search.syncStorageSubtree(context, result.after.id, changedAt);
      await this.ports.audit.record(context, {
        actorId: actor.id,
        action: result.after.archivedAt ? 'storage_node.archived' : 'storage_node.updated',
        entityType: 'storage_node',
        entityId: result.after.id,
        ...metadata,
        before: safeAudit(result.before, definitions, []),
        after: safeAudit(result.after, definitions, assignments ?? []),
        createdAt: changedAt,
      });
      const events = [
        ...(result.before.title !== result.after.title ? ['NodeRenamed'] : []),
        ...(result.before.visibility !== result.after.visibility ? ['NodeVisibilityChanged'] : []),
      ];
      await this.ports.outbox.enqueue(context, {
        topic: 'storage.node-changed.v1',
        aggregateType: 'storage_node',
        aggregateId: result.after.id,
        payload: { publicId, version: result.after.version, events },
        deduplicationKey: `storage-node-changed:${result.after.id}:${result.after.version}`,
        createdAt: changedAt,
      });
      const parent = result.after.parentId
        ? await this.nodes.findById(result.after.parentId, transaction)
        : null;
      return summary(result.after, parent?.publicId ?? null);
    });
  }

  async list(
    actor: SessionActor,
    query: { parentPublicId?: string | null; limit?: number; cursor?: string | null },
  ): Promise<StoragePage<StorageNodeSummary>> {
    this.requireReader(actor);
    const page = await this.nodes.list(
      query.parentPublicId ?? null,
      query.limit ?? 25,
      query.cursor ?? null,
      can(actor.role, 'viewPrivateFields'),
    );
    return {
      entries: page.entries.map((node) => summary(node, query.parentPublicId ?? null)),
      nextCursor: page.nextCursor,
    };
  }

  async get(
    actor: SessionActor,
    publicId: string,
    query: { limit?: number; cursor?: string | null } = {},
  ): Promise<StorageNodeDetail> {
    this.requireReader(actor);
    const privileged = can(actor.role, 'viewPrivateFields');
    const node = await this.nodes.findAccessibleByPublicId(publicId, privileged);
    if (!node) throw new StorageAccessError('STORAGE_NOT_FOUND', 'StorageNode was not found.');
    const definitions = await this.fields.listDefinitions({
      scope: 'storage_node',
      categoryId: null,
    });
    const assignments = await this.nodes.transaction((transaction) =>
      this.ports.attributes.read(
        { kind: 'kysely', trx: transaction },
        { kind: 'storageNode', id: node.id },
      ),
    );
    const parent = node.parentId ? await this.nodes.findById(node.parentId) : null;
    const [breadcrumb, contents] = await Promise.all([
      this.nodes.breadcrumb(node, privileged),
      this.nodes.contents(node, query.limit ?? 25, query.cursor ?? null, privileged),
    ]);
    return {
      ...summary(node, parent?.publicId ?? null),
      breadcrumb,
      contents,
      attributes: visibleAttributes(definitions, assignments, privileged),
      updatedAt: node.updatedAt.toISOString(),
    };
  }

  private requireReader(actor: SessionActor): void {
    if (!can(actor.role, 'viewPublicCards'))
      throw new StorageAccessError('STORAGE_NOT_FOUND', 'StorageNode was not found.');
  }

  private requireEditor(actor: SessionActor): void {
    if (!can(actor.role, 'editItems'))
      throw new StorageAccessError('STORAGE_FORBIDDEN', 'The actor cannot edit StorageNodes.');
  }
}

function assignmentsFor(
  definitions: readonly FieldDefinitionRecord[],
  submitted: Readonly<Record<string, unknown>>,
  actor: SessionActor,
): AttributeValueAssignment[] {
  const privileged = can(actor.role, 'viewPrivateFields');
  return definitions
    .filter((definition) => definition.visibility !== 'private' || privileged)
    .filter((definition) => submitted[definition.key] !== undefined)
    .map((definition) => ({
      fieldDefinitionId: definition.id,
      values: canonicalizeFieldValues(shapeOf(definition), submitted[definition.key]),
    }));
}

function visibleAttributes(
  definitions: readonly FieldDefinitionRecord[],
  assignments: readonly AttributeValueAssignment[],
  privileged: boolean,
): Record<string, unknown> {
  const byId = new Map(assignments.map((assignment) => [assignment.fieldDefinitionId, assignment]));
  return Object.fromEntries(
    definitions
      .filter((definition) => definition.visibility !== 'private' || privileged)
      .flatMap((definition) => {
        const assignment = byId.get(definition.id);
        return assignment?.values.length
          ? [[definition.key, projectFieldValues(shapeOf(definition), assignment.values)]]
          : [];
      }),
  );
}

function shapeOf(definition: FieldDefinitionRecord): FieldValueShape {
  return {
    key: definition.key,
    dataType: definition.dataType,
    required: definition.required,
    repeatable: definition.repeatable,
    validation: definition.validation,
  };
}

function summary(node: StorageNodeRecord, parentPublicId: string | null): StorageNodeSummary {
  return {
    publicId: node.publicId,
    parentPublicId,
    nodeType: node.nodeType,
    title: node.title,
    code: node.code,
    visibility: node.visibility,
    depth: node.depth,
    version: node.version,
  };
}

function safeAudit(
  node: StorageNodeRecord,
  definitions: readonly FieldDefinitionRecord[],
  assignments: readonly AttributeValueAssignment[],
): Record<string, unknown> {
  const supplied = new Set(assignments.map((assignment) => assignment.fieldDefinitionId));
  return {
    publicId: node.publicId,
    parentId: node.parentId,
    nodeType: node.nodeType,
    title: node.title,
    code: node.code,
    visibility: node.visibility,
    version: node.version,
    attributeKeys: definitions
      .filter((definition) => supplied.has(definition.id))
      .filter((definition) => definition.visibility !== 'private')
      .map((definition) => definition.key),
  };
}
