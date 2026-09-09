import { can, type SessionActor } from '../auth/index.js';
import {
  CatalogDictionaryRepository,
  type CategoryRecord,
  type LifecycleStatusRecord,
} from './dictionary-repository.js';
import type { LocalizedLabel } from './dictionary-policy.js';

export interface DictionaryRequestMetadata {
  correlationId?: string;
  requestId?: string;
}

export class CatalogDictionaryAuthorizationError extends Error {
  readonly code = 'CATALOG_DICTIONARY_FORBIDDEN';

  constructor() {
    super('Catalog dictionary management is not permitted.');
    this.name = 'CatalogDictionaryAuthorizationError';
  }
}

export class CatalogDictionaryService {
  constructor(private readonly repository: CatalogDictionaryRepository) {}

  listCategories(actor: SessionActor, includeArchived = false): Promise<CategoryRecord[]> {
    this.authorizeRead(actor, includeArchived);
    return this.repository.listCategories(includeArchived);
  }

  resolveCategory(actor: SessionActor, id: string): Promise<CategoryRecord | null> {
    this.authorizeRead(actor, false);
    return this.repository.findCategoryById(id, true);
  }

  createCategory(
    actor: SessionActor,
    input: {
      key: string;
      labels: LocalizedLabel;
      parentId?: string | null;
      displayTemplate?: string | null;
      displayOrder: number;
    },
    metadata: DictionaryRequestMetadata = {},
  ): Promise<CategoryRecord> {
    this.authorize(actor);
    return this.repository.createCategory(input, { actorId: actor.id, ...metadata });
  }

  updateCategory(
    actor: SessionActor,
    id: string,
    expectedVersion: number,
    input: {
      labels?: LocalizedLabel;
      parentId?: string | null;
      displayTemplate?: string | null;
      displayOrder?: number;
    },
    metadata: DictionaryRequestMetadata = {},
  ): Promise<CategoryRecord> {
    this.authorize(actor);
    return this.repository.updateCategory(id, expectedVersion, input, {
      actorId: actor.id,
      ...metadata,
    });
  }

  archiveCategory(
    actor: SessionActor,
    id: string,
    expectedVersion: number,
    metadata: DictionaryRequestMetadata = {},
  ): Promise<CategoryRecord> {
    this.authorize(actor);
    return this.repository.archiveCategory(id, expectedVersion, {
      actorId: actor.id,
      ...metadata,
    });
  }

  listLifecycleStatuses(
    actor: SessionActor,
    includeArchived = false,
  ): Promise<LifecycleStatusRecord[]> {
    this.authorizeRead(actor, includeArchived);
    return this.repository.listLifecycleStatuses(includeArchived);
  }

  resolveLifecycleStatus(actor: SessionActor, id: string): Promise<LifecycleStatusRecord | null> {
    this.authorizeRead(actor, false);
    return this.repository.findLifecycleStatusById(id, true);
  }

  createLifecycleStatus(
    actor: SessionActor,
    input: { key: string; labels: LocalizedLabel; colorToken: string; displayOrder: number },
    metadata: DictionaryRequestMetadata = {},
  ): Promise<LifecycleStatusRecord> {
    this.authorize(actor);
    return this.repository.createLifecycleStatus(input, { actorId: actor.id, ...metadata });
  }

  updateLifecycleStatus(
    actor: SessionActor,
    id: string,
    expectedVersion: number,
    input: { labels?: LocalizedLabel; colorToken?: string; displayOrder?: number },
    metadata: DictionaryRequestMetadata = {},
  ): Promise<LifecycleStatusRecord> {
    this.authorize(actor);
    return this.repository.updateLifecycleStatus(id, expectedVersion, input, {
      actorId: actor.id,
      ...metadata,
    });
  }

  archiveLifecycleStatus(
    actor: SessionActor,
    id: string,
    expectedVersion: number,
    metadata: DictionaryRequestMetadata = {},
  ): Promise<LifecycleStatusRecord> {
    this.authorize(actor);
    return this.repository.archiveLifecycleStatus(id, expectedVersion, {
      actorId: actor.id,
      ...metadata,
    });
  }

  private authorize(actor: SessionActor): void {
    if (!can(actor.role, 'manageSchema')) throw new CatalogDictionaryAuthorizationError();
  }

  private authorizeRead(actor: SessionActor, includeArchived: boolean): void {
    if (includeArchived || !can(actor.role, 'viewAuthenticatedFields')) this.authorize(actor);
  }
}
