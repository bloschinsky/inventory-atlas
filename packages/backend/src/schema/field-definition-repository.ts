import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  TransactionalAuditPort,
  TransactionalOutboxPort,
  type AuditPort,
  type OutboxPort,
} from '../infrastructure/index.js';
import {
  AttributeValidationError,
  canonicalizeFieldValues,
  normalizeDefaultValue,
  normalizeLocalizedText,
  normalizeOptionalLocalizedText,
  normalizeUnit,
  normalizeValidationRules,
  projectFieldValues,
  SchemaPolicyError,
  usesOptions,
  validateDataType,
  validateDisplayOrder,
  validateExpectedVersion,
  validateFieldKey,
  validateRepeatable,
  validateScope,
  validateVisibility,
  type AttributeIssueCode,
  type CanonicalFieldValue,
  type FieldDataType,
  type FieldScope,
  type FieldValueShape,
  type FieldVisibility,
  type LocalizedText,
  type ValidationRules,
} from './field-policy.js';
import type { AttributeOwner } from './attribute-value-port.js';

type SchemaReadClient = Pick<
  Prisma.TransactionClient,
  'fieldDefinition' | 'fieldOption' | 'attributeValue' | 'category'
>;
type SchemaClient = Pick<
  PrismaClient,
  'fieldDefinition' | 'fieldOption' | 'attributeValue' | 'category' | '$transaction'
>;

export interface SchemaMutationMetadata {
  actorId: string | null;
  correlationId?: string;
  requestId?: string;
}

export interface FieldOptionRecord {
  id: string;
  key: string;
  labels: LocalizedText;
  displayOrder: number;
  archivedAt: Date | null;
}

export interface FieldDefinitionRecord {
  id: string;
  key: string;
  scope: FieldScope;
  categoryId: string | null;
  labels: LocalizedText;
  help: LocalizedText | null;
  dataType: FieldDataType;
  required: boolean;
  repeatable: boolean;
  searchable: boolean;
  filterable: boolean;
  sortable: boolean;
  visibility: FieldVisibility;
  unit: string | null;
  /** Ordered API-shaped default values; a scalar field projects a single-entry array. */
  defaultValue: unknown[] | null;
  validation: ValidationRules;
  displayOrder: number;
  version: number;
  archivedAt: Date | null;
  options: FieldOptionRecord[];
}

export const reindexReasons = [
  'visibility',
  'searchable',
  'filterable',
  'sortable',
  'labels',
  'archived',
] as const;
export type ReindexReason = (typeof reindexReasons)[number];

export interface ReindexWarning {
  massReindexRequired: boolean;
  reasons: readonly ReindexReason[];
  topic: 'search.rebuild-items.v1';
}

export interface FieldDefinitionMutation {
  definition: FieldDefinitionRecord;
  reindex: ReindexWarning;
}

export interface ConversionPreview {
  fieldDefinitionId: string;
  fieldKey: string;
  currentDataType: FieldDataType;
  targetDataType: FieldDataType;
  supported: boolean;
  lossless: boolean;
  totalValues: number;
  analyzedValues: number;
  convertibleValues: number;
  blockingValues: number;
  truncated: boolean;
  requiresBackgroundConversion: boolean;
  reindexRequired: boolean;
  blockingIssues: readonly AttributeIssueCode[];
}

export interface CreateFieldDefinitionInput {
  key: string;
  scope: unknown;
  categoryId?: string | null;
  labels: unknown;
  help?: unknown;
  dataType: unknown;
  required?: boolean;
  repeatable?: boolean;
  searchable?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  visibility?: unknown;
  unit?: unknown;
  defaultValue?: unknown;
  validation?: unknown;
  displayOrder?: number;
}

export interface UpdateFieldDefinitionInput {
  categoryId?: string | null;
  labels?: unknown;
  help?: unknown;
  dataType?: unknown;
  required?: boolean;
  repeatable?: boolean;
  searchable?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  visibility?: unknown;
  unit?: unknown;
  defaultValue?: unknown;
  validation?: unknown;
  displayOrder?: number;
}

const conversionAnalysisLimit = 10_000;
const textTypes: readonly FieldDataType[] = ['text', 'long_text', 'url', 'email'];
const optionTypes: readonly FieldDataType[] = ['select', 'multiselect'];

export class FieldDefinitionRepository {
  constructor(
    private readonly prisma: SchemaClient,
    private readonly now: () => Date = () => new Date(),
    private readonly auditPort: AuditPort = new TransactionalAuditPort(),
    private readonly outboxPort: OutboxPort = new TransactionalOutboxPort(),
  ) {}

