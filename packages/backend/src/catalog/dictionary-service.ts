import { can, type SessionActor } from '../auth/index.js';
import {
  CatalogDictionaryRepository,
  type CategoryRecord,
  type LifecycleStatusRecord,
} from './dictionary-repository.js';
import { DictionaryPolicyError, type LocalizedLabel } from './dictionary-policy.js';
import type { FieldDefinitionRecord, FieldDefinitionRepository } from '../schema/index.js';
import {
  describeDisplayTokens,
  renderDisplayName,
  toDisplayTokenField,
  validateDisplayTemplate,
  type DisplayNameSource,
  type DisplayTokenDescription,
} from '../schema/display-template.js';
import { canonicalizeFieldValues, type FieldValueShape } from '../schema/field-policy.js';

/** One rendered preview of a category template, produced by the renderer the Items use. */
export interface DisplayNamePreview {
  template: string;
  tokens: DisplayTokenDescription[];
  /** Rendered output per supported locale, using the supplied or placeholder sample values. */
  rendered: { en: string; uk: string };
  /** Stable field keys the template references that resolved to no sample value. */
  missingTokens: string[];
}

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
  constructor(
    private readonly repository: CatalogDictionaryRepository,
    private readonly fields: Pick<FieldDefinitionRepository, 'listDefinitions'>,
  ) {}

  listCategories(actor: SessionActor, includeArchived = false): Promise<CategoryRecord[]> {
    this.authorizeRead(actor, includeArchived);
    return this.repository.listCategories(includeArchived);
  }

  resolveCategory(actor: SessionActor, id: string): Promise<CategoryRecord | null> {
    this.authorizeRead(actor, false);
    return this.repository.findCategoryById(id, true);
  }

  async createCategory(
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
    await this.requireResolvableTemplate(input.displayTemplate, null);
    return this.repository.createCategory(input, { actorId: actor.id, ...metadata });
  }

  async updateCategory(
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
    await this.requireResolvableTemplate(input.displayTemplate, id);
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

  /**
   * Renders a candidate template with the same renderer the Item mutation path uses, so the
   * preview and the stored result can never disagree. Sample values are supplied by the caller;
   * a token without one renders as missing, which is exactly how a real Item behaves.
   */
  async previewCategoryDisplayName(
    actor: SessionActor,
    categoryId: string | null,
    template: unknown,
    sample: Readonly<Record<string, unknown>> = {},
  ): Promise<DisplayNamePreview> {
    this.authorize(actor);
    const category = categoryId ? await this.repository.findCategoryById(categoryId, true) : null;
    if (categoryId && !category)
      throw new DictionaryPolicyError(
        'CATALOG_DICTIONARY_NOT_FOUND',
        'The category does not exist.',
      );
    const definitions = await this.templateFields(categoryId);
    const segments = validateDisplayTemplate(template, definitions.map(toDisplayTokenField));
    const values = sampleValues(definitions, sample);
    const core = {
      category: category?.labels ?? null,
      status: null,
    };
    const source = (locale: 'en' | 'uk'): DisplayNameSource => ({
      locale,
      core,
      fields: definitions.map(toDisplayTokenField),
      values,
    });
    return {
      template: String(template).trim(),
      tokens: describeDisplayTokens(segments, definitions.map(toDisplayTokenField), core),
      rendered: {
        en: renderDisplayName(segments, source('en')),
        uk: renderDisplayName(segments, source('uk')),
      },
      missingTokens: segments.flatMap((segment) =>
        segment.kind === 'token' &&
        segment.key !== 'category' &&
        segment.key !== 'status' &&
        !values[segment.key]?.length
          ? [segment.key]
          : [],
      ),
    };
  }

  private async requireResolvableTemplate(
    template: string | null | undefined,
    categoryId: string | null,
  ): Promise<void> {
    if (template === undefined || template === null || template.trim() === '') return;
    const definitions = await this.templateFields(categoryId);
    validateDisplayTemplate(template, definitions.map(toDisplayTokenField));
  }

  private templateFields(categoryId: string | null): Promise<FieldDefinitionRecord[]> {
    return this.fields.listDefinitions({
      scope: 'item',
      categoryId,
      includeArchived: false,
    });
  }

  private authorize(actor: SessionActor): void {
    if (!can(actor.role, 'manageSchema')) throw new CatalogDictionaryAuthorizationError();
  }

  private authorizeRead(actor: SessionActor, includeArchived: boolean): void {
    if (includeArchived || !can(actor.role, 'viewAuthenticatedFields')) this.authorize(actor);
  }
}

/**
 * Canonicalizes caller-supplied sample values the same way a stored value is canonicalized, so a
 * preview cannot render a shape the persistence layer would reject. An unusable sample is treated
 * as absent rather than failing the preview.
 */
function sampleValues(
  definitions: readonly FieldDefinitionRecord[],
  sample: Readonly<Record<string, unknown>>,
): Record<string, ReturnType<typeof canonicalizeFieldValues>> {
  const values: Record<string, ReturnType<typeof canonicalizeFieldValues>> = {};
  for (const definition of definitions) {
    const raw = sample[definition.key];
    if (raw === undefined || raw === null || raw === '') continue;
    try {
      const canonical = canonicalizeFieldValues(shapeOf(definition), raw);
      if (canonical.length) values[definition.key] = canonical;
    } catch {
      continue;
    }
  }
  return values;
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
