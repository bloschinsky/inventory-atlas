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

function safeIdentifier(value: string | undefined): string {
  const normalized = value?.trim().slice(0, 128);
  return normalized || randomUUID();
}
