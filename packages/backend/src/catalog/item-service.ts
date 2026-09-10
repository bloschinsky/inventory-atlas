import { can, type SessionActor } from '../auth/index.js';
import type {
  AuditPort,
  IdempotencyPort,
  MovementHistoryPort,
  OutboxPort,
  SearchProjectionPort,
} from '../infrastructure/index.js';
import {
  requestFingerprint,
  type IdempotencyReservation,
  type IdempotencyReservationPort,
} from '../infrastructure/idempotency-repository.js';
import type {
  AttributeValueAssignment,
  AttributeValuePort,
} from '../schema/attribute-value-port.js';
import type { CanonicalFieldValue } from '../schema/field-policy.js';
import {
  parseDisplayTemplate,
  renderDisplayName,
  toDisplayTokenField,
} from '../schema/display-template.js';
import type { CatalogDictionaryRepository } from './dictionary-repository.js';
import {
  AttributeValidationError,
  canonicalizeFieldValues,
  projectFieldValues,
  type FieldValueShape,
} from '../schema/field-policy.js';
import type {
  FieldDefinitionRecord,
  FieldDefinitionRepository,
} from '../schema/field-definition-repository.js';
import {
  ItemPolicyError,
  ItemRepository,
  normalizeItemVisibility,
  type ItemCoreRecord,
  type ItemTransaction,
  type ItemVisibility,
  type UpdateItemCoreInput,
} from './item-repository.js';
import {
  creationInvalidation,
  planItemInvalidation,
  type ItemInvalidatorEvent,
} from './item-invalidation.js';

export interface CreateItemInput {
  categoryId: string;
  lifecycleStatusId: string;
  displayName: string;
  description?: string | null;
  visibility?: ItemVisibility;
  storageNodeId?: string | null;
  tags?: readonly string[];
  attributes?: Readonly<Record<string, unknown>>;
}

export interface UpdateItemInput {
  categoryId?: string;
  lifecycleStatusId?: string;
  displayName?: string;
  description?: string | null;
  visibility?: ItemVisibility;
  storageNodeId?: string | null;
  tags?: readonly string[];
  attributes?: Readonly<Record<string, unknown>>;
}

export interface ItemMutationMetadata {
  idempotencyKey: string;
  correlationId?: string;
  requestId?: string;
}

export interface CreatedItem {
  publicId: string;
  slug: string;
  displayName: string;
  version: number;
}

/** An Item update is idempotent only when the caller supplies a key. */
export interface ItemUpdateMetadata {
  idempotencyKey?: string;
  correlationId?: string;
  requestId?: string;
}

export type CreateItemOutcome =
  | { replayed: false; status: 201; item: CreatedItem }
  | { replayed: true; status: number; item: CreatedItem };

export type UpdatedItem = CreatedItem;

export interface UpdateItemOutcome {
  replayed: boolean;
  status: number;
  item: UpdatedItem;
  /** Registry events the mutation fired; empty when nothing projection-relevant changed. */
  invalidators: readonly ItemInvalidatorEvent[];
}

/** Visibility-aware Item card projection used by the edit workflow. */
export interface ItemDetail {
  publicId: string;
  slug: string;
  displayName: string;
  description: string | null;
  categoryId: string;
  lifecycleStatusId: string;
  storageNodeId: string | null;
  visibility: ItemVisibility;
  version: number;
  tags: string[];
  attributes: Record<string, unknown>;
  updatedAt: string;
}

export type ItemCreateErrorCode =
  | 'ITEM_CREATE_FORBIDDEN'
  | 'ITEM_IDEMPOTENCY_CONFLICT'
  | 'ITEM_IDEMPOTENCY_IN_PROGRESS'
  | 'ITEM_IDEMPOTENCY_KEY_INVALID';

export class ItemCreateError extends Error {
  constructor(
    readonly code: ItemCreateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ItemCreateError';
  }
}

export type ItemAccessErrorCode = 'ITEM_UPDATE_FORBIDDEN' | 'ITEM_NOT_FOUND';

export class ItemAccessError extends Error {
  constructor(
    readonly code: ItemAccessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ItemAccessError';
  }
}

/** One visibility-safe field difference between the stored Item and the rejected submission. */
export interface SafeDiffEntry {
  current: unknown;
  submitted: unknown;
}