  /** Resolved schema for a scope and optional category, ordered for form rendering. */
  async listDefinitions(
    filter: { scope?: FieldScope; categoryId?: string | null; includeArchived?: boolean } = {},
  ): Promise<FieldDefinitionRecord[]> {
    const rows = await this.prisma.fieldDefinition.findMany({
      where: {
        ...(filter.scope ? { scope: filter.scope } : {}),
        ...(filter.includeArchived ? {} : { archivedAt: null }),
        ...(filter.categoryId === undefined
          ? {}
          : filter.categoryId === null
            ? { categoryId: null }
            : { OR: [{ categoryId: null }, { categoryId: filter.categoryId }] }),
      },
      include: { options: { orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }] } },
      orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }],
    });
    return rows.map((row) => toDefinitionRecord(row, filter.includeArchived ?? false));
  }

  async findDefinitionById(
    id: string,
    includeArchived = true,
  ): Promise<FieldDefinitionRecord | null> {
    const row = await this.prisma.fieldDefinition.findUnique({
      where: { id },
      include: { options: { orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }] } },
    });
    if (!row || (!includeArchived && row.archivedAt)) return null;
    return toDefinitionRecord(row, true);
  }

  async createDefinition(
    input: CreateFieldDefinitionInput,
    metadata: SchemaMutationMetadata = { actorId: null },
  ): Promise<FieldDefinitionRecord> {
    const scope = validateScope(input.scope);
    const dataType = validateDataType(input.dataType);
    const repeatable = validateRepeatable(dataType, input.repeatable ?? false);
    const validation = normalizeValidationRules(dataType, input.validation);
    const shape: FieldValueShape = {
      key: validateFieldKey(input.key, 'SCHEMA_FIELD_INVALID_KEY'),
      dataType,
      repeatable,
      required: input.required ?? false,
      validation,
    };
    // A select/multiselect default names an option that cannot exist before the definition does.
    const defaultValue = usesOptions(dataType)
      ? assertNoOptionDefault(input.defaultValue)
      : normalizeDefaultValue(shape, input.defaultValue);
    const categoryId = input.categoryId ?? null;
    return this.prisma.$transaction(async (transaction) => {
      if (categoryId) await this.requireActiveCategory(transaction, categoryId);
      const now = this.now();
      const row = await transaction.fieldDefinition.create({
        data: {
          id: randomUUID(),
          key: shape.key,
          scope,
          categoryId,
          labelI18n: toJson(normalizeLocalizedText(input.labels)),
          helpI18n: jsonOrDbNull(normalizeOptionalLocalizedText(input.help)),
          dataType,
          required: shape.required,
          repeatable,
          searchable: input.searchable ?? false,
          filterable: input.filterable ?? false,
          sortable: input.sortable ?? false,
          visibility: validateVisibility(input.visibility ?? 'authenticated'),
          unit: normalizeUnit(input.unit),
          defaultValueJson:
            defaultValue === null ? Prisma.DbNull : (defaultValue as Prisma.InputJsonValue),
          validationJson: validation as Prisma.InputJsonObject,
          displayOrder: validateDisplayOrder(input.displayOrder ?? 0),
          createdAt: now,
          updatedAt: now,
        },
        include: { options: true },
      });
      const record = toDefinitionRecord(row, true);
      await this.audit(transaction, metadata, 'schema.field-definition.created', null, record, now);
      return record;
    });
  }

  async updateDefinition(
    id: string,
    expectedVersion: number,
    input: UpdateFieldDefinitionInput,
    metadata: SchemaMutationMetadata = { actorId: null },
  ): Promise<FieldDefinitionMutation> {
    const version = validateExpectedVersion(expectedVersion);
    return this.prisma.$transaction(async (transaction) => {
      const beforeRow = await transaction.fieldDefinition.findUnique({
        where: { id },
        include: { options: { orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }] } },
      });
      if (!beforeRow || beforeRow.archivedAt) throw missingDefinition();
      const before = toDefinitionRecord(beforeRow, true);
      const dataType =
        input.dataType === undefined ? before.dataType : validateDataType(input.dataType);
      if (dataType !== before.dataType)
        await this.requireConvertibleWithoutData(transaction, before, dataType);
      const repeatable = validateRepeatable(
        dataType,
        input.repeatable === undefined ? before.repeatable : input.repeatable,
      );
      const validation =
        input.validation === undefined && dataType === before.dataType
          ? before.validation
          : normalizeValidationRules(dataType, input.validation ?? {});
      const required = input.required === undefined ? before.required : input.required;
      const shape: FieldValueShape = {
        key: before.key,
        dataType,
        repeatable,
        required,
        validation,
      };
      const defaultValue =
        input.defaultValue === undefined && dataType === before.dataType
          ? undefined
          : usesOptions(dataType)
            ? assertNoOptionDefault(input.defaultValue)
            : normalizeDefaultValue(shape, input.defaultValue ?? null);
      if (input.categoryId !== undefined && input.categoryId !== null)
        await this.requireActiveCategory(transaction, input.categoryId);

      const now = this.now();
      const data: Prisma.FieldDefinitionUncheckedUpdateManyInput = {
        updatedAt: now,
        version: { increment: 1 },
        dataType,
        repeatable,
        required,
        validationJson: validation as Prisma.InputJsonObject,
      };
      if (input.categoryId !== undefined) data.categoryId = input.categoryId;
      if (input.labels !== undefined) data.labelI18n = toJson(normalizeLocalizedText(input.labels));
      if (input.help !== undefined)
        data.helpI18n = jsonOrDbNull(normalizeOptionalLocalizedText(input.help));
      if (input.searchable !== undefined) data.searchable = input.searchable;
      if (input.filterable !== undefined) data.filterable = input.filterable;
      if (input.sortable !== undefined) data.sortable = input.sortable;
      if (input.visibility !== undefined) data.visibility = validateVisibility(input.visibility);
      if (input.unit !== undefined) data.unit = normalizeUnit(input.unit);
      if (defaultValue !== undefined)
        data.defaultValueJson =
          defaultValue === null ? Prisma.DbNull : (defaultValue as Prisma.InputJsonValue);
      if (input.displayOrder !== undefined)
        data.displayOrder = validateDisplayOrder(input.displayOrder);

      const [row] = await transaction.fieldDefinition.updateManyAndReturn({
        where: { id, version: BigInt(version), archivedAt: null },
        data,
      });
      if (!row) return this.throwMissingOrConflict(transaction, id, version);
      const after = toDefinitionRecord({ ...row, options: beforeRow.options }, true);
      await this.audit(
        transaction,
        metadata,
        'schema.field-definition.updated',
        before,
        after,
        now,
      );
      const reindex = reindexWarning(before, after);
      if (reindex.massReindexRequired)
        await this.enqueueRebuild(transaction, after, reindex.reasons, now);
      return { definition: after, reindex };
    });
  }

  async archiveDefinition(
    id: string,
    expectedVersion: number,
    metadata: SchemaMutationMetadata = { actorId: null },
  ): Promise<FieldDefinitionMutation> {
    const version = validateExpectedVersion(expectedVersion);
    return this.prisma.$transaction(async (transaction) => {
      const beforeRow = await transaction.fieldDefinition.findUnique({
        where: { id },
        include: { options: { orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }] } },
      });
      if (!beforeRow || beforeRow.archivedAt) throw missingDefinition();
      const now = this.now();
      const [row] = await transaction.fieldDefinition.updateManyAndReturn({
        where: { id, version: BigInt(version), archivedAt: null },
        data: { archivedAt: now, updatedAt: now, version: { increment: 1 } },
      });
      if (!row) return this.throwMissingOrConflict(transaction, id, version);
      const before = toDefinitionRecord(beforeRow, true);
      const after = toDefinitionRecord({ ...row, options: beforeRow.options }, true);
      await this.audit(
        transaction,
        metadata,
        'schema.field-definition.archived',
        before,
        after,
        now,
      );
      const reindex: ReindexWarning = {
        massReindexRequired: true,
        reasons: ['archived'],
        topic: 'search.rebuild-items.v1',
      };
      await this.enqueueRebuild(transaction, after, reindex.reasons, now);
      return { definition: after, reindex };
    });
  }

  async createOption(
    definitionId: string,
    expectedVersion: number,
    input: { key: string; labels: unknown; displayOrder?: number },
    metadata: SchemaMutationMetadata = { actorId: null },
  ): Promise<FieldDefinitionRecord> {
    const version = validateExpectedVersion(expectedVersion);
    const key = validateFieldKey(input.key, 'SCHEMA_OPTION_INVALID_KEY');
    const labels = normalizeLocalizedText(input.labels);
    const displayOrder = validateDisplayOrder(input.displayOrder ?? 0);
    return this.prisma.$transaction(async (transaction) => {
      const definition = await this.requireOptionOwner(transaction, definitionId);
      const now = this.now();
      const option = await transaction.fieldOption.create({
        data: {
          id: randomUUID(),
          fieldDefinitionId: definitionId,
          key,
          labelI18n: toJson(labels),
          displayOrder,
          createdAt: now,
          updatedAt: now,
        },
      });
      const after = await this.bumpDefinition(transaction, definitionId, version, now);
      await this.auditOption(
        transaction,
        metadata,
        'schema.field-option.created',
        after,
        null,
        toOptionRecord(option),
        now,
      );
      // A new option adds no existing value, so no vector rebuild is required.
      void definition;
      return after;
    });
  }

  async updateOption(
    definitionId: string,
    optionId: string,
    expectedVersion: number,
    input: { labels?: unknown; displayOrder?: number },
    metadata: SchemaMutationMetadata = { actorId: null },
  ): Promise<FieldDefinitionRecord> {
    const version = validateExpectedVersion(expectedVersion);
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.fieldOption.findUnique({ where: { id: optionId } });
      if (!existing || existing.fieldDefinitionId !== definitionId || existing.archivedAt)
        throw new SchemaPolicyError('SCHEMA_OPTION_NOT_FOUND', 'The field option was not found.');
      const now = this.now();
      const data: Prisma.FieldOptionUpdateManyMutationInput = { updatedAt: now };
      if (input.labels !== undefined) data.labelI18n = toJson(normalizeLocalizedText(input.labels));
      if (input.displayOrder !== undefined)
        data.displayOrder = validateDisplayOrder(input.displayOrder);
      const [option] = await transaction.fieldOption.updateManyAndReturn({
        where: { id: optionId, fieldDefinitionId: definitionId, archivedAt: null },
        data,
      });
      if (!option)
        throw new SchemaPolicyError('SCHEMA_OPTION_NOT_FOUND', 'The field option was not found.');
      const before = toOptionRecord(existing);
      const after = toOptionRecord(option);
      const definition = await this.bumpDefinition(transaction, definitionId, version, now);
      await this.auditOption(
        transaction,
        metadata,
        'schema.field-option.updated',
        definition,
        before,
        after,
        now,
      );
      if (!sameLabels(before.labels, after.labels))
        await this.enqueueOptionLabelChange(transaction, definition, after, now);
      return definition;
    });
  }

  async archiveOption(
    definitionId: string,
    optionId: string,
    expectedVersion: number,
    metadata: SchemaMutationMetadata = { actorId: null },
  ): Promise<FieldDefinitionRecord> {
    const version = validateExpectedVersion(expectedVersion);
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.fieldOption.findUnique({ where: { id: optionId } });
      if (!existing || existing.fieldDefinitionId !== definitionId || existing.archivedAt)
        throw new SchemaPolicyError('SCHEMA_OPTION_NOT_FOUND', 'The field option was not found.');
      const now = this.now();
      const [option] = await transaction.fieldOption.updateManyAndReturn({
        where: { id: optionId, fieldDefinitionId: definitionId, archivedAt: null },
        data: { archivedAt: now, updatedAt: now },
      });
      if (!option)
        throw new SchemaPolicyError('SCHEMA_OPTION_NOT_FOUND', 'The field option was not found.');
      const definition = await this.bumpDefinition(transaction, definitionId, version, now);
      await this.auditOption(
        transaction,
        metadata,
        'schema.field-option.archived',
        definition,
        toOptionRecord(existing),
        toOptionRecord(option),
        now,
      );
      return definition;
    });
  }

  /**
   * Impact analysis for a controlled type change. It inspects stored values through the same
   * canonical serializer a conversion would use and reports counts and issue codes only, never
   * a stored value.
   */
  async previewTypeConversion(id: string, targetDataType: unknown): Promise<ConversionPreview> {
    const target = validateDataType(targetDataType);
    const definition = await this.findDefinitionById(id);
    if (!definition) throw missingDefinition();
    const totalValues = await this.prisma.attributeValue.count({
      where: { fieldDefinitionId: id },
    });
    const supported = conversionSupported(definition.dataType, target);
    const base = {
      fieldDefinitionId: definition.id,
      fieldKey: definition.key,
      currentDataType: definition.dataType,
      targetDataType: target,
      supported,
      lossless: supported && conversionLossless(definition.dataType, target),
      totalValues,
      requiresBackgroundConversion: supported && totalValues > 0,
      reindexRequired: totalValues > 0,
    };
    if (!supported || totalValues === 0) {
      return {
        ...base,
        analyzedValues: 0,
        convertibleValues: 0,
        blockingValues: supported ? 0 : totalValues,
        truncated: false,
        blockingIssues: supported ? [] : ['TYPE_MISMATCH'],
      };
    }
    const rows = await this.prisma.attributeValue.findMany({
      where: { fieldDefinitionId: id },
      select: {
        valueText: true,
        valueNumber: true,
        valueBoolean: true,
        valueDate: true,
        valueDatetime: true,
        valueOptionId: true,
        valueMoneyAmount: true,
        valueMoneyCurrency: true,
      },
      orderBy: [{ itemId: 'asc' }, { storageNodeId: 'asc' }, { position: 'asc' }],
      take: conversionAnalysisLimit,
    });
    const shape: FieldValueShape = {
      key: definition.key,
      dataType: target,
      repeatable: false,
      required: false,
      validation: {},
    };
    const blockingIssues = new Set<AttributeIssueCode>();
    let convertible = 0;
    for (const row of rows) {
      const source = renderStoredValue(definition, row);
      try {
        canonicalizeFieldValues(shape, source);
        convertible += 1;
      } catch (error) {
        blockingIssues.add(
          error instanceof AttributeValidationError && error.issues[0]
            ? error.issues[0].code
            : 'TYPE_MISMATCH',
        );
      }
    }
    return {
      ...base,
      analyzedValues: rows.length,
      convertibleValues: convertible,
      blockingValues: rows.length - convertible,
      truncated: totalValues > rows.length,
      blockingIssues: [...blockingIssues],
    };
  }

  /** General attribute reads stay Prisma-owned; writes belong to `AttributeValuePort`. */
  async readAttributeValues(
    owner: AttributeOwner,
  ): Promise<{ definition: FieldDefinitionRecord; values: CanonicalFieldValue[] }[]> {
    const rows = await this.prisma.attributeValue.findMany({
      where:
        owner.kind === 'item' ? { itemId: owner.id } : { storageNodeId: owner.id, itemId: null },
      orderBy: [{ fieldDefinitionId: 'asc' }, { position: 'asc' }],
      include: { definition: { include: { options: true } } },
    });
    const grouped = new Map<
      string,
      { definition: FieldDefinitionRecord; values: CanonicalFieldValue[] }
    >();
    for (const row of rows) {
      const entry = grouped.get(row.fieldDefinitionId) ?? {
        definition: toDefinitionRecord(row.definition, true),
        values: [],
      };
      if (row.position !== entry.values.length)
        throw new AttributeValidationError([
          { fieldKey: entry.definition.key, code: 'NON_CONTIGUOUS_POSITION' },
        ]);
      entry.values.push(storedCanonicalValue(row));
      grouped.set(row.fieldDefinitionId, entry);
    }
    return [...grouped.values()];
  }

  private async bumpDefinition(
    transaction: Prisma.TransactionClient,
    id: string,
    expectedVersion: number,
    now: Date,
  ): Promise<FieldDefinitionRecord> {
    const [row] = await transaction.fieldDefinition.updateManyAndReturn({
      where: { id, version: BigInt(expectedVersion), archivedAt: null },
      data: { updatedAt: now, version: { increment: 1 } },
    });
    if (!row) return this.throwMissingOrConflict(transaction, id, expectedVersion);
    const options = await transaction.fieldOption.findMany({
      where: { fieldDefinitionId: id },
      orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }],
    });
    return toDefinitionRecord({ ...row, options }, true);
  }

  private async requireOptionOwner(
    client: SchemaReadClient,
    id: string,
  ): Promise<FieldDefinitionRecord> {
    const row = await client.fieldDefinition.findUnique({
      where: { id },
      include: { options: true },
    });
    if (!row || row.archivedAt) throw missingDefinition();
    const definition = toDefinitionRecord(row, true);
    if (!usesOptions(definition.dataType))
      throw new SchemaPolicyError(
        'SCHEMA_OPTION_NOT_SUPPORTED',
        'Only select and multiselect definitions own options.',
      );
    return definition;
  }

  private async requireActiveCategory(client: SchemaReadClient, id: string): Promise<void> {
    const category = await client.category.findUnique({
      where: { id },
      select: { archivedAt: true },
    });
    if (!category || category.archivedAt)
      throw new SchemaPolicyError(
        'SCHEMA_FIELD_CATEGORY_INVALID',
        'Field applicability requires an active category.',
      );
  }

  private async requireConvertibleWithoutData(
    client: SchemaReadClient,
    before: FieldDefinitionRecord,
    target: FieldDataType,
  ): Promise<void> {
    if (!conversionSupported(before.dataType, target))
      throw new SchemaPolicyError(
        'SCHEMA_FIELD_CONVERSION_UNSUPPORTED',
        `Converting ${before.dataType} to ${target} is not supported.`,
      );
    if (usesOptions(before.dataType) && !usesOptions(target)) {
      const active = before.options.filter((option) => !option.archivedAt);
      if (active.length)
        throw new SchemaPolicyError(
          'SCHEMA_FIELD_CONVERSION_UNSUPPORTED',
          'Archive the remaining options before leaving an option data type.',
        );
    }
    const values = await client.attributeValue.count({
      where: { fieldDefinitionId: before.id },
    });
    if (values > 0)
      throw new SchemaPolicyError(
        'SCHEMA_FIELD_CONVERSION_REQUIRED',
        'Existing values require a conversion preview and plan before the data type changes.',
      );
  }

  private async throwMissingOrConflict(
    client: SchemaReadClient,
    id: string,
    expectedVersion: number,
  ): Promise<never> {
    const row = await client.fieldDefinition.findUnique({
      where: { id },
      select: { version: true, archivedAt: true },
    });
    if (!row || row.archivedAt) throw missingDefinition();
    throw new SchemaPolicyError(
      'SCHEMA_FIELD_VERSION_CONFLICT',
      `Expected version ${expectedVersion} but found ${row.version.toString()}.`,
    );
  }

  private audit(
    transaction: Prisma.TransactionClient,
    metadata: SchemaMutationMetadata,
    action: string,
    before: FieldDefinitionRecord | null,
    after: FieldDefinitionRecord,
    createdAt: Date,
  ): Promise<void> {
    return this.auditPort.record(
      { kind: 'prisma', trx: transaction },
      {
        actorId: metadata.actorId,
        action,
        entityType: 'field_definition',
        entityId: after.id,
        ...(metadata.correlationId === undefined ? {} : { correlationId: metadata.correlationId }),
        ...(metadata.requestId === undefined ? {} : { requestId: metadata.requestId }),
        before: before ? definitionSnapshot(before) : null,
        after: definitionSnapshot(after),
        createdAt,
      },
    );
  }

  private auditOption(
    transaction: Prisma.TransactionClient,
    metadata: SchemaMutationMetadata,
    action: string,
    definition: FieldDefinitionRecord,
    before: FieldOptionRecord | null,
    after: FieldOptionRecord,
    createdAt: Date,
  ): Promise<void> {
    return this.auditPort.record(
      { kind: 'prisma', trx: transaction },
      {
        actorId: metadata.actorId,
        action,
        entityType: 'field_option',
        entityId: after.id,
        ...(metadata.correlationId === undefined ? {} : { correlationId: metadata.correlationId }),
        ...(metadata.requestId === undefined ? {} : { requestId: metadata.requestId }),
        before: before ? optionSnapshot(definition, before) : null,
        after: optionSnapshot(definition, after),
        createdAt,
      },
    );
  }

  private enqueueRebuild(
    transaction: Prisma.TransactionClient,
    definition: FieldDefinitionRecord,
    reasons: readonly ReindexReason[],
    createdAt: Date,
  ): Promise<void> {
    return this.outboxPort.enqueue(
      { kind: 'prisma', trx: transaction },
      {
        topic: 'search.rebuild-items.v1',
        aggregateType: 'field_definition',
        aggregateId: definition.id,
        payload: {
          event: 'FieldDefinitionChanged',
          payloadVersion: 1,
          fieldDefinitionId: definition.id,
          fieldKey: definition.key,
          scope: definition.scope,
          definitionVersion: definition.version,
          reasons: [...reasons],
        },
        deduplicationKey: `field-definition-changed:${definition.id}:v${definition.version}`,
        createdAt,
      },
    );
  }

  private enqueueOptionLabelChange(
    transaction: Prisma.TransactionClient,
    definition: FieldDefinitionRecord,
    option: FieldOptionRecord,
    createdAt: Date,
  ): Promise<void> {
    return this.outboxPort.enqueue(
      { kind: 'prisma', trx: transaction },
      {
        topic: 'search.rebuild-items.v1',
        aggregateType: 'field_option',
        aggregateId: option.id,
        payload: {
          event: 'FieldOptionLabelChanged',
          payloadVersion: 1,
          fieldDefinitionId: definition.id,
          fieldOptionId: option.id,
          fieldKey: definition.key,
          optionKey: option.key,
          definitionVersion: definition.version,
        },
        deduplicationKey: `field-option-label-changed:${option.id}:v${definition.version}`,
        createdAt,
      },
    );
  }
}

