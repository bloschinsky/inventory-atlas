import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';

export const storageNodeTypes = [
  'site',
  'room',
  'zone',
  'rack',
  'shelf',
  'container',
  'custom',
] as const;
export type StorageNodeType = (typeof storageNodeTypes)[number];

export const storageVisibilities = ['public', 'authenticated', 'private', 'unlisted'] as const;
export type StorageVisibility = (typeof storageVisibilities)[number];

export interface StorageDatabase {
  storage_nodes: {
    id: string;
    public_id: string;
    parent_id: string | null;
    path: unknown;
    depth: number;
    tree_root_id: string;
    node_type: string;
    title: string;
    code: string | null;
    visibility: string;
    version: bigint;
    created_at: Date;
    updated_at: Date;
    archived_at: Date | null;
  };
}

export type StorageTransaction = Transaction<StorageDatabase>;

export interface StorageNodeRecord {
  id: string;
  publicId: string;
  parentId: string | null;
  path: string;
  depth: number;
  treeRootId: string;
  nodeType: StorageNodeType;
  title: string;
  code: string | null;
  visibility: StorageVisibility;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface StorageBreadcrumb {
  publicId: string;
  title: string;
  depth: number;
}

export interface StorageContentRow {
  kind: 'node' | 'item';
  publicId: string;
  title: string;
  visibility: StorageVisibility;
  version: number;
}

export interface StoragePage<T> {
  entries: T[];
  nextCursor: string | null;
}

export type StoragePolicyCode =
  | 'STORAGE_TITLE_REQUIRED'
  | 'STORAGE_TYPE_INVALID'
  | 'STORAGE_VISIBILITY_INVALID'
  | 'STORAGE_PARENT_NOT_FOUND'
  | 'STORAGE_NOT_FOUND'
  | 'STORAGE_VERSION_CONFLICT'
  | 'STORAGE_MOVE_CYCLE'
  | 'STORAGE_MOVE_NO_CHANGE'
  | 'STORAGE_MOVE_REASON_INVALID'
  | 'STORAGE_CURSOR_INVALID';

export class StoragePolicyError extends Error {
  constructor(
    readonly code: StoragePolicyCode,
    readonly fieldKey: string,
    message: string,
    readonly currentVersion?: number,
  ) {
    super(message);
    this.name = 'StoragePolicyError';
  }
}

export function storageNodeLabel(id: string): string {
  const normalized = id.toLowerCase().replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/u.test(normalized))
    throw new StoragePolicyError('STORAGE_NOT_FOUND', 'id', 'StorageNode ID is invalid.');
  return `n${normalized}`;
}

export function normalizeStorageType(value: string): StorageNodeType {
  if (!storageNodeTypes.includes(value as StorageNodeType))
    throw new StoragePolicyError('STORAGE_TYPE_INVALID', 'nodeType', 'Node type is invalid.');
  return value as StorageNodeType;
}

export function normalizeStorageVisibility(value: string | undefined): StorageVisibility {
  const normalized = value ?? 'authenticated';
  if (!storageVisibilities.includes(normalized as StorageVisibility))
    throw new StoragePolicyError(
      'STORAGE_VISIBILITY_INVALID',
      'visibility',
      'Storage visibility is invalid.',
    );
  return normalized as StorageVisibility;
}

