import { randomUUID } from 'node:crypto';
import { sql as kyselySql, type Transaction as KyselyTransaction } from 'kysely';
import type { Prisma } from '../generated/prisma/client.js';

export type TransactionContext<Database = Record<string, never>> =
  | { kind: 'prisma'; trx: Prisma.TransactionClient }
  | { kind: 'kysely'; trx: KyselyTransaction<Database> };

export interface AuditRecord {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  correlationId?: string;
  requestId?: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: Date;
}

export interface OutboxMessage {
  topic: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  deduplicationKey: string;
  createdAt: Date;
  availableAt?: Date;
}

export interface AuditPort {
  record<Database>(context: TransactionContext<Database>, event: AuditRecord): Promise<void>;
}

export interface OutboxPort {
  enqueue<Database>(context: TransactionContext<Database>, message: OutboxMessage): Promise<void>;
}

export interface MovementRecord {
  entityType: 'item' | 'storage_node';
  itemId: string | null;
  storageNodeId: string | null;
  fromNodeId: string | null;
  toNodeId: string | null;
  fromPathSnapshot: string | null;
  toPathSnapshot: string | null;
  actorUserId: string;
  reason?: string;
  occurredAt: Date;
  correlationId: string;
}

export interface MovementHistoryPort {
  append<Database>(context: TransactionContext<Database>, movement: MovementRecord): Promise<void>;
}

export interface ItemSearchProjection {
  itemId: string;
  displayName: string;
  description: string | null;
  categoryId: string;
  lifecycleStatusId: string;
  storageNodeId: string | null;
  searchableText: string;
  publicSearchableText: string;
  attrs: Record<string, unknown>;
  publicAttrs: Record<string, unknown>;
  visibility: 'public' | 'authenticated' | 'private' | 'unlisted';
  itemUpdatedAt: Date;
  indexedAt: Date;
}

export interface SearchProjectionPort {
  writeSync<Database>(
    context: TransactionContext<Database>,
    projection: ItemSearchProjection,
  ): Promise<void>;
}

export interface IdempotencyCompletion {
  recordId: string;
  reservationTokenHash: string;
  responseStatus: number;
  responseBody: Record<string, unknown>;
  completedAt: Date;
}

export interface IdempotencyPort {
  complete<Database>(
    context: TransactionContext<Database>,
    completion: IdempotencyCompletion,
  ): Promise<void>;
}

export class TransactionalAuditPort implements AuditPort {
  async record<Database>(context: TransactionContext<Database>, event: AuditRecord): Promise<void> {
    const id = randomUUID();
    const correlationId = safeIdentifier(event.correlationId);
    const requestId = safeIdentifier(event.requestId);
    const before = event.before === null ? null : JSON.stringify(event.before);
    const after = event.after === null ? null : JSON.stringify(event.after);
    if (context.kind === 'prisma') {
      await context.trx.$executeRaw`
        insert into audit_events (
          id, actor_id, action, entity_type, entity_id, correlation_id, request_id,
          before_json, after_json, created_at
        ) values (
          ${id}::uuid, ${event.actorId}::uuid, ${event.action}, ${event.entityType},
          ${event.entityId}::uuid, ${correlationId}, ${requestId}, ${before}::jsonb,
          ${after}::jsonb, ${event.createdAt}
        )
      `;
      return;
    }
    await kyselySql`
      insert into audit_events (
        id, actor_id, action, entity_type, entity_id, correlation_id, request_id,
        before_json, after_json, created_at
      ) values (
        ${id}::uuid, ${event.actorId}::uuid, ${event.action}, ${event.entityType},
        ${event.entityId}::uuid, ${correlationId}, ${requestId}, ${before}::jsonb,
        ${after}::jsonb, ${event.createdAt}
      )
    `.execute(context.trx);
  }
}

