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
  type IdempotencyReservationPort,
} from '../infrastructure/idempotency-repository.js';
import type {
  AttributeValueAssignment,
  AttributeValuePort,
} from '../schema/attribute-value-port.js';
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
  type ItemVisibility,
} from './item-repository.js';

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

export type CreateItemOutcome =
  | { replayed: false; status: 201; item: CreatedItem }
  | { replayed: true; status: number; item: CreatedItem };

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
        const created = await this.items.createCore(transaction, normalized);
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
          payload: { publicId: created.publicId, version: created.version },
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
