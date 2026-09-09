import { can, type SessionActor } from '../auth/index.js';
import type { AttributeOwner, ReplaceAttributeValues } from './attribute-value-port.js';
import type { AttributeValuePort } from './attribute-value-port.js';
import type { TransactionContext } from '../infrastructure/index.js';
import {
  AttributeValidationError,
  canonicalizeFieldValues,
  projectFieldValues,
  type CanonicalFieldValue,
  type FieldScope,
  type FieldValueShape,
} from './field-policy.js';
import {
  FieldDefinitionRepository,
  type ConversionPreview,
  type CreateFieldDefinitionInput,
  type FieldDefinitionMutation,
  type FieldDefinitionRecord,
  type UpdateFieldDefinitionInput,
} from './field-definition-repository.js';

export interface SchemaRequestMetadata {
  correlationId?: string;
  requestId?: string;
}

export class SchemaAuthorizationError extends Error {
  readonly code = 'SCHEMA_FORBIDDEN';

  constructor() {
    super('Dynamic schema management is not permitted.');
    this.name = 'SchemaAuthorizationError';
  }
}

/**
 * Schema module application surface. Reading the resolved schema needs an authenticated actor;
 * archived reads and every mutation need `manageSchema`. Attribute replacement is exposed as a
 * transaction-aware operation so Item and StorageNode aggregates stay atomic.
 */
export class FieldDefinitionService {
  constructor(
    private readonly repository: FieldDefinitionRepository,
    private readonly attributeValues: AttributeValuePort,
  ) {}

  listFields(
    actor: SessionActor,
    filter: { scope?: FieldScope; categoryId?: string | null; includeArchived?: boolean } = {},
  ): Promise<FieldDefinitionRecord[]> {
    this.authorizeRead(actor, filter.includeArchived ?? false);
    return this.repository.listDefinitions(filter);
  }

  resolveField(actor: SessionActor, id: string): Promise<FieldDefinitionRecord | null> {
    this.authorizeRead(actor, false);
    return this.repository.findDefinitionById(id, true);
  }

  createField(
    actor: SessionActor,
    input: CreateFieldDefinitionInput,
    metadata: SchemaRequestMetadata = {},
  ): Promise<FieldDefinitionRecord> {
    this.authorize(actor);
    return this.repository.createDefinition(input, { actorId: actor.id, ...metadata });
  }

  updateField(
    actor: SessionActor,
    id: string,
    expectedVersion: number,
    input: UpdateFieldDefinitionInput,
    metadata: SchemaRequestMetadata = {},
  ): Promise<FieldDefinitionMutation> {
    this.authorize(actor);
    return this.repository.updateDefinition(id, expectedVersion, input, {
      actorId: actor.id,
      ...metadata,
    });
  }

  archiveField(
    actor: SessionActor,
    id: string,
    expectedVersion: number,
    metadata: SchemaRequestMetadata = {},
  ): Promise<FieldDefinitionMutation> {
    this.authorize(actor);
    return this.repository.archiveDefinition(id, expectedVersion, {
      actorId: actor.id,
      ...metadata,
    });
  }

  createOption(
    actor: SessionActor,
    definitionId: string,
    expectedVersion: number,
    input: { key: string; labels: unknown; displayOrder?: number },
    metadata: SchemaRequestMetadata = {},
  ): Promise<FieldDefinitionRecord> {
    this.authorize(actor);
    return this.repository.createOption(definitionId, expectedVersion, input, {
      actorId: actor.id,
      ...metadata,
    });
  }

  updateOption(
    actor: SessionActor,
    definitionId: string,
    optionId: string,
    expectedVersion: number,
    input: { labels?: unknown; displayOrder?: number },
    metadata: SchemaRequestMetadata = {},
  ): Promise<FieldDefinitionRecord> {
    this.authorize(actor);
    return this.repository.updateOption(definitionId, optionId, expectedVersion, input, {
      actorId: actor.id,
      ...metadata,
    });
  }

  archiveOption(
    actor: SessionActor,
    definitionId: string,
    optionId: string,
    expectedVersion: number,
    metadata: SchemaRequestMetadata = {},
  ): Promise<FieldDefinitionRecord> {
    this.authorize(actor);
    return this.repository.archiveOption(definitionId, optionId, expectedVersion, {
      actorId: actor.id,
      ...metadata,
    });
  }

  previewConversion(
    actor: SessionActor,
    id: string,
    targetDataType: unknown,
  ): Promise<ConversionPreview> {
    this.authorize(actor);
    return this.repository.previewTypeConversion(id, targetDataType);
  }

  /** Converts API-shaped attribute input into canonical values using the resolved schema. */
  async validateAttributes(
    owner: AttributeOwner,
    categoryId: string | null,
    attributes: Readonly<Record<string, unknown>>,
  ): Promise<{ fieldDefinitionId: string; values: readonly CanonicalFieldValue[] }[]> {
    const definitions = await this.repository.listDefinitions({
      scope: owner.kind === 'item' ? 'item' : 'storage_node',
      categoryId,
    });
    const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
    return Object.entries(attributes).map(([key, raw]) => {
      const definition = byKey.get(key);
      if (!definition)
        throw new AttributeValidationError([{ fieldKey: key, code: 'UNKNOWN_FIELD' }]);
      return {
        fieldDefinitionId: definition.id,
        values: canonicalizeFieldValues(shapeOf(definition), raw),
      };
    });
  }

  replaceAttributes<Database>(
    context: TransactionContext<Database>,
    command: ReplaceAttributeValues,
  ): Promise<void> {
    return this.attributeValues.replace(context, command);
  }

  /** Projects stored values back into the API shape, with multiselect as an ordered array. */
  async readAttributes(owner: AttributeOwner): Promise<Record<string, unknown>> {
    const groups = await this.repository.readAttributeValues(owner);
    return Object.fromEntries(
      groups.map((group) => [
        group.definition.key,
        projectFieldValues(shapeOf(group.definition), group.values),
      ]),
    );
  }

  private authorize(actor: SessionActor): void {
    if (!can(actor.role, 'manageSchema')) throw new SchemaAuthorizationError();
  }

  private authorizeRead(actor: SessionActor, includeArchived: boolean): void {
    if (includeArchived || !can(actor.role, 'viewAuthenticatedFields')) this.authorize(actor);
  }
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
