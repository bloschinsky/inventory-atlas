import { randomUUID } from 'node:crypto';
import { sql as kyselySql } from 'kysely';
import type { TransactionContext } from '../infrastructure/index.js';
import {
  AttributeValidationError,
  normalizeValidationRules,
  validateCanonicalValues,
  valueSlotsFor,
  type AttributeIssue,
  type CanonicalFieldValue,
  type FieldDataType,
  type FieldScope,
  type FieldValueShape,
  type ValidationRules,
} from './field-policy.js';

export interface AttributeOwner {
  kind: 'item' | 'storageNode';
  id: string;
}

export interface AttributeValueAssignment {
  fieldDefinitionId: string;
  values: readonly CanonicalFieldValue[];
}

export interface ReplaceAttributeValues {
  owner: AttributeOwner;
  /** Category applicability of the owning aggregate; `null` uses only scope-wide definitions. */
  categoryId: string | null;
  assignments: readonly AttributeValueAssignment[];
  now: Date;
}

export interface AttributeValuePort {
  replace<Database>(
    context: TransactionContext<Database>,
    command: ReplaceAttributeValues,
  ): Promise<void>;
}

export interface ApplicableFieldDefinition extends FieldValueShape {
  id: string;
}

export interface FieldOptionMembership {
  id: string;
  fieldDefinitionId: string;
  archived: boolean;
}

export interface PlannedAttributeRow {
  id: string;
  fieldDefinitionId: string;
  position: number;
  valueText: string | null;
  valueNumber: string | null;
  valueBoolean: boolean | null;
  valueDate: string | null;
  valueDatetime: string | null;
  valueOptionId: string | null;
  valueMoneyAmount: string | null;
  valueMoneyCurrency: string | null;
  valueReferenceItemId: string | null;
  valueReferenceNodeId: string | null;
}

export function scopeForOwner(owner: AttributeOwner): FieldScope {
  return owner.kind === 'item' ? 'item' : 'storage_node';
}

/**
 * Builds the canonical row set for one owner. Positions are assigned from the supplied order, so
 * stored positions are always contiguous from zero and multiselect can only be ordered scalar
 * option rows. Every validation failure reports the stable field key.
 */
export function planAttributeRows(
  command: ReplaceAttributeValues,
  definitions: readonly ApplicableFieldDefinition[],
  options: readonly FieldOptionMembership[],
  newId: () => string = randomUUID,
): PlannedAttributeRow[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const optionsById = new Map(options.map((option) => [option.id, option]));
  const issues: AttributeIssue[] = [];
  const supplied = new Map<string, readonly CanonicalFieldValue[]>();
  const rows: PlannedAttributeRow[] = [];

  for (const assignment of command.assignments) {
    const definition = byId.get(assignment.fieldDefinitionId);
    if (!definition) {
      issues.push({ fieldKey: assignment.fieldDefinitionId, code: 'UNKNOWN_FIELD' });
      continue;
    }
    if (supplied.has(definition.id)) {
      issues.push({ fieldKey: definition.key, code: 'NOT_REPEATABLE' });
      continue;
    }
    supplied.set(definition.id, assignment.values);
    issues.push(...validateCanonicalValues(definition, assignment.values));
    assignment.values.forEach((value, position) => {
      if (!valueSlotsFor(definition.dataType).includes(value.slot)) return;
      if (value.slot === 'option') {
        const option = optionsById.get(value.optionId);
        if (!option || option.fieldDefinitionId !== definition.id)
          issues.push({ fieldKey: definition.key, code: 'UNKNOWN_OPTION' });
        else if (option.archived)
          issues.push({ fieldKey: definition.key, code: 'ARCHIVED_OPTION' });
      }
      rows.push(plannedRow(newId(), definition.id, position, value));
    });
  }

  for (const definition of definitions) {
    if (definition.required && !supplied.get(definition.id)?.length)
      issues.push({ fieldKey: definition.key, code: 'REQUIRED' });
  }

  if (issues.length) throw new AttributeValidationError(unique(issues));
  return rows;
}