interface StorageRow {
  id: string;
  public_id: string;
  parent_id: string | null;
  path: string;
  depth: number;
  tree_root_id: string;
  node_type: string;
  title: string;
  code: string | null;
  visibility: string;
  version: string | number | bigint;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

interface PageCursor {
  title: string;
  id: string;
  kind?: 'node' | 'item';
}

export class StorageRepository {
  constructor(
    private readonly database: Kysely<StorageDatabase>,
    private readonly newId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  transaction<T>(work: (transaction: StorageTransaction) => Promise<T>): Promise<T> {
    return this.database.transaction().execute(work);
  }

  async createCore(
    transaction: StorageTransaction,
    input: {
      parentPublicId?: string | null;
      nodeType: string;
      title: string;
      code?: string | null;
      visibility?: string;
    },
    privileged: boolean,
  ): Promise<StorageNodeRecord> {
    const id = this.newId();
    const publicId = this.newId();
    const title = requiredTitle(input.title);
    const nodeType = normalizeStorageType(input.nodeType);
    const visibility = normalizeStorageVisibility(input.visibility);
    const code = input.code?.trim() || null;
    const now = this.now();
    let parent: StorageNodeRecord | null = null;
    if (input.parentPublicId) {
      parent = await this.findByPublicId(input.parentPublicId, transaction, true);
      if (!parent || parent.archivedAt)
        throw new StoragePolicyError(
          'STORAGE_PARENT_NOT_FOUND',
          'parentPublicId',
          'The parent StorageNode does not exist.',
        );
      await this.lockRoot(transaction, parent.treeRootId);
      if (!(await this.findAccessibleByPublicId(parent.publicId, privileged, transaction)))
        throw new StoragePolicyError(
          'STORAGE_PARENT_NOT_FOUND',
          'parentPublicId',
          'The parent StorageNode does not exist.',
        );
    } else {
      await this.lockRoot(transaction, id);
    }
    const label = storageNodeLabel(id);
    const path = parent ? `${parent.path}.${label}` : label;
    const treeRootId = parent?.treeRootId ?? id;
    const depth = (parent?.depth ?? -1) + 1;
    const { rows } = await sql<StorageRow>`
      insert into storage_nodes (
        id, public_id, parent_id, path, depth, tree_root_id, node_type, title, code,
        visibility, version, created_at, updated_at
      ) values (
        ${id}::uuid, ${publicId}::uuid, ${parent?.id ?? null}::uuid, ${path}::ltree,
        ${depth}, ${treeRootId}::uuid, ${nodeType}, ${title}, ${code}, ${visibility}, 1,
        ${now}, ${now}
      ) returning id::text, public_id::text, parent_id::text, path::text, depth,
        tree_root_id::text, node_type, title, code, visibility, version, created_at,
        updated_at, archived_at
    `.execute(transaction);
    return rowToRecord(rows[0]!);
  }

  async updateCore(
    transaction: StorageTransaction,
    publicId: string,
    expectedVersion: number,
    input: {
      nodeType?: string;
      title?: string;
      code?: string | null;
      visibility?: string;
      archived?: boolean;
    },
    privileged: boolean,
  ): Promise<{ before: StorageNodeRecord; after: StorageNodeRecord }> {
    const before = await this.findByPublicId(publicId, transaction, true);
    if (!before || before.archivedAt)
      throw new StoragePolicyError('STORAGE_NOT_FOUND', 'publicId', 'StorageNode was not found.');
    if (before.version !== expectedVersion)
      throw new StoragePolicyError(
        'STORAGE_VERSION_CONFLICT',
        'expectedVersion',
        'StorageNode changed since it was loaded.',
        before.version,
      );
    await this.lockRoot(transaction, before.treeRootId);
    if (!(await this.findAccessibleByPublicId(publicId, privileged, transaction)))
      throw new StoragePolicyError('STORAGE_NOT_FOUND', 'publicId', 'StorageNode was not found.');
    const title = input.title === undefined ? before.title : requiredTitle(input.title);
    const nodeType =
      input.nodeType === undefined ? before.nodeType : normalizeStorageType(input.nodeType);
    const visibility =
      input.visibility === undefined
        ? before.visibility
        : normalizeStorageVisibility(input.visibility);
    const code = input.code === undefined ? before.code : input.code?.trim() || null;
    const now = this.now();
    const archivedAt = input.archived === true ? now : before.archivedAt;
    const { rows } = await sql<StorageRow>`
      update storage_nodes set
        node_type = ${nodeType}, title = ${title}, code = ${code}, visibility = ${visibility},
        archived_at = ${archivedAt}, version = version + 1, updated_at = ${now}
      where id = ${before.id}::uuid and version = ${expectedVersion} and archived_at is null
      returning id::text, public_id::text, parent_id::text, path::text, depth,
        tree_root_id::text, node_type, title, code, visibility, version, created_at,
        updated_at, archived_at
    `.execute(transaction);
    if (!rows[0])
      throw new StoragePolicyError(
        'STORAGE_VERSION_CONFLICT',
        'expectedVersion',
        'StorageNode changed since it was loaded.',
        (await this.findByPublicId(publicId, transaction, true))?.version,
      );
    return { before, after: rowToRecord(rows[0]) };
  }

  async lockMoveNodes(
    transaction: StorageTransaction,
    sourcePublicId: string,
    targetPublicId: string,
  ): Promise<{ source: StorageNodeRecord; target: StorageNodeRecord }> {
    const { rows } = await sql<
      StorageRow & { requested_role: 'source' | 'source_parent' | 'target' }
    >`
      with source as (
        select id, parent_id from storage_nodes where public_id = ${sourcePublicId}::uuid
      ), target as (
        select id from storage_nodes where public_id = ${targetPublicId}::uuid
      ), requested(requested_role, id) as (
        select 'source', id from source
        union all
        select 'source_parent', parent_id from source where parent_id is not null
        union all
        select 'target', id from target
      )
      select requested.requested_role, node.id::text, node.public_id::text,
        node.parent_id::text, node.path::text, node.depth, node.tree_root_id::text,
        node.node_type, node.title, node.code, node.visibility, node.version,
        node.created_at, node.updated_at, node.archived_at
      from requested join storage_nodes node on node.id = requested.id
      order by node.id
      for update of node
    `.execute(transaction);
    const source = rows.find((row) => row.requested_role === 'source');
    const target = rows.find((row) => row.requested_role === 'target');
    if (!source)
      throw new StoragePolicyError('STORAGE_NOT_FOUND', 'publicId', 'StorageNode was not found.');
    if (!target)
      throw new StoragePolicyError(
        'STORAGE_NOT_FOUND',
        'targetParentPublicId',
        'The destination StorageNode was not found.',
      );
    return { source: rowToRecord(source), target: rowToRecord(target) };
  }

  async lockRoots(transaction: StorageTransaction, rootIds: readonly string[]): Promise<void> {
    for (const rootId of orderedUniqueUuids(rootIds)) await this.lockRoot(transaction, rootId);
  }

  async targetIsInSubtree(
    transaction: StorageTransaction,
    sourcePath: string,
    targetPath: string,
  ): Promise<boolean> {
    const { rows } = await sql<{ is_descendant: boolean }>`
      select ${targetPath}::ltree <@ ${sourcePath}::ltree as is_descendant
    `.execute(transaction);
    return rows[0]?.is_descendant ?? false;
  }

  async moveSubtree(
    transaction: StorageTransaction,
    source: StorageNodeRecord,
    target: StorageNodeRecord,
    movedAt: Date,
  ): Promise<StorageNodeRecord> {
    const newPath = `${target.path}.${storageNodeLabel(source.id)}`;
    const depthDelta = target.depth + 1 - source.depth;
    const { rows } = await sql<StorageRow>`
      update storage_nodes set
        parent_id = case when id = ${source.id}::uuid then ${target.id}::uuid else parent_id end,
        path = case
          when path = ${source.path}::ltree then ${newPath}::ltree
          else ${newPath}::ltree || subpath(path, nlevel(${source.path}::ltree))
        end,
        depth = depth + ${depthDelta}, tree_root_id = ${target.treeRootId}::uuid,
        version = version + 1, updated_at = ${movedAt}
      where path <@ ${source.path}::ltree
      returning id::text, public_id::text, parent_id::text, path::text, depth,
        tree_root_id::text, node_type, title, code, visibility, version, created_at,
        updated_at, archived_at
    `.execute(transaction);
    const moved = rows.find((row) => row.id === source.id);
    if (!moved)
      throw new StoragePolicyError('STORAGE_NOT_FOUND', 'publicId', 'StorageNode was not found.');
    return rowToRecord(moved);
  }

  async findByPublicId(
    publicId: string,
    transaction?: StorageTransaction,
    forUpdate = false,
  ): Promise<StorageNodeRecord | null> {
    const executor = transaction ?? this.database;
    const lock = forUpdate ? sql` for update` : sql``;
    const { rows } = await sql<StorageRow>`
      select id::text, public_id::text, parent_id::text, path::text, depth,
        tree_root_id::text, node_type, title, code, visibility, version, created_at,
        updated_at, archived_at
      from storage_nodes where public_id = ${publicId}::uuid${lock}
    `.execute(executor);
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async findById(id: string, transaction?: StorageTransaction): Promise<StorageNodeRecord | null> {
    const { rows } = await sql<StorageRow>`
      select id::text, public_id::text, parent_id::text, path::text, depth,
        tree_root_id::text, node_type, title, code, visibility, version, created_at,
        updated_at, archived_at
      from storage_nodes where id = ${id}::uuid
    `.execute(transaction ?? this.database);
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async findAccessibleByPublicId(
    publicId: string,
    privileged: boolean,
    transaction?: StorageTransaction,
  ): Promise<StorageNodeRecord | null> {
    const { rows } = await sql<StorageRow>`
      select node.id::text, node.public_id::text, node.parent_id::text, node.path::text,
        node.depth, node.tree_root_id::text, node.node_type, node.title, node.code,
        node.visibility, node.version, node.created_at, node.updated_at, node.archived_at
      from storage_nodes node
      where node.public_id = ${publicId}::uuid and node.archived_at is null
        and not exists (
          select 1 from storage_nodes ancestor
          where ancestor.path @> node.path
            and (ancestor.archived_at is not null
              or (not ${privileged}::boolean and ancestor.visibility = 'private'))
        )
    `.execute(transaction ?? this.database);
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async list(
    parentPublicId: string | null,
    limit: number,
    cursor: string | null,
    privileged: boolean,
  ): Promise<StoragePage<StorageNodeRecord>> {
    const parsed = decodeCursor(cursor);
    const bounded = boundedLimit(limit);
    const parent = parentPublicId
      ? await this.findAccessibleByPublicId(parentPublicId, privileged)
      : null;
    if (parentPublicId && !parent)
      throw new StoragePolicyError(
        'STORAGE_PARENT_NOT_FOUND',
        'parentPublicId',
        'The parent StorageNode does not exist.',
      );
    const { rows } = await sql<StorageRow>`
      select id::text, public_id::text, parent_id::text, path::text, depth,
        tree_root_id::text, node_type, title, code, visibility, version, created_at,
        updated_at, archived_at
      from storage_nodes
      where parent_id is not distinct from ${parent?.id ?? null}::uuid
        and archived_at is null and visibility <> 'unlisted'
        and (${privileged}::boolean or visibility <> 'private')
        and (${parsed?.title ?? null}::text is null
          or (title, id) > (${parsed?.title ?? ''}, ${parsed?.id ?? randomUUID()}::uuid))
      order by title, id limit ${bounded + 1}
    `.execute(this.database);
    return page(rows.map(rowToRecord), bounded, (entry) => ({ title: entry.title, id: entry.id }));
  }

  async breadcrumb(node: StorageNodeRecord, privileged: boolean): Promise<StorageBreadcrumb[]> {
    const { rows } = await sql<{ public_id: string; title: string; depth: number }>`
      select ancestor.public_id::text, ancestor.title, ancestor.depth
      from storage_nodes ancestor
      where ancestor.path @> ${node.path}::ltree and ancestor.archived_at is null
        and (${privileged}::boolean or ancestor.visibility <> 'private')
      order by ancestor.depth
    `.execute(this.database);
    return rows.map((row) => ({ publicId: row.public_id, title: row.title, depth: row.depth }));
  }

  async contents(
    node: StorageNodeRecord,
    limit: number,
    cursor: string | null,
    privileged: boolean,
  ): Promise<StoragePage<StorageContentRow>> {
    const parsed = decodeCursor(cursor);
    const bounded = boundedLimit(limit);
    const { rows } = await sql<{
      kind: 'node' | 'item';
      public_id: string;
      title: string;
      visibility: StorageVisibility;
      version: string | number | bigint;
      id: string;
    }>`
      with contents as (
        select 'node'::text as kind, public_id, title, visibility, version, id
        from storage_nodes
        where parent_id = ${node.id}::uuid and archived_at is null and visibility <> 'unlisted'
          and (${privileged}::boolean or visibility <> 'private')
        union all
        select 'item'::text as kind, public_id, display_name as title, visibility, version, id
        from items
        where storage_node_id = ${node.id}::uuid and archived_at is null and visibility <> 'unlisted'
          and (${privileged}::boolean or visibility <> 'private')
      )
      select kind, public_id::text, title, visibility, version, id::text from contents
      where (${parsed?.title ?? null}::text is null
        or (title, kind, id) > (
          ${parsed?.title ?? ''}, ${parsed?.kind ?? 'node'}, ${parsed?.id ?? randomUUID()}::uuid
        ))
      order by title, kind, id limit ${bounded + 1}
    `.execute(this.database);
    const entries = rows.map((row) => ({
      kind: row.kind,
      publicId: row.public_id,
      title: row.title,
      visibility: normalizeStorageVisibility(row.visibility),
      version: Number(row.version),
    }));
    return page(entries, bounded, (entry) => {
      const row = rows.find(
        (candidate) => candidate.public_id === entry.publicId && candidate.kind === entry.kind,
      )!;
      return { title: entry.title, kind: entry.kind, id: row.id };
    });
  }

  async ancestors(publicId: string): Promise<StorageNodeRecord[]> {
    const node = await this.findByPublicId(publicId);
    if (!node) return [];
    const { rows } = await sql<StorageRow>`
      select id::text, public_id::text, parent_id::text, path::text, depth,
        tree_root_id::text, node_type, title, code, visibility, version, created_at,
        updated_at, archived_at
      from storage_nodes where path @> ${node.path}::ltree order by depth
    `.execute(this.database);
    return rows.map(rowToRecord);
  }

  async subtree(publicId: string): Promise<StorageNodeRecord[]> {
    const node = await this.findByPublicId(publicId);
    if (!node) return [];
    const { rows } = await sql<StorageRow>`
      select id::text, public_id::text, parent_id::text, path::text, depth,
        tree_root_id::text, node_type, title, code, visibility, version, created_at,
        updated_at, archived_at
      from storage_nodes where path <@ ${node.path}::ltree order by depth, id
    `.execute(this.database);
    return rows.map(rowToRecord);
  }

  async lockRoot(transaction: StorageTransaction, rootId: string): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${rootId}, 0))`.execute(transaction);
  }
}

export function orderedUniqueUuids(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.toLowerCase()))].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function requiredTitle(value: string): string {
  const title = value.trim();
  if (!title)
    throw new StoragePolicyError(
      'STORAGE_TITLE_REQUIRED',
      'title',
      'StorageNode title is required.',
    );
  return title;
}

function rowToRecord(row: StorageRow): StorageNodeRecord {
  return {
    id: row.id,
    publicId: row.public_id,
    parentId: row.parent_id,
    path: row.path,
    depth: row.depth,
    treeRootId: row.tree_root_id,
    nodeType: normalizeStorageType(row.node_type),
    title: row.title,
    code: row.code,
    visibility: normalizeStorageVisibility(row.visibility),
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function boundedLimit(value: number): number {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 100) : 25;
}

function page<T>(rows: T[], limit: number, cursorFor: (entry: T) => PageCursor): StoragePage<T> {
  const entries = rows.slice(0, limit);
  return {
    entries,
    nextCursor: rows.length > limit ? encodeCursor(cursorFor(entries.at(-1)!)) : null,
  };
}

function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | null): PageCursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as PageCursor;
    if (
      typeof decoded.title !== 'string' ||
      !/^[0-9a-f-]{36}$/iu.test(decoded.id) ||
      (decoded.kind !== undefined && decoded.kind !== 'node' && decoded.kind !== 'item')
    )
      throw new Error('invalid');
    return decoded;
  } catch {
    throw new StoragePolicyError('STORAGE_CURSOR_INVALID', 'cursor', 'Storage cursor is invalid.');
  }
}