export function reindexWarning(
  before: FieldDefinitionRecord,
  after: FieldDefinitionRecord,
): ReindexWarning {
  const reasons: ReindexReason[] = [];
  if (before.visibility !== after.visibility) reasons.push('visibility');
  if (before.searchable !== after.searchable) reasons.push('searchable');
  if (before.filterable !== after.filterable) reasons.push('filterable');
  if (before.sortable !== after.sortable) reasons.push('sortable');
  if (!sameLabels(before.labels, after.labels)) reasons.push('labels');
  if (!before.archivedAt && after.archivedAt) reasons.push('archived');
  return { massReindexRequired: reasons.length > 0, reasons, topic: 'search.rebuild-items.v1' };
}

/**
 * Conversions into `select`, `multiselect` or `money` need new options or a target currency and
 * therefore an explicit plan beyond a preview; `reference` never converts.
 */
export function conversionSupported(current: FieldDataType, target: FieldDataType): boolean {
  if (current === target) return false;
  if (current === 'reference' || target === 'reference') return false;
  if (optionTypes.includes(current) && optionTypes.includes(target)) return true;
  if (optionTypes.includes(target) || target === 'money') return false;
  if (textTypes.includes(target)) return true;
  if (!textTypes.includes(current)) return dateFamilyConversion(current, target);
  return true;
}