function plannedRow(
  id: string,
  fieldDefinitionId: string,
  position: number,
  value: CanonicalFieldValue,
): PlannedAttributeRow {
  return {
    id,
    fieldDefinitionId,
    position,
    valueText: value.slot === 'text' ? value.text : null,
    valueNumber: value.slot === 'number' ? value.number : null,
    valueBoolean: value.slot === 'boolean' ? value.boolean : null,
    valueDate: value.slot === 'date' ? value.date : null,
    valueDatetime: value.slot === 'datetime' ? value.datetime : null,
    valueOptionId: value.slot === 'option' ? value.optionId : null,
    valueMoneyAmount: value.slot === 'money' ? value.amount : null,
    valueMoneyCurrency: value.slot === 'money' ? value.currency : null,
    valueReferenceItemId: value.slot === 'referenceItem' ? value.itemId : null,
    valueReferenceNodeId: value.slot === 'referenceNode' ? value.nodeId : null,
  };
}

function unique(issues: readonly AttributeIssue[]): AttributeIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.fieldKey}:${issue.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface DefinitionRow {
  id: string;
  key: string;
  data_type: string;
  required: boolean;
  repeatable: boolean;
  validation_json: unknown;
}

interface OptionRow {
  id: string;
  field_definition_id: string;
  archived: boolean;
}

/**
 * Writes only `attribute_values` inside the supplied source transaction. It never opens a
 * transaction, never returns a Schema domain row, and exposes no Schema repository. The Prisma
 * and Kysely branches run the same parameterized statements; the integration parity suite
 * asserts that both produce identical rows.
 */
export class TransactionalAttributeValuePort implements AttributeValuePort {
  constructor(private readonly newId: () => string = randomUUID) {}

  async replace<Database>(
    context: TransactionContext<Database>,
    command: ReplaceAttributeValues,
  ): Promise<void> {
    const scope = scopeForOwner(command.owner);
    const definitions = (await this.definitions(context, scope, command.categoryId)).map(
      toApplicableDefinition,
    );
    const options = (await this.options(context, scope, command.categoryId)).map(toMembership);
    const rows = planAttributeRows(command, definitions, options, this.newId);
    await this.deleteOwnerRows(context, command.owner);
    for (const row of rows) await this.insertRow(context, command, row);
  }

  private async definitions<Database>(
    context: TransactionContext<Database>,
    scope: FieldScope,
    categoryId: string | null,
  ): Promise<DefinitionRow[]> {
    if (context.kind === 'prisma') {
      return context.trx.$queryRaw<DefinitionRow[]>`
        select id, key, data_type, required, repeatable, validation_json
          from field_definitions
          where scope = ${scope}
            and archived_at is null
            and (category_id is null or category_id = ${categoryId}::uuid)
          order by display_order, key
      `;
    }
    const { rows } = await kyselySql<DefinitionRow>`
      select id, key, data_type, required, repeatable, validation_json
        from field_definitions
        where scope = ${scope}
          and archived_at is null
          and (category_id is null or category_id = ${categoryId}::uuid)
        order by display_order, key
    `.execute(context.trx);
    return rows;
  }

  private async options<Database>(
    context: TransactionContext<Database>,
    scope: FieldScope,
    categoryId: string | null,
  ): Promise<OptionRow[]> {
    if (context.kind === 'prisma') {
      return context.trx.$queryRaw<OptionRow[]>`
        select option.id, option.field_definition_id, (option.archived_at is not null) as archived
          from field_options option
          join field_definitions definition on definition.id = option.field_definition_id
          where definition.scope = ${scope}
            and definition.archived_at is null
            and definition.data_type in ('select', 'multiselect')
            and (definition.category_id is null or definition.category_id = ${categoryId}::uuid)
      `;
    }
    const { rows } = await kyselySql<OptionRow>`
      select option.id, option.field_definition_id, (option.archived_at is not null) as archived
        from field_options option
        join field_definitions definition on definition.id = option.field_definition_id
        where definition.scope = ${scope}
          and definition.archived_at is null
          and definition.data_type in ('select', 'multiselect')
          and (definition.category_id is null or definition.category_id = ${categoryId}::uuid)
    `.execute(context.trx);
    return rows;
  }

  private async deleteOwnerRows<Database>(
    context: TransactionContext<Database>,
    owner: AttributeOwner,
  ): Promise<void> {
    const itemId = owner.kind === 'item' ? owner.id : null;
    const nodeId = owner.kind === 'storageNode' ? owner.id : null;
    if (context.kind === 'prisma') {
      await context.trx.$executeRaw`
        delete from attribute_values
          where item_id is not distinct from ${itemId}::uuid
            and storage_node_id is not distinct from ${nodeId}::uuid
      `;
      return;
    }
    await kyselySql`
      delete from attribute_values
        where item_id is not distinct from ${itemId}::uuid
          and storage_node_id is not distinct from ${nodeId}::uuid
    `.execute(context.trx);
  }

  private async insertRow<Database>(
    context: TransactionContext<Database>,
    command: ReplaceAttributeValues,
    row: PlannedAttributeRow,
  ): Promise<void> {
    const itemId = command.owner.kind === 'item' ? command.owner.id : null;
    const nodeId = command.owner.kind === 'storageNode' ? command.owner.id : null;
    const now = command.now;
    if (context.kind === 'prisma') {
      await context.trx.$executeRaw`
        insert into attribute_values (
          id, field_definition_id, item_id, storage_node_id, "position",
          value_text, value_number, value_boolean, value_date, value_datetime,
          value_option_id, value_money_amount, value_money_currency,
          value_reference_item_id, value_reference_node_id, created_at, updated_at
        ) values (
          ${row.id}::uuid, ${row.fieldDefinitionId}::uuid, ${itemId}::uuid, ${nodeId}::uuid,
          ${row.position}, ${row.valueText}, ${row.valueNumber}::numeric,
          ${row.valueBoolean}::boolean, ${row.valueDate}::date, ${row.valueDatetime}::timestamptz,
          ${row.valueOptionId}::uuid, ${row.valueMoneyAmount}::numeric,
          ${row.valueMoneyCurrency}::char(3), ${row.valueReferenceItemId}::uuid,
          ${row.valueReferenceNodeId}::uuid, ${now}, ${now}
        )
      `;
      return;
    }
    await kyselySql`
      insert into attribute_values (
        id, field_definition_id, item_id, storage_node_id, "position",
        value_text, value_number, value_boolean, value_date, value_datetime,
        value_option_id, value_money_amount, value_money_currency,
        value_reference_item_id, value_reference_node_id, created_at, updated_at
      ) values (
        ${row.id}::uuid, ${row.fieldDefinitionId}::uuid, ${itemId}::uuid, ${nodeId}::uuid,
        ${row.position}, ${row.valueText}, ${row.valueNumber}::numeric,
        ${row.valueBoolean}::boolean, ${row.valueDate}::date, ${row.valueDatetime}::timestamptz,
        ${row.valueOptionId}::uuid, ${row.valueMoneyAmount}::numeric,
        ${row.valueMoneyCurrency}::char(3), ${row.valueReferenceItemId}::uuid,
        ${row.valueReferenceNodeId}::uuid, ${now}, ${now}
      )
    `.execute(context.trx);
  }
}

function toApplicableDefinition(row: DefinitionRow): ApplicableFieldDefinition {
  const dataType = row.data_type as FieldDataType;
  return {
    id: row.id,
    key: row.key,
    dataType,
    required: row.required,
    repeatable: row.repeatable,
    validation: readValidation(dataType, row.validation_json),
  };
}

function toMembership(row: OptionRow): FieldOptionMembership {
  return { id: row.id, fieldDefinitionId: row.field_definition_id, archived: row.archived };
}

/** Stored rules were normalized on write; a stored rule that no longer applies is ignored. */
function readValidation(dataType: FieldDataType, value: unknown): ValidationRules {
  try {
    return normalizeValidationRules(dataType, value);
  } catch {
    return {};
  }
}