export class TransactionalOutboxPort implements OutboxPort {
  async enqueue<Database>(
    context: TransactionContext<Database>,
    message: OutboxMessage,
  ): Promise<void> {
    const id = randomUUID();
    const payload = JSON.stringify(message.payload);
    const availableAt = message.availableAt ?? message.createdAt;
    if (context.kind === 'prisma') {
      await context.trx.$executeRaw`
        insert into outbox (
          id, topic, aggregate_type, aggregate_id, payload_json, deduplication_key,
          created_at, available_at
        ) values (
          ${id}::uuid, ${message.topic}, ${message.aggregateType},
          ${message.aggregateId}::uuid, ${payload}::jsonb, ${message.deduplicationKey},
          ${message.createdAt}, ${availableAt}
        )
      `;
      return;
    }
    await kyselySql`
      insert into outbox (
        id, topic, aggregate_type, aggregate_id, payload_json, deduplication_key,
        created_at, available_at
      ) values (
        ${id}::uuid, ${message.topic}, ${message.aggregateType},
        ${message.aggregateId}::uuid, ${payload}::jsonb, ${message.deduplicationKey},
        ${message.createdAt}, ${availableAt}
      )
    `.execute(context.trx);
  }
}

export class TransactionalMovementHistoryPort implements MovementHistoryPort {
  async append<Database>(
    context: TransactionContext<Database>,
    movement: MovementRecord,
  ): Promise<void> {
    const id = randomUUID();
    if (context.kind === 'prisma') {
      await context.trx.$executeRaw`
        insert into movements (
          id, entity_type, item_id, storage_node_id, from_node_id, to_node_id,
          from_path_snapshot, to_path_snapshot, actor_user_id, reason, occurred_at, correlation_id
        ) values (
          ${id}::uuid, ${movement.entityType}, ${movement.itemId}::uuid,
          ${movement.storageNodeId}::uuid, ${movement.fromNodeId}::uuid,
          ${movement.toNodeId}::uuid, ${movement.fromPathSnapshot}, ${movement.toPathSnapshot},
          ${movement.actorUserId}::uuid, ${movement.reason ?? null}, ${movement.occurredAt},
          ${movement.correlationId}
        )
      `;
      return;
    }
    await kyselySql`
      insert into movements (
        id, entity_type, item_id, storage_node_id, from_node_id, to_node_id,
        from_path_snapshot, to_path_snapshot, actor_user_id, reason, occurred_at, correlation_id
      ) values (
        ${id}::uuid, ${movement.entityType}, ${movement.itemId}::uuid,
        ${movement.storageNodeId}::uuid, ${movement.fromNodeId}::uuid,
        ${movement.toNodeId}::uuid, ${movement.fromPathSnapshot}, ${movement.toPathSnapshot},
        ${movement.actorUserId}::uuid, ${movement.reason ?? null}, ${movement.occurredAt},
        ${movement.correlationId}
      )
    `.execute(context.trx);
  }
}