function dateFamilyConversion(current: FieldDataType, target: FieldDataType): boolean {
  return (
    (current === 'date' && target === 'datetime') || (current === 'datetime' && target === 'date')
  );
}

export function conversionLossless(current: FieldDataType, target: FieldDataType): boolean {
  if (textTypes.includes(current) && textTypes.includes(target))
    return target === 'text' || target === 'long_text';
  if (optionTypes.includes(current) && optionTypes.includes(target))
    return target === 'multiselect';
  if (current === 'date' && target === 'datetime') return true;
  return !textTypes.includes(current) && textTypes.includes(target) && current !== 'money';
}

type StoredValueRow = {
  valueText?: string | null;
  valueNumber?: Prisma.Decimal | null;
  valueBoolean?: boolean | null;
  valueDate?: Date | null;
  valueDatetime?: Date | null;
  valueOptionId?: string | null;
  valueMoneyAmount?: Prisma.Decimal | null;
  valueMoneyCurrency?: string | null;
  valueReferenceItemId?: string | null;
  valueReferenceNodeId?: string | null;
};

/** Renders a stored row as the API-shaped source a conversion would re-canonicalize. */
function renderStoredValue(definition: FieldDefinitionRecord, row: StoredValueRow): unknown {
  if (row.valueText != null) return row.valueText;
  if (row.valueNumber != null) return row.valueNumber.toString();
  if (row.valueBoolean != null) return String(row.valueBoolean);
  if (row.valueDate != null) return row.valueDate.toISOString().slice(0, 10);
  if (row.valueDatetime != null) return row.valueDatetime.toISOString();
  if (row.valueMoneyAmount != null)
    return `${row.valueMoneyAmount.toString()} ${row.valueMoneyCurrency ?? ''}`.trim();
  if (row.valueOptionId != null)
    return definition.options.find((option) => option.id === row.valueOptionId)?.key ?? '';
  return '';
}