/**
 * Optimistic-concurrency rejection. The payload carries the current aggregate version and a diff
 * built only from fields the rejected actor is allowed to see, so a conflict never discloses a
 * private value and never overwrites the concurrent edit.
 */
export class ItemVersionConflictError extends Error {
  readonly code = 'ITEM_VERSION_CONFLICT';

  constructor(
    readonly currentVersion: number,
    readonly safeDiff: Readonly<Record<string, SafeDiffEntry>>,
  ) {
    super('The Item changed since the submitted version.');
    this.name = 'ItemVersionConflictError';
  }
}

interface ItemServicePorts {
  attributes: AttributeValuePort;
  audit: AuditPort;
  idempotency: IdempotencyPort;
  movements: MovementHistoryPort;
  outbox: OutboxPort;
  search: SearchProjectionPort;
}

export class ItemService {
  constructor(
    private readonly items: ItemRepository,
    private readonly idempotencyRecords: IdempotencyReservationPort,
    private readonly fields: Pick<FieldDefinitionRepository, 'listDefinitions'>,
    private readonly ports: ItemServicePorts,
    private readonly dictionaries: Pick<
      CatalogDictionaryRepository,
      'findCategoryById' | 'findLifecycleStatusById'
    >,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(
    actor: SessionActor,
    input: CreateItemInput,
    metadata: ItemMutationMetadata,
  ): Promise<CreateItemOutcome> {
    if (!can(actor.role, 'editItems'))
      throw new ItemCreateError('ITEM_CREATE_FORBIDDEN', 'The actor cannot create Items.');
    const idempotencyKey = metadata.idempotencyKey.trim();
    if (!idempotencyKey || idempotencyKey.length > 200)
      throw new ItemCreateError(
        'ITEM_IDEMPOTENCY_KEY_INVALID',
        'Idempotency-Key must contain between 1 and 200 characters.',
      );
    const normalized = normalizeInput(input);
    const fingerprint = requestFingerprint(normalized);
    const reservation = await this.idempotencyRecords.reserve({
      actorId: actor.id,
      scope: 'catalog.items.create',
      key: idempotencyKey,
      fingerprint,
    });
    if (reservation.kind === 'conflict')
      throw new ItemCreateError(
        'ITEM_IDEMPOTENCY_CONFLICT',
        'The idempotency key was already used for a different request.',
      );
    if (reservation.kind === 'in_progress')
      throw new ItemCreateError(
        'ITEM_IDEMPOTENCY_IN_PROGRESS',
        'The matching request is still being processed.',
      );
    if (reservation.kind === 'completed') {
      const item = replayedItem(reservation.responseBody);
      return { replayed: true, status: reservation.responseStatus, item };
    }

    let item: CreatedItem;
    try {
      const definitions = await this.fields.listDefinitions({
        scope: 'item',
        categoryId: normalized.categoryId,
      });
      const assignments = assignmentsFor(definitions, normalized.attributes);
      item = await this.items.transaction(async (transaction) => {
        const createdAt = this.now();
        const displayName = await this.deriveDisplayName(transaction, {
          categoryId: normalized.categoryId,
          lifecycleStatusId: normalized.lifecycleStatusId,
          definitions,
          assignments,
          fallback: normalized.displayName,
        });
        const created = await this.items.createCore(transaction, { ...normalized, displayName });
        const context = { kind: 'prisma' as const, trx: transaction };
        await this.items.replaceTags(transaction, created.id, normalized.tags);
        await this.ports.attributes.replace(context, {
          owner: { kind: 'item', id: created.id },
          categoryId: created.categoryId,
          assignments,
          now: createdAt,
        });
        const projected = projectionFor(definitions, assignments);
        const discoverable =
          created.visibility === 'public' || created.visibility === 'authenticated';
        const publiclyDiscoverable = created.visibility === 'public';
        await this.ports.search.writeSync(context, {
          itemId: created.id,
          displayName: created.displayName,
          description: created.description,
          categoryId: created.categoryId,
          lifecycleStatusId: created.lifecycleStatusId,
          storageNodeId: created.storageNodeId,
          searchableText: discoverable
            ? searchText(created.displayName, created.description, projected.searchable)
            : '',
          publicSearchableText: publiclyDiscoverable
            ? searchText(created.displayName, created.description, projected.publicSearchable)
            : '',
          attrs: discoverable ? projected.attrs : {},
          publicAttrs: publiclyDiscoverable ? projected.publicAttrs : {},
          visibility: created.visibility,
          itemUpdatedAt: created.updatedAt,
          indexedAt: createdAt,
        });
        await this.ports.audit.record(context, {
          actorId: actor.id,
          action: 'item.created',
          entityType: 'item',
          entityId: created.id,
          ...(metadata.correlationId ? { correlationId: metadata.correlationId } : {}),
          ...(metadata.requestId ? { requestId: metadata.requestId } : {}),
          before: null,
          after: {
            publicId: created.publicId,
            categoryId: created.categoryId,
            lifecycleStatusId: created.lifecycleStatusId,
            visibility: created.visibility,
            version: created.version,
            attributeKeys: definitions
              .filter((definition) => normalized.attributes[definition.key] !== undefined)
              .map((definition) => definition.key),
          },
          createdAt,
        });
        if (created.storageNodeId !== null) {
          await this.ports.movements.append(context, {
            entityType: 'item',
            itemId: created.id,
            storageNodeId: null,
            fromNodeId: null,
            toNodeId: created.storageNodeId,
            fromPathSnapshot: null,
            toPathSnapshot: null,
            actorUserId: actor.id,
            occurredAt: createdAt,
            correlationId: metadata.correlationId ?? metadata.requestId ?? created.publicId,
          });
        }
        await this.ports.outbox.enqueue(context, {
          topic: 'catalog.item-created.v1',
          aggregateType: 'item',
          aggregateId: created.id,
          payload: {
            publicId: created.publicId,
            version: created.version,
            invalidators: [...creationInvalidation().events],
          },
          deduplicationKey: `item-created:${created.id}:${created.version}`,
          createdAt,
        });
        const response = responseFor(created);
        await this.ports.idempotency.complete(context, {
          recordId: reservation.recordId,
          reservationTokenHash: reservation.reservationTokenHash,
          responseStatus: 201,
          responseBody: { ...response },
          completedAt: createdAt,
        });
        return response;
      });
    } catch (error) {
      await this.idempotencyRecords.fail(
        reservation.recordId,
        reservation.reservationTokenHash,
        this.now(),
      );
      throw error;
    }
    return { replayed: false, status: 201, item };
  }

  /**
   * Visibility-aware Item card. Private Items and private attribute values are withheld from an
   * actor without `viewPrivateFields`; a withheld Item is reported as missing so its existence
   * does not leak.
   */
  async get(actor: SessionActor, publicId: string): Promise<ItemDetail> {
    if (!can(actor.role, 'viewPublicCards'))
      throw new ItemAccessError('ITEM_NOT_FOUND', 'The Item does not exist.');
    const item = await this.items.findByPublicId(publicId);
    const privileged = can(actor.role, 'viewPrivateFields');
    if (!item || item.archivedAt || (item.visibility === 'private' && !privileged))
      throw new ItemAccessError('ITEM_NOT_FOUND', 'The Item does not exist.');
    const definitions = await this.fields.listDefinitions({
      scope: 'item',
      categoryId: item.categoryId,
    });
    const { tags, assignments } = await this.items.transaction(async (transaction) => ({
      tags: await this.items.listTagNames(transaction, item.id),
      assignments: await this.ports.attributes.read(
        { kind: 'prisma', trx: transaction },
        { kind: 'item', id: item.id },
      ),
    }));
    return {
      publicId: item.publicId,
      slug: item.slug,
      displayName: item.displayName,
      description: item.description,
      categoryId: item.categoryId,
      lifecycleStatusId: item.lifecycleStatusId,
      storageNodeId: item.storageNodeId,
      visibility: item.visibility,
      version: item.version,
      tags,
      attributes: visibleAttributes(definitions, assignments, privileged),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  /**
   * Versioned aggregate update (blueprint section 9.1). The expected version is enforced by a
   * compare-and-swap on `items.version`, so the source row, typed values, projection, audit,
   * movement, outbox, and idempotency completion share exactly one Prisma transaction and a
   * concurrent edit is rejected with a safe conflict instead of being overwritten.
   */
  async update(
    actor: SessionActor,
    publicId: string,
    expectedVersion: number,
    input: UpdateItemInput,
    metadata: ItemUpdateMetadata = {},
  ): Promise<UpdateItemOutcome> {
    if (!can(actor.role, 'editItems'))
      throw new ItemAccessError('ITEM_UPDATE_FORBIDDEN', 'The actor cannot edit Items.');
    const version = requireExpectedVersion(expectedVersion);
    const normalized = normalizeUpdateInput(input);
    const privileged = can(actor.role, 'viewPrivateFields');
    const reservation = await this.reserveUpdate(actor, publicId, version, normalized, metadata);
    if (reservation?.kind === 'completed')
      return {
        replayed: true,
        status: reservation.responseStatus,
        item: replayedItem(reservation.responseBody),
        invalidators: [],
      };

    try {
      return await this.items.transaction(async (transaction) => {
        const context = { kind: 'prisma' as const, trx: transaction };
        const updatedAt = this.now();
        const current = await this.items.findByPublicId(publicId, transaction);
        if (!current || current.archivedAt)
          throw new ItemAccessError('ITEM_NOT_FOUND', 'The Item does not exist.');
        const categoryId = normalized.categoryId ?? current.categoryId;
        const definitions = await this.fields.listDefinitions({ scope: 'item', categoryId });
        const stored = await this.ports.attributes.read(context, { kind: 'item', id: current.id });
        if (current.version !== version)
          throw conflictFor(current, definitions, stored, normalized, privileged);

        const submitted =
          normalized.attributes === undefined
            ? null
            : assignmentsFor(writableDefinitions(definitions, privileged), normalized.attributes);
        const assignments = mergeAssignments(definitions, stored, submitted);
        const displayName = await this.deriveDisplayName(transaction, {
          categoryId,
          lifecycleStatusId: normalized.lifecycleStatusId ?? current.lifecycleStatusId,
          definitions,
          assignments,
          fallback: normalized.displayName ?? current.displayName,
        });
        const updated = await this.items.updateCore(
          transaction,
          current.id,
          version,
          { ...coreChanges(normalized), displayName },
          updatedAt,
        );
        if (!updated) {
          const latest = await this.items.findByPublicId(publicId, transaction);
          if (!latest || latest.archivedAt)
            throw new ItemAccessError('ITEM_NOT_FOUND', 'The Item does not exist.');
          throw conflictFor(latest, definitions, stored, normalized, privileged);
        }
        if (normalized.tags !== undefined)
          await this.items.replaceTags(transaction, updated.id, normalized.tags);
        await this.ports.attributes.replace(context, {
          owner: { kind: 'item', id: updated.id },
          categoryId: updated.categoryId,
          assignments,
          now: updatedAt,
        });
        const changedKeys = changedAttributeKeys(definitions, stored, assignments);
        const plan = planItemInvalidation({
          attributesChanged: changedKeys.length > 0,
          coreProjectionChanged: projectionColumnsChanged(current, updated),
          visibilityChanged: current.visibility !== updated.visibility,
        });
        await this.writeProjection(context, updated, definitions, assignments, updatedAt);
        await this.ports.audit.record(context, {
          actorId: actor.id,
          action: 'item.updated',
          entityType: 'item',
          entityId: updated.id,
          ...(metadata.correlationId ? { correlationId: metadata.correlationId } : {}),
          ...(metadata.requestId ? { requestId: metadata.requestId } : {}),
          before: safeAuditSnapshot(current, changedKeys),
          after: safeAuditSnapshot(updated, changedKeys),
          createdAt: updatedAt,
        });
        if (current.storageNodeId !== updated.storageNodeId) {
          await this.ports.movements.append(context, {
            entityType: 'item',
            itemId: updated.id,
            storageNodeId: null,
            fromNodeId: current.storageNodeId,
            toNodeId: updated.storageNodeId,
            fromPathSnapshot: null,
            toPathSnapshot: null,
            actorUserId: actor.id,
            occurredAt: updatedAt,
            correlationId: metadata.correlationId ?? metadata.requestId ?? updated.publicId,
          });
        }
        await this.ports.outbox.enqueue(context, {
          topic: 'catalog.item-updated.v1',
          aggregateType: 'item',
          aggregateId: updated.id,
          payload: {
            publicId: updated.publicId,
            version: updated.version,
            invalidators: [...plan.events],
          },
          deduplicationKey: `item-updated:${updated.id}:${updated.version}`,
          createdAt: updatedAt,
        });
        for (const topic of plan.asynchronousTopics) {
          await this.ports.outbox.enqueue(context, {
            topic,
            aggregateType: 'item',
            aggregateId: updated.id,
            payload: { publicId: updated.publicId, version: updated.version },
            deduplicationKey: `${topic}:${updated.id}:${updated.version}`,
            createdAt: updatedAt,
          });
        }
        const response = responseFor(updated);
        if (reservation?.kind === 'acquired') {
          await this.ports.idempotency.complete(context, {
            recordId: reservation.recordId,
            reservationTokenHash: reservation.reservationTokenHash,
            responseStatus: 200,
            responseBody: { ...response },
            completedAt: updatedAt,
          });
        }
        return { replayed: false, status: 200, item: response, invalidators: plan.events };
      });
    } catch (error) {
      if (reservation?.kind === 'acquired')
        await this.idempotencyRecords.fail(
          reservation.recordId,
          reservation.reservationTokenHash,
          this.now(),
        );
      throw error;
    }
  }

  /**
   * Resolves the cached display name (blueprint section 9.3). A category without a template keeps
   * the name the actor supplied; a category with one derives the name through the shared Schema
   * renderer, so the stored value always equals what the Admin preview showed. A template that
   * resolves to nothing falls back to the supplied name rather than storing an empty column.
   *
   * The rendered name never changes `public_id`, the slug of an existing Item, or any issued
   * code: only `items.display_name` and the projection text it feeds are rewritten.
   */
  private async deriveDisplayName(
    transaction: ItemTransaction,
    input: {
      categoryId: string;
      lifecycleStatusId: string;
      definitions: readonly FieldDefinitionRecord[];
      assignments: readonly AttributeValueAssignment[];
      fallback: string;
    },
  ): Promise<string> {
    const category = await this.dictionaries.findCategoryById(input.categoryId, true, transaction);
    const template = category?.displayTemplate;
    if (!template) return input.fallback;
    const status = await this.dictionaries.findLifecycleStatusById(
      input.lifecycleStatusId,
      true,
      transaction,
    );
    const byId = new Map(input.definitions.map((definition) => [definition.id, definition]));
    const values: Record<string, readonly CanonicalFieldValue[]> = {};
    for (const assignment of input.assignments) {
      const definition = byId.get(assignment.fieldDefinitionId);
      if (definition) values[definition.key] = assignment.values;
    }
    try {
      const rendered = renderDisplayName(parseDisplayTemplate(template), {
        // The cached column stores one string, so it renders in the source locale.
        locale: 'en',
        core: { category: category?.labels ?? null, status: status?.labels ?? null },
        fields: input.definitions.map(toDisplayTokenField),
        values,
      });
      return rendered || input.fallback;
    } catch {
      // A stored template that no longer parses must not block an Item mutation.
      return input.fallback;
    }
  }

  private async reserveUpdate(
    actor: SessionActor,
    publicId: string,
    expectedVersion: number,
    normalized: NormalizedUpdate,
    metadata: ItemUpdateMetadata,
  ): Promise<IdempotencyReservation | null> {
    const idempotencyKey = metadata.idempotencyKey?.trim();
    if (!idempotencyKey) return null;
    if (idempotencyKey.length > 200)
      throw new ItemCreateError(
        'ITEM_IDEMPOTENCY_KEY_INVALID',
        'Idempotency-Key must contain between 1 and 200 characters.',
      );
    const reservation = await this.idempotencyRecords.reserve({
      actorId: actor.id,
      scope: 'catalog.items.update',
      key: idempotencyKey,
      fingerprint: requestFingerprint({ publicId, expectedVersion, ...normalized }),
    });
    if (reservation.kind === 'conflict')
      throw new ItemCreateError(
        'ITEM_IDEMPOTENCY_CONFLICT',
        'The idempotency key was already used for a different request.',
      );
    if (reservation.kind === 'in_progress')
      throw new ItemCreateError(
        'ITEM_IDEMPOTENCY_IN_PROGRESS',
        'The matching request is still being processed.',
      );
    return reservation;
  }

  private async writeProjection(
    context: { kind: 'prisma'; trx: ItemTransaction },
    item: ItemCoreRecord,
    definitions: readonly FieldDefinitionRecord[],
    assignments: readonly AttributeValueAssignment[],
    indexedAt: Date,
  ): Promise<void> {
    const projected = projectionFor(definitions, assignments);
    const discoverable = item.visibility === 'public' || item.visibility === 'authenticated';
    const publiclyDiscoverable = item.visibility === 'public';
    await this.ports.search.writeSync(context, {
      itemId: item.id,
      displayName: item.displayName,
      description: item.description,
      categoryId: item.categoryId,
      lifecycleStatusId: item.lifecycleStatusId,
      storageNodeId: item.storageNodeId,
      searchableText: discoverable
        ? searchText(item.displayName, item.description, projected.searchable)
        : '',
      publicSearchableText: publiclyDiscoverable
        ? searchText(item.displayName, item.description, projected.publicSearchable)
        : '',
      attrs: discoverable ? projected.attrs : {},
      publicAttrs: publiclyDiscoverable ? projected.publicAttrs : {},
      visibility: item.visibility,
      itemUpdatedAt: item.updatedAt,
      indexedAt,
    });
  }
}

function normalizeInput(input: CreateItemInput): Required<
  Omit<CreateItemInput, 'description' | 'storageNodeId'>
> & {
  description: string | null;
  storageNodeId: string | null;
} {
  const displayName = input.displayName.trim();
  if (!displayName)
    throw new ItemPolicyError(
      'ITEM_DISPLAY_NAME_REQUIRED',
      'displayName',
      'Item display name is required.',
    );
  if (input.storageNodeId)
    throw new ItemPolicyError(
      'ITEM_STORAGE_DESTINATION_UNAVAILABLE',
      'storageNodeId',
      'Storage destinations become available with STO-01.',
    );
  return {
    categoryId: input.categoryId,
    lifecycleStatusId: input.lifecycleStatusId,
    displayName,
    description: input.description?.trim() || null,
    visibility: normalizeItemVisibility(input.visibility),
    storageNodeId: input.storageNodeId ?? null,
    tags: input.tags ?? [],
    attributes: input.attributes ?? {},
  };
}

function assignmentsFor(
  definitions: readonly FieldDefinitionRecord[],
  attributes: Readonly<Record<string, unknown>>,
): AttributeValueAssignment[] {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  return Object.entries(attributes).map(([key, raw]) => {
    const definition = byKey.get(key);
    if (!definition) throw new AttributeValidationError([{ fieldKey: key, code: 'UNKNOWN_FIELD' }]);
    return {
      fieldDefinitionId: definition.id,
      values: canonicalizeFieldValues(shapeOf(definition), raw),
    };
  });
}

function projectionFor(
  definitions: readonly FieldDefinitionRecord[],
  assignments: readonly AttributeValueAssignment[],
): {
  attrs: Record<string, unknown>;
  publicAttrs: Record<string, unknown>;
  searchable: unknown[];
  publicSearchable: unknown[];
} {
  const valuesById = new Map(
    assignments.map((assignment) => [assignment.fieldDefinitionId, assignment.values]),
  );
  const attrs: Record<string, unknown> = {};
  const publicAttrs: Record<string, unknown> = {};
  const searchable: unknown[] = [];
  const publicSearchable: unknown[] = [];
  for (const definition of definitions) {
    const values = valuesById.get(definition.id);
    if (!values?.length || definition.visibility === 'private') continue;
    const value = projectFieldValues(shapeOf(definition), values);
    attrs[definition.key] = value;
    if (definition.searchable) searchable.push(value);
    if (definition.visibility === 'public') {
      publicAttrs[definition.key] = value;
      if (definition.searchable) publicSearchable.push(value);
    }
  }
  return { attrs, publicAttrs, searchable, publicSearchable };
}

function shapeOf(definition: FieldDefinitionRecord): FieldValueShape {
  return {
    key: definition.key,
    dataType: definition.dataType,
    repeatable: definition.repeatable,
    required: definition.required,
    validation: definition.validation,
  };
}

function searchText(
  displayName: string,
  description: string | null,
  values: readonly unknown[],
): string {
  return [displayName, description, ...values]
    .flatMap((value) => (value === null || value === undefined ? [] : [JSON.stringify(value)]))
    .join(' ');
}

function responseFor(item: {
  publicId: string;
  slug: string;
  displayName: string;
  version: number;
}): CreatedItem {
  return {
    publicId: item.publicId,
    slug: item.slug,
    displayName: item.displayName,
    version: item.version,
  };
}

function replayedItem(value: Record<string, unknown>): CreatedItem {
  if (
    typeof value.publicId !== 'string' ||
    typeof value.slug !== 'string' ||
    typeof value.displayName !== 'string' ||
    typeof value.version !== 'number'
  )
    throw new Error('Stored idempotency response is invalid.');
  return {
    publicId: value.publicId,
    slug: value.slug,
    displayName: value.displayName,
    version: value.version,
  };
}

/** Normalized update payload. An absent key means "leave unchanged". */
interface NormalizedUpdate {
  categoryId?: string;
  lifecycleStatusId?: string;
  displayName?: string;
  description?: string | null;
  visibility?: ItemVisibility;
  storageNodeId?: string | null;
  tags?: readonly string[];
  attributes?: Readonly<Record<string, unknown>>;
}

function requireExpectedVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new ItemPolicyError(
      'ITEM_EXPECTED_VERSION_INVALID',
      'expectedVersion',
      'A positive expected version is required.',
    );
  return value;
}

function normalizeUpdateInput(input: UpdateItemInput): NormalizedUpdate {
  if (input.storageNodeId)
    throw new ItemPolicyError(
      'ITEM_STORAGE_DESTINATION_UNAVAILABLE',
      'storageNodeId',
      'Storage destinations become available with STO-01.',
    );
  const normalized: NormalizedUpdate = {};
  if (input.categoryId !== undefined) normalized.categoryId = input.categoryId;
  if (input.lifecycleStatusId !== undefined) normalized.lifecycleStatusId = input.lifecycleStatusId;
  if (input.displayName !== undefined) {
    const displayName = input.displayName.trim();
    if (!displayName)
      throw new ItemPolicyError(
        'ITEM_DISPLAY_NAME_REQUIRED',
        'displayName',
        'Item display name is required.',
      );
    normalized.displayName = displayName;
  }
  if (input.description !== undefined) normalized.description = input.description?.trim() || null;
  if (input.visibility !== undefined)
    normalized.visibility = normalizeItemVisibility(input.visibility);
  if (input.storageNodeId !== undefined) normalized.storageNodeId = input.storageNodeId ?? null;
  if (input.tags !== undefined) normalized.tags = input.tags;
  if (input.attributes !== undefined) normalized.attributes = input.attributes;
  return normalized;
}

/** Splits the core columns out of a normalized update; tags and values have their own ports. */
function coreChanges(normalized: NormalizedUpdate): UpdateItemCoreInput {
  return {
    ...(normalized.categoryId === undefined ? {} : { categoryId: normalized.categoryId }),
    ...(normalized.lifecycleStatusId === undefined
      ? {}
      : { lifecycleStatusId: normalized.lifecycleStatusId }),
    ...(normalized.displayName === undefined ? {} : { displayName: normalized.displayName }),
    ...(normalized.description === undefined ? {} : { description: normalized.description }),
    ...(normalized.visibility === undefined ? {} : { visibility: normalized.visibility }),
    ...(normalized.storageNodeId === undefined ? {} : { storageNodeId: normalized.storageNodeId }),
  };
}

/** A private definition is neither readable nor writable without `viewPrivateFields`. */
function writableDefinitions(
  definitions: readonly FieldDefinitionRecord[],
  privileged: boolean,
): readonly FieldDefinitionRecord[] {
  return privileged
    ? definitions
    : definitions.filter((definition) => definition.visibility !== 'private');
}

/**
 * Keeps every stored value the submission did not address, so an actor who cannot see a private
 * field cannot erase it by omitting it. Values whose definition no longer applies to the Item
 * category are dropped, which is the intended effect of moving an Item to another category.
 */
function mergeAssignments(
  definitions: readonly FieldDefinitionRecord[],
  stored: readonly AttributeValueAssignment[],
  submitted: readonly AttributeValueAssignment[] | null,
): AttributeValueAssignment[] {
  const applicable = new Set(definitions.map((definition) => definition.id));
  const merged = new Map<string, readonly CanonicalFieldValue[]>();
  for (const assignment of stored) {
    if (applicable.has(assignment.fieldDefinitionId))
      merged.set(assignment.fieldDefinitionId, assignment.values);
  }
  if (submitted) {
    const addressed = new Set(submitted.map((assignment) => assignment.fieldDefinitionId));
    for (const id of addressed) merged.delete(id);
    for (const assignment of submitted) {
      if (assignment.values.length) merged.set(assignment.fieldDefinitionId, assignment.values);
    }
  }
  return [...merged].map(([fieldDefinitionId, values]) => ({ fieldDefinitionId, values }));
}

function valuesById(
  assignments: readonly AttributeValueAssignment[],
): Map<string, readonly CanonicalFieldValue[]> {
  return new Map(
    assignments.map((assignment) => [assignment.fieldDefinitionId, assignment.values]),
  );
}

function sameValues(
  left: readonly CanonicalFieldValue[] | undefined,
  right: readonly CanonicalFieldValue[] | undefined,
): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

/** Stable field keys whose stored values changed. Values themselves never leave this function. */
function changedAttributeKeys(
  definitions: readonly FieldDefinitionRecord[],
  before: readonly AttributeValueAssignment[],
  after: readonly AttributeValueAssignment[],
): string[] {
  const previous = valuesById(before);
  const next = valuesById(after);
  const keyById = new Map(definitions.map((definition) => [definition.id, definition.key]));
  return [...new Set([...previous.keys(), ...next.keys()])]
    .filter((id) => !sameValues(previous.get(id), next.get(id)))
    .map((id) => keyById.get(id) ?? id)
    .sort();
}

function projectionColumnsChanged(before: ItemCoreRecord, after: ItemCoreRecord): boolean {
  return (
    before.displayName !== after.displayName ||
    before.description !== after.description ||
    before.categoryId !== after.categoryId ||
    before.lifecycleStatusId !== after.lifecycleStatusId ||
    before.storageNodeId !== after.storageNodeId
  );
}

/** Audit snapshot without any dynamic value; only stable keys and non-private core columns. */
function safeAuditSnapshot(
  item: ItemCoreRecord,
  changedKeys: readonly string[],
): Record<string, unknown> {
  return {
    publicId: item.publicId,
    categoryId: item.categoryId,
    lifecycleStatusId: item.lifecycleStatusId,
    visibility: item.visibility,
    version: item.version,
    attributeKeys: [...changedKeys],
  };
}

/** Attribute projection restricted to the definitions the actor is allowed to read. */
function visibleAttributes(
  definitions: readonly FieldDefinitionRecord[],
  assignments: readonly AttributeValueAssignment[],
  privileged: boolean,
): Record<string, unknown> {
  const values = valuesById(assignments);
  const attributes: Record<string, unknown> = {};
  for (const definition of writableDefinitions(definitions, privileged)) {
    const stored = values.get(definition.id);
    if (!stored?.length) continue;
    attributes[definition.key] = projectFieldValues(shapeOf(definition), stored);
  }
  return attributes;
}

/**
 * Builds the conflict payload. Only fields the rejected actor may view are compared, so the
 * response can be rendered in a compare/reload workflow without disclosing a private value.
 */
function conflictFor(
  current: ItemCoreRecord,
  definitions: readonly FieldDefinitionRecord[],
  stored: readonly AttributeValueAssignment[],
  submitted: NormalizedUpdate,
  privileged: boolean,
): ItemVersionConflictError {
  const safeDiff: Record<string, SafeDiffEntry> = {};
  const core: [keyof NormalizedUpdate, unknown][] = [
    ['categoryId', current.categoryId],
    ['lifecycleStatusId', current.lifecycleStatusId],
    ['displayName', current.displayName],
    ['description', current.description],
    ['visibility', current.visibility],
    ['storageNodeId', current.storageNodeId],
  ];
  for (const [field, currentValue] of core) {
    const submittedValue = submitted[field];
    if (submittedValue === undefined || submittedValue === currentValue) continue;
    safeDiff[field] = { current: currentValue, submitted: submittedValue };
  }
  const currentAttributes = visibleAttributes(definitions, stored, privileged);
  const readable = writableDefinitions(definitions, privileged);
  for (const definition of readable) {
    const submittedValue = submitted.attributes?.[definition.key];
    if (submittedValue === undefined) continue;
    const currentValue = currentAttributes[definition.key] ?? null;
    if (JSON.stringify(currentValue) === JSON.stringify(submittedValue)) continue;
    safeDiff[`attributes.${definition.key}`] = {
      current: currentValue,
      submitted: submittedValue,
    };
  }
  return new ItemVersionConflictError(current.version, safeDiff);
}
