import { can, type SessionActor } from '../auth/index.js';
import {
  CatalogDictionaryRepository,
  type CategoryRecord,
  type LifecycleStatusRecord,
} from './dictionary-repository.js';
import type { LocalizedLabel } from './dictionary-policy.js';

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

  createCategory(
    actor: SessionActor,
    input: {
      key: string;
      labels: LocalizedLabel;
      parentId?: string | null;
      displayTemplate?: string | null;
      displayOrder: number;
    },
  ): Promise<CategoryRecord> {
    this.authorize(actor);
    return this.repository.createCategory(input);
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
  ): Promise<CategoryRecord> {
    this.authorize(actor);
    return this.repository.updateCategory(id, expectedVersion, input);
  }

  archiveCategory(
    actor: SessionActor,
    id: string,
    expectedVersion: number,
  ): Promise<CategoryRecord> {
    this.authorize(actor);
    return this.repository.archiveCategory(id, expectedVersion);
  }

  listLifecycleStatuses(
    actor: SessionActor,
    includeArchived = false,
  ): Promise<LifecycleStatusRecord[]> {
    this.authorizeRead(actor, includeArchived);
    return this.repository.listLifecycleStatuses(includeArchived);
  }

  createLifecycleStatus(
    actor: SessionActor,
    input: { key: string; labels: LocalizedLabel; colorToken: string; displayOrder: number },
  ): Promise<LifecycleStatusRecord> {
    this.authorize(actor);
    return this.repository.createLifecycleStatus(input);
  }

  updateLifecycleStatus(
    actor: SessionActor,
    id: string,
    expectedVersion: number,
    input: { labels?: LocalizedLabel; colorToken?: string; displayOrder?: number },
  ): Promise<LifecycleStatusRecord> {
    this.authorize(actor);
    return this.repository.updateLifecycleStatus(id, expectedVersion, input);
  }

  archiveLifecycleStatus(
    actor: SessionActor,
    id: string,
    expectedVersion: number,
  ): Promise<LifecycleStatusRecord> {
    this.authorize(actor);
    return this.repository.archiveLifecycleStatus(id, expectedVersion);
  }

  private authorize(actor: SessionActor): void {
    if (!can(actor.role, 'manageSchema')) throw new CatalogDictionaryAuthorizationError();
  }

  private authorizeRead(actor: SessionActor, includeArchived: boolean): void {
    if (includeArchived || !can(actor.role, 'viewAuthenticatedFields')) this.authorize(actor);
  }
}