function storedCanonicalValue(row: {
  valueText: string | null;
  valueNumber: Prisma.Decimal | null;
  valueBoolean: boolean | null;
  valueDate: Date | null;
  valueDatetime: Date | null;
  valueOptionId: string | null;
  valueMoneyAmount: Prisma.Decimal | null;
  valueMoneyCurrency: string | null;
  valueReferenceItemId: string | null;
  valueReferenceNodeId: string | null;
}): CanonicalFieldValue {
  if (row.valueText != null) return { slot: 'text', text: row.valueText };
  if (row.valueNumber != null) return { slot: 'number', number: row.valueNumber.toString() };
  if (row.valueBoolean != null) return { slot: 'boolean', boolean: row.valueBoolean };
  if (row.valueDate != null)
    return { slot: 'date', date: row.valueDate.toISOString().slice(0, 10) };
  if (row.valueDatetime != null)
    return { slot: 'datetime', datetime: row.valueDatetime.toISOString() };
  if (row.valueOptionId != null) return { slot: 'option', optionId: row.valueOptionId };
  if (row.valueMoneyAmount != null)
    return {
      slot: 'money',
      amount: row.valueMoneyAmount.toString(),
      currency: row.valueMoneyCurrency ?? '',
    };
  if (row.valueReferenceItemId != null)
    return { slot: 'referenceItem', itemId: row.valueReferenceItemId };
  return { slot: 'referenceNode', nodeId: row.valueReferenceNodeId! };
}

