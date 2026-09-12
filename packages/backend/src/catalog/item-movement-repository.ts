import { sql, type Kysely } from 'kysely';

export interface ItemLocationProjection {
  accessible: boolean;
  storageNodePublicId: string | null;
  path: string | null;
}

export interface ItemMovementEntry {
  fromAssigned: boolean;
  toAssigned: boolean;
  fromNodePublicId: string | null;
  toNodePublicId: string | null;
  fromPathSnapshot: string | null;
  toPathSnapshot: string | null;
  actorDisplayName: string;
  reason: string | null;
  occurredAt: string;
}

export interface ItemMovementPage {
  entries: ItemMovementEntry[];
  nextCursor: string | null;
}

export interface ItemMovementReader {
  locationFor(itemId: string, privileged: boolean): Promise<ItemLocationProjection>;
  list(
    itemId: string,
    limit: number,
    cursor: string | null,
    privileged: boolean,
  ): Promise<ItemMovementPage>;
}

interface MovementCursor {
  occurredAt: string;
  id: string;
}

interface MovementRow {
  id: string;
  from_node_public_id: string | null;
  to_node_public_id: string | null;
  from_path_snapshot: string | null;
  to_path_snapshot: string | null;
  actor_display_name: string;
  reason: string | null;
  occurred_at: Date;
}

/** Kysely-owned read side for the append-only Item movement stream and current projection path. */
export class ItemMovementRepository<Database> implements ItemMovementReader {
  constructor(private readonly database: Kysely<Database>) {}

  async locationFor(itemId: string, privileged: boolean): Promise<ItemLocationProjection> {
    const result = await sql<{
      path_text: string;
      visibility: string;
      storage_node_public_id: string | null;
    }>`
      select search.path_text, search.visibility,
        destination.public_id::text as storage_node_public_id
      from item_search search
      join items item on item.id = search.item_id
      left join storage_nodes destination on destination.id = item.storage_node_id
      where search.item_id = ${itemId}::uuid
    `.execute(this.database);
    const row = result.rows[0];
    if (!row) return { accessible: true, storageNodePublicId: null, path: null };
    return {
      accessible: privileged || row.visibility !== 'private',
      storageNodePublicId: row.storage_node_public_id,
      path: row.path_text.trim() || null,
    };
  }

  async list(
    itemId: string,
    limit: number,
    cursor: string | null,
    privileged: boolean,
  ): Promise<ItemMovementPage> {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const decoded = cursor ? decodeCursor(cursor) : null;
    const result = await sql<MovementRow>`
      select movement.id,
        source.public_id as from_node_public_id,
        destination.public_id as to_node_public_id,
        movement.from_path_snapshot,
        movement.to_path_snapshot,
        actor.display_name as actor_display_name,
        movement.reason,
        movement.occurred_at
      from movements movement
      join users actor on actor.id = movement.actor_user_id
      left join storage_nodes source on source.id = movement.from_node_id
      left join storage_nodes destination on destination.id = movement.to_node_id
      where movement.entity_type = 'item'
        and movement.item_id = ${itemId}::uuid
        and (
          ${decoded?.occurredAt ?? null}::timestamptz is null
          or (movement.occurred_at, movement.id) < (
            ${decoded?.occurredAt ?? null}::timestamptz,
            ${decoded?.id ?? null}::uuid
          )
        )
      order by movement.occurred_at desc, movement.id desc
      limit ${boundedLimit + 1}
    `.execute(this.database);
    const hasNext = result.rows.length > boundedLimit;
    const pageRows = result.rows.slice(0, boundedLimit);
    const last = pageRows.at(-1);
    return {
      entries: pageRows.map((row) => ({
        fromAssigned: row.from_node_public_id !== null,
        toAssigned: row.to_node_public_id !== null,
        fromNodePublicId: privileged ? row.from_node_public_id : null,
        toNodePublicId: privileged ? row.to_node_public_id : null,
        fromPathSnapshot: privileged ? row.from_path_snapshot : null,
        toPathSnapshot: privileged ? row.to_path_snapshot : null,
        actorDisplayName: row.actor_display_name,
        reason: row.reason,
        occurredAt: row.occurred_at.toISOString(),
      })),
      nextCursor:
        hasNext && last
          ? encodeCursor({ occurredAt: last.occurred_at.toISOString(), id: last.id })
          : null,
    };
  }
}

function encodeCursor(cursor: MovementCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string): MovementCursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<MovementCursor>;
    if (
      typeof decoded.occurredAt !== 'string' ||
      Number.isNaN(Date.parse(decoded.occurredAt)) ||
      typeof decoded.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        decoded.id,
      )
    )
      throw new Error('invalid cursor');
    return { occurredAt: decoded.occurredAt, id: decoded.id };
  } catch {
    throw new ItemMovementCursorError();
  }
}

export class ItemMovementCursorError extends Error {
  readonly code = 'ITEM_MOVEMENT_CURSOR_INVALID';

  constructor() {
    super('The movement-history cursor is invalid.');
    this.name = 'ItemMovementCursorError';
  }
}
