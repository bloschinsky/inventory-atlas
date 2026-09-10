import { describe, expect, it, vi } from 'vitest';
import { permissionsFor, type Role, type SessionActor } from '../auth/index.js';
import { FieldDefinitionService } from './field-definition-service.js';
import type { FieldDefinitionRepository } from './field-definition-repository.js';
import type { AttributeValuePort } from './attribute-value-port.js';

function actor(role: Role): SessionActor {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: `${role}@example.test`,
    displayName: 'Synthetic actor',
    locale: 'en',
    role,
    permissions: permissionsFor(role),
  };
}

const textField = {
  id: '10000000-0000-4000-8000-000000000001',
  key: 'serial_number',
  scope: 'item' as const,
  categoryId: null,
  labels: { en: 'Serial number', uk: 'Серійний номер' },
  help: null,
  dataType: 'text' as const,
  required: false,
  repeatable: true,
  searchable: true,
  filterable: true,
  sortable: false,
  visibility: 'authenticated' as const,
  unit: null,
  defaultValue: null,
  validation: {},
  displayOrder: 0,
  version: 1,
  archivedAt: null,
  options: [],
};

const forbidden = expect.objectContaining({ code: 'SCHEMA_FORBIDDEN' });
const owner = { kind: 'item' as const, id: '00000000-0000-4000-8000-000000000009' };

function harness() {
  const repository = {
    listDefinitions: vi.fn(async () => [textField]),
    findDefinitionById: vi.fn(async () => textField),
    createDefinition: vi.fn(async () => textField),
    updateDefinition: vi.fn(async () => ({
      definition: textField,
      reindex: { massReindexRequired: false, reasons: [], topic: 'search.rebuild-items.v1' },
    })),
    archiveDefinition: vi.fn(async () => ({
      definition: textField,
      reindex: {
        massReindexRequired: true,
        reasons: ['archived'],
        topic: 'search.rebuild-items.v1',
      },
    })),
    createOption: vi.fn(async () => textField),
    updateOption: vi.fn(async () => textField),
    archiveOption: vi.fn(async () => textField),
    previewTypeConversion: vi.fn(async () => ({ supported: true })),
    readAttributeValues: vi.fn(async () => [
      {
        definition: textField,
        values: [
          { slot: 'text', text: 'first' },
          { slot: 'text', text: 'second' },
        ],
      },
    ]),
  };
  const attributeValues: AttributeValuePort = {
    replace: vi.fn(async () => undefined),
    read: vi.fn(async () => []),
  };
  const service = new FieldDefinitionService(
    repository as unknown as FieldDefinitionRepository,
    attributeValues,
  );
  return { repository, attributeValues, service };
}

describe('CAT-02 schema application service', () => {
  it('requires manageSchema for every mutation, archived read and conversion preview', () => {
    const { service, repository } = harness();
    for (const role of ['viewer', 'editor'] as Role[]) {
      const denied = actor(role);
      expect(() => service.listFields(denied, { includeArchived: true })).toThrow(forbidden);
      expect(() =>
        service.createField(denied, {
          key: 'serial_number',
          scope: 'item',
          labels: { en: 'Serial' },
          dataType: 'text',
        }),
      ).toThrow(forbidden);
      expect(() => service.updateField(denied, textField.id, 1, {})).toThrow(forbidden);
      expect(() => service.archiveField(denied, textField.id, 1)).toThrow(forbidden);
      expect(() =>
        service.createOption(denied, textField.id, 1, { key: 'metal', labels: { en: 'Metal' } }),
      ).toThrow(forbidden);
      expect(() => service.updateOption(denied, textField.id, textField.id, 1, {})).toThrow(
        forbidden,
      );
      expect(() => service.archiveOption(denied, textField.id, textField.id, 1)).toThrow(forbidden);
      expect(() => service.previewConversion(denied, textField.id, 'long_text')).toThrow(forbidden);
    }
    expect(repository.createDefinition).not.toHaveBeenCalled();
    expect(repository.previewTypeConversion).not.toHaveBeenCalled();
  });

  it('lets an authenticated actor read the active resolved schema', async () => {
    const { service, repository } = harness();
    await expect(service.listFields(actor('viewer'), { scope: 'item' })).resolves.toEqual([
      textField,
    ]);
    await expect(service.resolveField(actor('editor'), textField.id)).resolves.toEqual(textField);
    expect(repository.listDefinitions).toHaveBeenCalledWith({ scope: 'item' });
    expect(repository.findDefinitionById).toHaveBeenCalledWith(textField.id, true);
  });

  it('records the acting administrator and request metadata on every mutation', async () => {
    const { service, repository } = harness();
    const admin = actor('admin');
    await service.createField(
      admin,
      { key: 'serial_number', scope: 'item', labels: { en: 'Serial' }, dataType: 'text' },
      { requestId: 'request-1' },
    );
    expect(repository.createDefinition).toHaveBeenCalledWith(expect.anything(), {
      actorId: admin.id,
      requestId: 'request-1',
    });
    await expect(service.archiveField(actor('owner'), textField.id, 3)).resolves.toMatchObject({
      reindex: { massReindexRequired: true },
    });
    expect(repository.archiveDefinition).toHaveBeenCalledWith(textField.id, 3, {
      actorId: admin.id,
    });
    await service.previewConversion(admin, textField.id, 'long_text');
    expect(repository.previewTypeConversion).toHaveBeenCalledWith(textField.id, 'long_text');
  });

  it('canonicalizes attribute input by stable field key and projects stored values back', async () => {
    const { service, attributeValues } = harness();
    await expect(
      service.validateAttributes(owner, null, { serial_number: ['a', 'b'] }),
    ).resolves.toEqual([
      {
        fieldDefinitionId: textField.id,
        values: [
          { slot: 'text', text: 'a' },
          { slot: 'text', text: 'b' },
        ],
      },
    ]);
    await expect(
      service.validateAttributes(owner, null, { unknown_field: 'x' }),
    ).rejects.toMatchObject({
      code: 'SCHEMA_ATTRIBUTE_VALIDATION_FAILED',
      issues: [{ fieldKey: 'unknown_field', code: 'UNKNOWN_FIELD' }],
    });
    await expect(service.readAttributes(owner)).resolves.toEqual({
      serial_number: ['first', 'second'],
    });
    const command = { owner, categoryId: null, assignments: [], now: new Date() };
    const context = { kind: 'prisma' as const, trx: {} as never };
    await service.replaceAttributes(context, command);
    expect(attributeValues.replace).toHaveBeenCalledWith(context, command);
  });
});