function assertNoOptionDefault(value: unknown): null {
  if (value === null || value === undefined) return null;
  throw new SchemaPolicyError(
    'SCHEMA_FIELD_INVALID_DEFAULT',
    'Select and multiselect definitions do not accept a stored default value.',
  );
}

function missingDefinition(): SchemaPolicyError {
  return new SchemaPolicyError('SCHEMA_FIELD_NOT_FOUND', 'The field definition was not found.');
}

function sameLabels(left: LocalizedText, right: LocalizedText): boolean {
  return left.en === right.en && left.uk === right.uk;
}

function toJson(text: LocalizedText): Prisma.InputJsonObject {
  return text.uk === undefined ? { en: text.en } : { en: text.en, uk: text.uk };
}

function jsonOrDbNull(text: LocalizedText | null): Prisma.InputJsonObject | typeof Prisma.DbNull {
  return text === null ? Prisma.DbNull : toJson(text);
}

/** Audit snapshots carry definition metadata only; a stored default value never enters audit. */
function definitionSnapshot(record: FieldDefinitionRecord): Record<string, unknown> {
  return {
    key: record.key,
    scope: record.scope,
    categoryId: record.categoryId,
    labels: record.labels,
    help: record.help,
    dataType: record.dataType,
    required: record.required,
    repeatable: record.repeatable,
    searchable: record.searchable,
    filterable: record.filterable,
    sortable: record.sortable,
    visibility: record.visibility,
    unit: record.unit,
    hasDefaultValue: record.defaultValue !== null,
    validation: record.validation,
    displayOrder: record.displayOrder,
    version: record.version,
    archivedAt: record.archivedAt?.toISOString() ?? null,
  };
}