export class TransactionalSearchProjectionPort implements SearchProjectionPort {
  async writeSync<Database>(
    context: TransactionContext<Database>,
    projection: ItemSearchProjection,
  ): Promise<void> {
    if (projection.storageNodeId !== null) {
      throw new Error('Storage destinations are unavailable until STO-01 creates storage_nodes.');
    }
    const attrs = JSON.stringify(projection.attrs);
    const publicAttrs = JSON.stringify(projection.publicAttrs);
    if (context.kind === 'prisma') {
      await context.trx.$executeRaw`
        insert into item_search (
          item_id, display_name, description, category_id, lifecycle_status_id,
          path_text, public_path_text, search_vector, public_search_vector,
          attrs, public_attrs, visibility, index_state, item_updated_at, indexed_at
        ) values (
          ${projection.itemId}::uuid, ${projection.displayName}, ${projection.description},
          ${projection.categoryId}::uuid, ${projection.lifecycleStatusId}::uuid, '', '',
          to_tsvector('simple', ${projection.searchableText}),
          to_tsvector('simple', ${projection.publicSearchableText}),
          ${attrs}::jsonb, ${publicAttrs}::jsonb, ${projection.visibility}, 'ready',
          ${projection.itemUpdatedAt}, ${projection.indexedAt}
        ) on conflict (item_id) do update set
          display_name = excluded.display_name, description = excluded.description,
          category_id = excluded.category_id, lifecycle_status_id = excluded.lifecycle_status_id,
          path_text = excluded.path_text, public_path_text = excluded.public_path_text,
          search_vector = excluded.search_vector,
          public_search_vector = excluded.public_search_vector,
          attrs = excluded.attrs, public_attrs = excluded.public_attrs,
          visibility = excluded.visibility, index_state = excluded.index_state,
          item_updated_at = excluded.item_updated_at, indexed_at = excluded.indexed_at
      `;
      return;
    }
    await kyselySql`
      insert into item_search (
        item_id, display_name, description, category_id, lifecycle_status_id,
        path_text, public_path_text, search_vector, public_search_vector,
        attrs, public_attrs, visibility, index_state, item_updated_at, indexed_at
      ) values (
        ${projection.itemId}::uuid, ${projection.displayName}, ${projection.description},
        ${projection.categoryId}::uuid, ${projection.lifecycleStatusId}::uuid, '', '',
        to_tsvector('simple', ${projection.searchableText}),
        to_tsvector('simple', ${projection.publicSearchableText}),
        ${attrs}::jsonb, ${publicAttrs}::jsonb, ${projection.visibility}, 'ready',
        ${projection.itemUpdatedAt}, ${projection.indexedAt}
      ) on conflict (item_id) do update set
        display_name = excluded.display_name, description = excluded.description,
        category_id = excluded.category_id, lifecycle_status_id = excluded.lifecycle_status_id,
        path_text = excluded.path_text, public_path_text = excluded.public_path_text,
        search_vector = excluded.search_vector,
        public_search_vector = excluded.public_search_vector,
        attrs = excluded.attrs, public_attrs = excluded.public_attrs,
        visibility = excluded.visibility, index_state = excluded.index_state,
        item_updated_at = excluded.item_updated_at, indexed_at = excluded.indexed_at
    `.execute(context.trx);
  }
}

export class TransactionalIdempotencyPort implements IdempotencyPort {
  async complete<Database>(
    context: TransactionContext<Database>,
    completion: IdempotencyCompletion,
  ): Promise<void> {
    const responseBody = JSON.stringify(completion.responseBody);
    const execute = async (statement: PromiseLike<{ count?: bigint } | number>) => {
      const result = await statement;
      const count = typeof result === 'number' ? result : Number(result.count ?? 0n);
      if (count !== 1) throw new Error('Idempotency reservation was lost or expired.');
    };
    if (context.kind === 'prisma') {
      await execute(context.trx.$executeRaw`
        update idempotency_records set
          state = 'completed', response_status = ${completion.responseStatus},
          response_body_json = ${responseBody}::jsonb, completed_at = ${completion.completedAt},
          updated_at = ${completion.completedAt}
        where id = ${completion.recordId}::uuid and state = 'reserved'
          and reservation_token_hash = ${completion.reservationTokenHash}
          and lease_expires_at >= ${completion.completedAt}
      `);
      return;
    }
    const result = await kyselySql`
      update idempotency_records set
        state = 'completed', response_status = ${completion.responseStatus},
        response_body_json = ${responseBody}::jsonb, completed_at = ${completion.completedAt},
        updated_at = ${completion.completedAt}
      where id = ${completion.recordId}::uuid and state = 'reserved'
        and reservation_token_hash = ${completion.reservationTokenHash}
        and lease_expires_at >= ${completion.completedAt}
    `.execute(context.trx);
    if (Number(result.numAffectedRows) !== 1)
      throw new Error('Idempotency reservation was lost or expired.');
  }
}

function safeIdentifier(value: string | undefined): string {
  const normalized = value?.trim().slice(0, 128);
  return normalized || randomUUID();
}
