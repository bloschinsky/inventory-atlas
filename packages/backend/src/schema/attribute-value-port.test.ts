import { describe, expect, it } from 'vitest';
import {
  planAttributeRows,
  scopeForOwner,
  type ApplicableFieldDefinition,
  type FieldOptionMembership,
  type ReplaceAttributeValues,
} from './attribute-value-port.js';
import { AttributeValidationError, type CanonicalFieldValue } from './field-policy.js';

const itemId = '00000000-0000-4000-8000-000000000001';
const nodeId = '00000000-0000-4000-8000-000000000002';
const serialId = '10000000-0000-4000-8000-000000000001';
const authorId = '10000000-0000-4000-8000-000000000002';
const materialsId = '10000000-0000-4000-8000-000000000003';
const quantityId = '10000000-0000-4000-8000-000000000004';
const metalId = '20000000-0000-4000-8000-000000000001';
const plasticId = '20000000-0000-4000-8000-000000000002';
const woodId = '20000000-0000-4000-8000-000000000003';
const foreignId = '20000000-0000-4000-8000-000000000004';

const definitions: ApplicableFieldDefinition[] = [
  {
    id: serialId,
    key: 'serial_number',
    dataType: 'text',
    repeatable: false,
    required: false,
    validation: {},
  },
  {
    id: authorId,
    key: 'author',
    dataType: 'text',
    repeatable: true,
    required: false,
    validation: {},
  },
  {
    id: materialsId,
    key: 'materials',
    dataType: 'multiselect',
    repeatable: false,
    required: false,
    validation: {},
  },
  {
    id: quantityId,
    key: 'quantity',
    dataType: 'number',
    repeatable: false,
    required: true,
    validation: { min: '0', integer: true },
  },
];

const options: FieldOptionMembership[] = [
  { id: metalId, fieldDefinitionId: materialsId, archived: false },
  { id: plasticId, fieldDefinitionId: materialsId, archived: false },
  { id: woodId, fieldDefinitionId: materialsId, archived: true },
  { id: foreignId, fieldDefinitionId: serialId, archived: false },
];

let sequence = 0;
function newId(): string {
  sequence += 1;
  return `30000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function command(
  assignments: ReplaceAttributeValues['assignments'],
  owner: ReplaceAttributeValues['owner'] = { kind: 'item', id: itemId },
): ReplaceAttributeValues {
  return { owner, categoryId: null, assignments, now: new Date('2026-09-09T10:00:00.000Z') };
}

function option(optionId: string): CanonicalFieldValue {
  return { slot: 'option', optionId };
}

function quantity(number = '1'): ReplaceAttributeValues['assignments'][number] {
  return { fieldDefinitionId: quantityId, values: [{ slot: 'number', number }] };
}

function plan(assignments: ReplaceAttributeValues['assignments']) {
  sequence = 0;
  return planAttributeRows(command(assignments), definitions, options, newId);
}

function issues(assignments: ReplaceAttributeValues['assignments']): string[] {
  try {
    plan(assignments);
    return [];
  } catch (error) {
    return error instanceof AttributeValidationError
      ? error.issues.map((issue) => `${issue.fieldKey}:${issue.code}`)
      : [String(error)];
  }
}

describe('CAT-02 attribute row planner', () => {
  it('derives the field scope from the owner kind', () => {
    expect(scopeForOwner({ kind: 'item', id: itemId })).toBe('item');
    expect(scopeForOwner({ kind: 'storageNode', id: nodeId })).toBe('storage_node');
  });

  it('writes one row per value with contiguous positions from zero', () => {
    const rows = plan([
      quantity('3'),
      {
        fieldDefinitionId: authorId,
        values: [
          { slot: 'text', text: 'Taras Shevchenko' },
          { slot: 'text', text: 'Ivan Franko' },
        ],
      },
    ]);
    expect(rows.map((row) => [row.fieldDefinitionId, row.position])).toEqual([
      [quantityId, 0],
      [authorId, 0],
      [authorId, 1],
    ]);
    expect(rows[0]).toMatchObject({ valueNumber: '3', valueText: null, valueOptionId: null });
    expect(rows[1]).toMatchObject({ valueText: 'Taras Shevchenko', valueNumber: null });
  });

  it('persists multiselect as ordered scalar option rows only', () => {
    const rows = plan([
      quantity(),
      { fieldDefinitionId: materialsId, values: [option(metalId), option(plasticId)] },
    ]);
    const selection = rows.filter((row) => row.fieldDefinitionId === materialsId);
    expect(selection.map((row) => [row.position, row.valueOptionId])).toEqual([
      [0, metalId],
      [1, plasticId],
    ]);
    for (const row of selection) {
      expect(row.valueText).toBeNull();
      expect(row.valueNumber).toBeNull();
      expect(Object.values(row).some((value) => Array.isArray(value))).toBe(false);
    }
  });

  it('rejects wrong-field, unknown, archived and duplicated options', () => {
    expect(
      issues([quantity(), { fieldDefinitionId: materialsId, values: [option(foreignId)] }]),
    ).toEqual(['materials:UNKNOWN_OPTION']);
    expect(
      issues([
        quantity(),
        {
          fieldDefinitionId: materialsId,
          values: [option('20000000-0000-4000-8000-000000000009')],
        },
      ]),
    ).toEqual(['materials:UNKNOWN_OPTION']);
    expect(
      issues([quantity(), { fieldDefinitionId: materialsId, values: [option(woodId)] }]),
    ).toEqual(['materials:ARCHIVED_OPTION']);
    expect(
      issues([
        quantity(),
        { fieldDefinitionId: materialsId, values: [option(metalId), option(metalId)] },
      ]),
    ).toEqual(['materials:DUPLICATE_OPTION']);
  });

  it('rejects unknown fields, repeated assignments and non-repeatable arrays', () => {
    expect(issues([quantity(), { fieldDefinitionId: nodeId, values: [] }])).toEqual([
      `${nodeId}:UNKNOWN_FIELD`,
    ]);
    expect(
      issues([
        quantity(),
        { fieldDefinitionId: serialId, values: [{ slot: 'text', text: 'a' }] },
        { fieldDefinitionId: serialId, values: [{ slot: 'text', text: 'b' }] },
      ]),
    ).toEqual(['serial_number:NOT_REPEATABLE']);
    expect(
      issues([
        quantity(),
        {
          fieldDefinitionId: serialId,
          values: [
            { slot: 'text', text: 'a' },
            { slot: 'text', text: 'b' },
          ],
        },
      ]),
    ).toEqual(['serial_number:NOT_REPEATABLE']);
  });

  it('reports every missing required field and failing rule by stable key', () => {
    expect(issues([])).toEqual(['quantity:REQUIRED']);
    expect(issues([{ fieldDefinitionId: quantityId, values: [] }])).toEqual(['quantity:REQUIRED']);
    expect(
      issues([{ fieldDefinitionId: quantityId, values: [{ slot: 'number', number: '-2.5' }] }]),
    ).toEqual(['quantity:NOT_INTEGER', 'quantity:OUT_OF_RANGE']);
    expect(
      issues([{ fieldDefinitionId: quantityId, values: [{ slot: 'text', text: 'many' }] }]),
    ).toEqual(['quantity:TYPE_MISMATCH']);
  });

  it('plans an empty row set when only optional fields are omitted', () => {
    expect(plan([quantity()]).length).toBe(1);
    expect(
      planAttributeRows(
        command([], { kind: 'storageNode', id: nodeId }),
        definitions.filter((definition) => !definition.required),
        options,
        newId,
      ),
    ).toEqual([]);
  });
});