function optionSnapshot(
  definition: FieldDefinitionRecord,
  record: FieldOptionRecord,
): Record<string, unknown> {
  return {
    fieldKey: definition.key,
    key: record.key,
    labels: record.labels,
    displayOrder: record.displayOrder,
    definitionVersion: definition.version,
    archivedAt: record.archivedAt?.toISOString() ?? null,
  };
}

interface DefinitionRowShape {
  id: string;
  key: string;
  scope: string;
  categoryId: string | null;
  labelI18n: unknown;
  helpI18n: unknown;
  dataType: string;
  required: boolean;
  repeatable: boolean;
  searchable: boolean;
  filterable: boolean;
  sortable: boolean;
  visibility: string;
  unit: string | null;
  defaultValueJson: unknown;
  validationJson: unknown;
  displayOrder: number;
  version: bigint;
  archivedAt: Date | null;
  options?: OptionRowShape[];
}

interface OptionRowShape {
  id: string;
  key: string;
  labelI18n: unknown;
  displayOrder: number;
  archivedAt: Date | null;
}

function toDefinitionRecord(
  row: DefinitionRowShape,
  includeArchivedOptions: boolean,
): FieldDefinitionRecord {
  const dataType = row.dataType as FieldDataType;
  const validation = normalizeValidationRules(dataType, row.validationJson);
  const shape: FieldValueShape = {
    key: row.key,
    dataType,
    repeatable: row.repeatable,
    required: row.required,
    validation,
  };
  const options = (row.options ?? [])
    .filter((option) => includeArchivedOptions || !option.archivedAt)
    .map(toOptionRecord)
    .toSorted(
      (left, right) => left.displayOrder - right.displayOrder || left.key.localeCompare(right.key),
    );
  return {
    id: row.id,
    key: row.key,
    scope: row.scope as FieldScope,
    categoryId: row.categoryId,
    labels: normalizeLocalizedText(row.labelI18n),
    help: normalizeOptionalLocalizedText(row.helpI18n),
    dataType,
    required: row.required,
    repeatable: row.repeatable,
    searchable: row.searchable,
    filterable: row.filterable,
    sortable: row.sortable,
    visibility: row.visibility as FieldVisibility,
    unit: row.unit,
    defaultValue: readStoredDefault(shape, row.defaultValueJson),
    validation,
    displayOrder: row.displayOrder,
    version: Number(row.version),
    archivedAt: row.archivedAt,
    options,
  };
}

function readStoredDefault(shape: FieldValueShape, value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  // Defaults always project as an ordered array so one contract shape covers every data type.
  return projectFieldValues(
    { ...shape, repeatable: true },
    value as CanonicalFieldValue[],
  ) as unknown[];
}

function toOptionRecord(row: OptionRowShape): FieldOptionRecord {
  return {
    id: row.id,
    key: row.key,
    labels: normalizeLocalizedText(row.labelI18n),
    displayOrder: row.displayOrder,
    archivedAt: row.archivedAt,
  };
}
