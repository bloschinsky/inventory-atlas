import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';

export type IdempotencyReservation =
  | {
      kind: 'acquired';
      recordId: string;
      reservationTokenHash: string;
    }
  | { kind: 'completed'; responseStatus: number; responseBody: Record<string, unknown> }
  | { kind: 'in_progress' }
  | { kind: 'conflict' };

interface IdempotencyRow {
  id: string;
  request_fingerprint: string;
  state: 'reserved' | 'completed' | 'failed';
  response_status: number | null;
  response_body_json: unknown;
  lease_expires_at: Date;
}

export interface ReserveIdempotencyRequest {
  actorId: string;
  scope: string;
  key: string;
  fingerprint: string;
}

export interface IdempotencyReservationPort {
  reserve(request: ReserveIdempotencyRequest): Promise<IdempotencyReservation>;
  fail(recordId: string, reservationTokenHash: string, failedAt?: Date): Promise<void>;
}

export const idempotencyPolicy = Object.freeze({
  leaseMs: 30_000,
  retentionMs: 24 * 60 * 60 * 1_000,
});

export class IdempotencyRepository<Database> implements IdempotencyReservationPort {
  constructor(
    private readonly database: Kysely<Database>,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
    private readonly newToken: () => string = () => randomBytes(32).toString('base64url'),
  ) {}

  async reserve(request: ReserveIdempotencyRequest): Promise<IdempotencyReservation> {
    const now = this.now();
    const keyHash = sha256(request.key);
    const tokenHash = sha256(this.newToken());
    const leaseExpiresAt = new Date(now.getTime() + idempotencyPolicy.leaseMs);
    const expiresAt = new Date(now.getTime() + idempotencyPolicy.retentionMs);
    const recordId = this.newId();

    const inserted = await sql<{ id: string }>`
      insert into idempotency_records (
        id, actor_id, scope, key_hash, request_fingerprint, state,
        reservation_token_hash, lease_expires_at, created_at, updated_at, expires_at
      ) values (
        ${recordId}::uuid, ${request.actorId}::uuid, ${request.scope}, ${keyHash},
        ${request.fingerprint}, 'reserved', ${tokenHash}, ${leaseExpiresAt}, ${now}, ${now},
        ${expiresAt}
      ) on conflict (actor_id, scope, key_hash) do nothing
      returning id
    `.execute(this.database);
    if (inserted.rows.length === 1)
      return { kind: 'acquired', recordId, reservationTokenHash: tokenHash };

    const existing = await this.read(request.actorId, request.scope, keyHash);
    if (!existing) return this.reserve(request);
    if (existing.request_fingerprint !== request.fingerprint) return { kind: 'conflict' };
    if (existing.state === 'completed') {
      if (existing.response_status === null || !isRecord(existing.response_body_json))
        throw new Error('Completed idempotency record has no replayable response.');
      return {
        kind: 'completed',
        responseStatus: existing.response_status,
        responseBody: existing.response_body_json,
      };
    }
    if (existing.state === 'reserved' && existing.lease_expires_at.getTime() > now.getTime())
      return { kind: 'in_progress' };

    const reclaimed = await sql<{ id: string }>`
      update idempotency_records set
        state = 'reserved', reservation_token_hash = ${tokenHash},
        lease_expires_at = ${leaseExpiresAt}, updated_at = ${now}, expires_at = ${expiresAt},
        response_status = null, response_body_json = null, completed_at = null
      where id = ${existing.id}::uuid and request_fingerprint = ${request.fingerprint}
        and (state = 'failed' or (state = 'reserved' and lease_expires_at <= ${now}))
      returning id
    `.execute(this.database);
    return reclaimed.rows.length === 1
      ? { kind: 'acquired', recordId: existing.id, reservationTokenHash: tokenHash }
      : { kind: 'in_progress' };
  }

  async fail(
    recordId: string,
    reservationTokenHash: string,
    failedAt: Date = this.now(),
  ): Promise<void> {
    await sql`
      update idempotency_records set state = 'failed', updated_at = ${failedAt}
        where id = ${recordId}::uuid and state = 'reserved'
          and reservation_token_hash = ${reservationTokenHash}
    `.execute(this.database);
  }

  private async read(
    actorId: string,
    scope: string,
    keyHash: string,
  ): Promise<IdempotencyRow | null> {
    const { rows } = await sql<IdempotencyRow>`
      select id, request_fingerprint, state, response_status, response_body_json, lease_expires_at
        from idempotency_records
        where actor_id = ${actorId}::uuid and scope = ${scope} and key_hash = ${keyHash}
    `.execute(this.database);
    return rows[0] ?? null;
  }
}

export function requestFingerprint(value: unknown): string {
  return sha256(stableJson(value));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
