import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AttributeValidationError,
  fieldDataTypes,
  fieldScopes,
  fieldVisibilities,
  SchemaAuthorizationError,
  SchemaPolicyError,
  SessionError,
  type ConversionPreview,
  type FieldDefinitionRecord,
  type FieldOptionRecord,
  type FieldScope,
  type LocalizedText,
  type ReindexWarning,
  type SchemaRequestMetadata,
  type SessionActor,
} from '@inventory-atlas/backend';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  type ApiPropertyOptions,
} from '@nestjs/swagger';
import { readSessionCookie } from './auth.http.js';
import { AUTH_RUNTIME, type AuthRuntimePort } from './auth.runtime.js';
import { SCHEMA_RUNTIME, type SchemaRuntimePort } from './schema.runtime.js';
import { ProblemDetailsDto } from './contract-models.js';

const dataTypes = [...fieldDataTypes];
const scopes = [...fieldScopes];
const visibilities = [...fieldVisibilities];
const stableKeyPattern = '^[a-z][a-z0-9_]{0,63}$';

/**
 * A default is an ordered array of API-shaped values, so one entry covers a scalar field and
 * several cover multiselect or repeatable fields. The explicit item union keeps the contract free
 * of a reflected `Object` type, which OpenAPI generation reports as a circular reference.
 */
const defaultValueSchema: ApiPropertyOptions = {
  description:
    'Ordered API-shaped default values. A scalar field carries a single-entry array; ' +
    'multiselect and repeatable fields carry one entry per value.',
  nullable: true,
  type: 'array',
  oneOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { additionalProperties: true, type: 'object' },
  ],
};
type FieldDefaultValue = unknown[] | null;

class LocalizedTextDto implements LocalizedText {
  @ApiProperty({ example: 'Serial number', maxLength: 200, minLength: 1, type: String })
  declare en: string;

  @ApiPropertyOptional({ example: 'Серійний номер', maxLength: 200, minLength: 1, type: String })
  declare uk?: string;
}

class ValidationRulesDto {
  @ApiPropertyOptional({ minimum: 0, type: Number }) declare minLength?: number;
  @ApiPropertyOptional({ minimum: 0, type: Number }) declare maxLength?: number;
  @ApiPropertyOptional({ maxLength: 200, type: String }) declare pattern?: string;
  @ApiPropertyOptional({ example: '0', type: String }) declare min?: string;
  @ApiPropertyOptional({ example: '100000', type: String }) declare max?: string;
  @ApiPropertyOptional({ type: Boolean }) declare integer?: boolean;
  @ApiPropertyOptional({ example: ['UAH', 'EUR'], type: [String] })
  declare currencies?: string[];
  @ApiPropertyOptional({ minimum: 0, type: Number }) declare minSelected?: number;
  @ApiPropertyOptional({ minimum: 0, type: Number }) declare maxSelected?: number;
  @ApiPropertyOptional({ enum: [...scopes, 'any'], type: String })
  declare referenceScope?: string;
}

class FieldOptionDto {
  @ApiProperty({ format: 'uuid', type: String }) declare id: string;
  @ApiProperty({ example: 'metal', pattern: stableKeyPattern, type: String }) declare key: string;
  @ApiProperty({ type: LocalizedTextDto }) declare labels: LocalizedTextDto;
  @ApiProperty({ minimum: 0, type: Number }) declare displayOrder: number;
  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String })
  declare archivedAt: string | null;
}

class FieldDefinitionDto {
  @ApiProperty({ format: 'uuid', type: String }) declare id: string;
  @ApiProperty({ example: 'serial_number', pattern: stableKeyPattern, type: String })
  declare key: string;
  @ApiProperty({ enum: scopes, type: String }) declare scope: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  declare categoryId: string | null;
  @ApiProperty({ type: LocalizedTextDto }) declare labels: LocalizedTextDto;
  @ApiPropertyOptional({ nullable: true, type: LocalizedTextDto })
  declare help: LocalizedTextDto | null;
  @ApiProperty({ enum: dataTypes, type: String }) declare dataType: string;
  @ApiProperty({ type: Boolean }) declare required: boolean;
  @ApiProperty({ type: Boolean }) declare repeatable: boolean;
  @ApiProperty({ type: Boolean }) declare searchable: boolean;
  @ApiProperty({ type: Boolean }) declare filterable: boolean;
  @ApiProperty({ type: Boolean }) declare sortable: boolean;
  @ApiProperty({ enum: visibilities, type: String }) declare visibility: string;
  @ApiPropertyOptional({ maxLength: 32, nullable: true, type: String })
  declare unit: string | null;
  @ApiPropertyOptional(defaultValueSchema) declare defaultValue: FieldDefaultValue;
  @ApiProperty({ type: ValidationRulesDto }) declare validation: ValidationRulesDto;
  @ApiProperty({ minimum: 0, type: Number }) declare displayOrder: number;
  @ApiProperty({ minimum: 1, type: Number }) declare version: number;
  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String })
  declare archivedAt: string | null;
  @ApiProperty({ type: [FieldOptionDto] }) declare options: FieldOptionDto[];
}

class ReindexWarningDto {
  @ApiProperty({ type: Boolean }) declare massReindexRequired: boolean;
  @ApiProperty({
    enum: ['visibility', 'searchable', 'filterable', 'sortable', 'labels', 'archived'],
    isArray: true,
    type: String,
  })
  declare reasons: string[];
  @ApiProperty({ example: 'search.rebuild-items.v1', type: String }) declare topic: string;
}

class FieldDefinitionMutationDto {
  @ApiProperty({ type: FieldDefinitionDto }) declare definition: FieldDefinitionDto;
  @ApiProperty({ type: ReindexWarningDto }) declare reindex: ReindexWarningDto;
}

class CreateFieldDefinitionDto {
  @ApiProperty({ pattern: stableKeyPattern, type: String }) declare key: string;
  @ApiProperty({ enum: scopes, type: String }) declare scope: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  declare categoryId?: string | null;
  @ApiProperty({ type: LocalizedTextDto }) declare labels: LocalizedTextDto;
  @ApiPropertyOptional({ nullable: true, type: LocalizedTextDto })
  declare help?: LocalizedTextDto | null;
  @ApiProperty({ enum: dataTypes, type: String }) declare dataType: string;
  @ApiPropertyOptional({ type: Boolean }) declare required?: boolean;
  @ApiPropertyOptional({ type: Boolean }) declare repeatable?: boolean;
  @ApiPropertyOptional({ type: Boolean }) declare searchable?: boolean;
  @ApiPropertyOptional({ type: Boolean }) declare filterable?: boolean;
  @ApiPropertyOptional({ type: Boolean }) declare sortable?: boolean;
  @ApiPropertyOptional({ enum: visibilities, type: String }) declare visibility?: string;
  @ApiPropertyOptional({ maxLength: 32, nullable: true, type: String })
  declare unit?: string | null;
  @ApiPropertyOptional(defaultValueSchema) declare defaultValue?: FieldDefaultValue;
  @ApiPropertyOptional({ type: ValidationRulesDto }) declare validation?: ValidationRulesDto;
  @ApiPropertyOptional({ minimum: 0, type: Number }) declare displayOrder?: number;
}

class UpdateFieldDefinitionDto {
  @ApiProperty({ minimum: 1, type: Number }) declare expectedVersion: number;
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  declare categoryId?: string | null;
  @ApiPropertyOptional({ type: LocalizedTextDto }) declare labels?: LocalizedTextDto;
  @ApiPropertyOptional({ nullable: true, type: LocalizedTextDto })
  declare help?: LocalizedTextDto | null;
  @ApiPropertyOptional({ enum: dataTypes, type: String }) declare dataType?: string;
  @ApiPropertyOptional({ type: Boolean }) declare required?: boolean;
  @ApiPropertyOptional({ type: Boolean }) declare repeatable?: boolean;
  @ApiPropertyOptional({ type: Boolean }) declare searchable?: boolean;
  @ApiPropertyOptional({ type: Boolean }) declare filterable?: boolean;
  @ApiPropertyOptional({ type: Boolean }) declare sortable?: boolean;
  @ApiPropertyOptional({ enum: visibilities, type: String }) declare visibility?: string;
  @ApiPropertyOptional({ maxLength: 32, nullable: true, type: String })
  declare unit?: string | null;
  @ApiPropertyOptional(defaultValueSchema) declare defaultValue?: FieldDefaultValue;
  @ApiPropertyOptional({ type: ValidationRulesDto }) declare validation?: ValidationRulesDto;
  @ApiPropertyOptional({ minimum: 0, type: Number }) declare displayOrder?: number;
}

class CreateFieldOptionDto {
  @ApiProperty({ minimum: 1, type: Number }) declare expectedVersion: number;
  @ApiProperty({ pattern: stableKeyPattern, type: String }) declare key: string;
  @ApiProperty({ type: LocalizedTextDto }) declare labels: LocalizedTextDto;
  @ApiPropertyOptional({ minimum: 0, type: Number }) declare displayOrder?: number;
}

class UpdateFieldOptionDto {
  @ApiProperty({ minimum: 1, type: Number }) declare expectedVersion: number;
  @ApiPropertyOptional({ type: LocalizedTextDto }) declare labels?: LocalizedTextDto;
  @ApiPropertyOptional({ minimum: 0, type: Number }) declare displayOrder?: number;
}

class ConversionPreviewRequestDto {
  @ApiProperty({ enum: dataTypes, type: String }) declare targetDataType: string;
}

class ConversionPreviewDto {
  @ApiProperty({ format: 'uuid', type: String }) declare fieldDefinitionId: string;
  @ApiProperty({ pattern: stableKeyPattern, type: String }) declare fieldKey: string;
  @ApiProperty({ enum: dataTypes, type: String }) declare currentDataType: string;
  @ApiProperty({ enum: dataTypes, type: String }) declare targetDataType: string;
  @ApiProperty({ type: Boolean }) declare supported: boolean;
  @ApiProperty({ type: Boolean }) declare lossless: boolean;
  @ApiProperty({ minimum: 0, type: Number }) declare totalValues: number;
  @ApiProperty({ minimum: 0, type: Number }) declare analyzedValues: number;
  @ApiProperty({ minimum: 0, type: Number }) declare convertibleValues: number;
  @ApiProperty({ minimum: 0, type: Number }) declare blockingValues: number;
  @ApiProperty({ type: Boolean }) declare truncated: boolean;
  @ApiProperty({ type: Boolean }) declare requiresBackgroundConversion: boolean;
  @ApiProperty({ type: Boolean }) declare reindexRequired: boolean;
  @ApiProperty({
    description: 'Stable issue codes for blocking values. Never contains a stored value.',
    isArray: true,
    type: String,
  })
  declare blockingIssues: string[];
}

@Controller('api/v1')
@ApiCookieAuth()
@ApiForbiddenResponse({ type: ProblemDetailsDto })
@ApiTags('dynamic schema')
@ApiUnauthorizedResponse({ type: ProblemDetailsDto })
export class SchemaFieldsController {
  constructor(
    @Inject(AUTH_RUNTIME) private readonly auth: AuthRuntimePort,
    @Inject(SCHEMA_RUNTIME) private readonly schema: SchemaRuntimePort,
  ) {}

  @Get('field-definitions')
  @ApiOperation({ operationId: 'listFieldDefinitions' })
  @ApiQuery({ name: 'scope', enum: scopes, required: false })
  @ApiQuery({ name: 'categoryId', format: 'uuid', required: false, type: String })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  @ApiOkResponse({ type: [FieldDefinitionDto] })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  async fieldDefinitions(
    @Headers('cookie') cookie?: string,
    @Query('scope') scope?: string,
    @Query('categoryId') categoryId?: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<FieldDefinitionDto[]> {
    const filter = {
      ...(scope === undefined ? {} : { scope: parseScope(scope) }),
      ...(categoryId === undefined ? {} : { categoryId: parseCategoryId(categoryId) }),
      includeArchived: parseIncludeArchived(includeArchived),
    };
    try {
      return (await this.schema.schemaFields().listFields(await this.actor(cookie), filter)).map(
        definitionDto,
      );
    } catch (error) {
      throw mapSchemaError(error);
    }
  }

  @Post('field-definitions')
  @ApiOperation({ operationId: 'createFieldDefinition' })
  @ApiBody({ type: CreateFieldDefinitionDto })
  @ApiCreatedResponse({ type: FieldDefinitionDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  async createFieldDefinition(
    @Body() body: unknown,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
    @Req() request?: { headers: Record<string, string | undefined> },
  ): Promise<FieldDefinitionDto> {
    const input = readCreateDefinition(body);
    try {
      return definitionDto(
        await this.schema
          .schemaFields()
          .createField(await this.mutationActor(cookie, csrf), input, schemaMetadata(request)),
      );
    } catch (error) {
      throw mapSchemaError(error);
    }
  }

  @Patch('field-definitions/:id')
  @ApiOperation({ operationId: 'updateFieldDefinition' })
  @ApiParam({ format: 'uuid', name: 'id', type: String })
  @ApiBody({ type: UpdateFieldDefinitionDto })
  @ApiOkResponse({ type: FieldDefinitionMutationDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async updateFieldDefinition(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
    @Req() request?: { headers: Record<string, string | undefined> },
  ): Promise<FieldDefinitionMutationDto> {
    requireUuid(id, 'Field definition ID is invalid.');
    const { expectedVersion, ...change } = readUpdateDefinition(body);
    try {
      const mutation = await this.schema
        .schemaFields()
        .updateField(
          await this.mutationActor(cookie, csrf),
          id,
          expectedVersion,
          change,
          schemaMetadata(request),
        );
      return mutationDto(mutation);
    } catch (error) {
      throw mapSchemaError(error);
    }
  }

  @Delete('field-definitions/:id')
  @ApiOperation({ operationId: 'archiveFieldDefinition' })
  @ApiParam({ format: 'uuid', name: 'id', type: String })
  @ApiOkResponse({ type: FieldDefinitionMutationDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async archiveFieldDefinition(
    @Param('id') id: string,
    @Headers('if-match') ifMatch?: string,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
    @Req() request?: { headers: Record<string, string | undefined> },
  ): Promise<FieldDefinitionMutationDto> {
    requireUuid(id, 'Field definition ID is invalid.');
    try {
      return mutationDto(
        await this.schema
          .schemaFields()
          .archiveField(
            await this.mutationActor(cookie, csrf),
            id,
            requireVersion(ifMatch),
            schemaMetadata(request),
          ),
      );
    } catch (error) {
      throw mapSchemaError(error);
    }
  }

  @Post('field-definitions/:id/conversion-preview')
  @HttpCode(200)
  @ApiOperation({ operationId: 'previewFieldDefinitionConversion' })
  @ApiParam({ format: 'uuid', name: 'id', type: String })
  @ApiBody({ type: ConversionPreviewRequestDto })
  @ApiOkResponse({ type: ConversionPreviewDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async previewConversion(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
  ): Promise<ConversionPreviewDto> {
    requireUuid(id, 'Field definition ID is invalid.');
    const target = record(body)?.targetDataType;
    if (typeof target !== 'string')
      throw new BadRequestException('A target data type is required.');
    try {
      return previewDto(
        await this.schema
          .schemaFields()
          .previewConversion(await this.mutationActor(cookie, csrf), id, target),
      );
    } catch (error) {
      throw mapSchemaError(error);
    }
  }

  @Post('field-definitions/:id/options')
  @ApiOperation({ operationId: 'createFieldOption' })
  @ApiParam({ format: 'uuid', name: 'id', type: String })
  @ApiBody({ type: CreateFieldOptionDto })
  @ApiCreatedResponse({ type: FieldDefinitionDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async createFieldOption(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
    @Req() request?: { headers: Record<string, string | undefined> },
  ): Promise<FieldDefinitionDto> {
    requireUuid(id, 'Field definition ID is invalid.');
    const input = readCreateOption(body);
    try {
      return definitionDto(
        await this.schema
          .schemaFields()
          .createOption(
            await this.mutationActor(cookie, csrf),
            id,
            input.expectedVersion,
            { key: input.key, labels: input.labels, displayOrder: input.displayOrder },
            schemaMetadata(request),
          ),
      );
    } catch (error) {
      throw mapSchemaError(error);
    }
  }

  @Patch('field-definitions/:id/options/:optionId')
  @ApiOperation({ operationId: 'updateFieldOption' })
  @ApiParam({ format: 'uuid', name: 'id', type: String })
  @ApiParam({ format: 'uuid', name: 'optionId', type: String })
  @ApiBody({ type: UpdateFieldOptionDto })
  @ApiOkResponse({ type: FieldDefinitionDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async updateFieldOption(
    @Param('id') id: string,
    @Param('optionId') optionId: string,
    @Body() body: unknown,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
    @Req() request?: { headers: Record<string, string | undefined> },
  ): Promise<FieldDefinitionDto> {
    requireUuid(id, 'Field definition ID is invalid.');
    requireUuid(optionId, 'Field option ID is invalid.');
    const input = readUpdateOption(body);
    try {
      return definitionDto(
        await this.schema.schemaFields().updateOption(
          await this.mutationActor(cookie, csrf),
          id,
          optionId,
          input.expectedVersion,
          {
            ...(input.labels ? { labels: input.labels } : {}),
            ...(input.displayOrder === undefined ? {} : { displayOrder: input.displayOrder }),
          },
          schemaMetadata(request),
        ),
      );
    } catch (error) {
      throw mapSchemaError(error);
    }
  }

  @Delete('field-definitions/:id/options/:optionId')
  @ApiOperation({ operationId: 'archiveFieldOption' })
  @ApiParam({ format: 'uuid', name: 'id', type: String })
  @ApiParam({ format: 'uuid', name: 'optionId', type: String })
  @ApiOkResponse({ type: FieldDefinitionDto })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async archiveFieldOption(
    @Param('id') id: string,
    @Param('optionId') optionId: string,
    @Headers('if-match') ifMatch?: string,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
    @Req() request?: { headers: Record<string, string | undefined> },
  ): Promise<FieldDefinitionDto> {
    requireUuid(id, 'Field definition ID is invalid.');
    requireUuid(optionId, 'Field option ID is invalid.');
    try {
      return definitionDto(
        await this.schema
          .schemaFields()
          .archiveOption(
            await this.mutationActor(cookie, csrf),
            id,
            optionId,
            requireVersion(ifMatch),
            schemaMetadata(request),
          ),
      );
    } catch (error) {
      throw mapSchemaError(error);
    }
  }

  private async actor(cookie: string | undefined, csrf?: string): Promise<SessionActor> {
    const token = readSessionCookie(cookie);
    if (!token) throw new SessionError('AUTH_SESSION_INVALID', 'Session is invalid or expired.');
    return (await this.auth.authSessions().authenticate(token, csrf)).actor;
  }

  private mutationActor(
    cookie: string | undefined,
    csrf: string | undefined,
  ): Promise<SessionActor> {
    if (!csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf))
      throw new SessionError('AUTH_CSRF_INVALID', 'CSRF token is invalid.');
    return this.actor(cookie, csrf);
  }
}

function schemaMetadata(
  request: { headers: Record<string, string | undefined> } | undefined,
): SchemaRequestMetadata {
  const requestId = request?.headers['x-request-id'];
  const correlationId = request?.headers['x-correlation-id'];
  return { ...(requestId ? { requestId } : {}), ...(correlationId ? { correlationId } : {}) };
}

function definitionDto(record: FieldDefinitionRecord): FieldDefinitionDto {
  const { currencies, ...rules } = record.validation;
  return {
    ...record,
    validation: { ...rules, ...(currencies ? { currencies: [...currencies] } : {}) },
    archivedAt: record.archivedAt?.toISOString() ?? null,
    options: record.options.map(optionDto),
  };
}

function optionDto(record: FieldOptionRecord): FieldOptionDto {
  return { ...record, archivedAt: record.archivedAt?.toISOString() ?? null };
}

function mutationDto(mutation: {
  definition: FieldDefinitionRecord;
  reindex: ReindexWarning;
}): FieldDefinitionMutationDto {
  return {
    definition: definitionDto(mutation.definition),
    reindex: { ...mutation.reindex, reasons: [...mutation.reindex.reasons] },
  };
}

function previewDto(preview: ConversionPreview): ConversionPreviewDto {
  return { ...preview, blockingIssues: [...preview.blockingIssues] };
}

function parseScope(value: string): FieldScope {
  if (!scopes.includes(value as FieldScope))
    throw new BadRequestException('scope must be item or storage_node.');
  return value as FieldScope;
}

function parseCategoryId(value: string): string | null {
  if (value === '' || value === 'null') return null;
  if (!uuidPattern.test(value)) throw new BadRequestException('categoryId must be a UUID.');
  return value;
}

function parseIncludeArchived(value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new BadRequestException('includeArchived must be true or false.');
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function localized(value: unknown): value is LocalizedTextDto {
  const text = record(value);
  return (
    !!text && typeof text.en === 'string' && (text.uk === undefined || typeof text.uk === 'string')
  );
}

function order(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function optionalFlags(item: Record<string, unknown>): void {
  for (const flag of ['required', 'repeatable', 'searchable', 'filterable', 'sortable']) {
    if (item[flag] !== undefined && typeof item[flag] !== 'boolean')
      throw new BadRequestException(`${flag} must be a boolean.`);
  }
}

function optionalShared(item: Record<string, unknown>): void {
  optionalFlags(item);
  if (
    item.categoryId !== undefined &&
    item.categoryId !== null &&
    !uuidPattern.test(String(item.categoryId))
  )
    throw new BadRequestException('categoryId must be a UUID.');
  if (item.help !== undefined && item.help !== null && !localized(item.help))
    throw new BadRequestException('help must be a localized text object.');
  if (item.unit !== undefined && item.unit !== null && typeof item.unit !== 'string')
    throw new BadRequestException('unit must be a string.');
  if (item.validation !== undefined && item.validation !== null && !record(item.validation))
    throw new BadRequestException('validation must be an object.');
  if (item.displayOrder !== undefined && !order(item.displayOrder))
    throw new BadRequestException('displayOrder must be a non-negative integer.');
  if (item.visibility !== undefined && typeof item.visibility !== 'string')
    throw new BadRequestException('visibility must be a string.');
}

function readCreateDefinition(body: unknown): CreateFieldDefinitionDto {
  const item = record(body);
  if (!item || typeof item.key !== 'string' || typeof item.dataType !== 'string')
    throw new BadRequestException('A stable key and data type are required.');
  if (!localized(item.labels)) throw new BadRequestException('An English label is required.');
  if (typeof item.scope !== 'string') throw new BadRequestException('A field scope is required.');
  optionalShared(item);
  return item as unknown as CreateFieldDefinitionDto;
}

function readUpdateDefinition(body: unknown): UpdateFieldDefinitionDto {
  const item = record(body);
  if (!item || !positiveVersion(item.expectedVersion))
    throw new BadRequestException('A positive expected version is required.');
  if ('key' in item || 'scope' in item)
    throw new BadRequestException('The stable key and scope cannot change.');
  if (item.labels !== undefined && !localized(item.labels))
    throw new BadRequestException('labels must be a localized text object.');
  if (item.dataType !== undefined && typeof item.dataType !== 'string')
    throw new BadRequestException('dataType must be a string.');
  optionalShared(item);
  return item as unknown as UpdateFieldDefinitionDto;
}

function readCreateOption(body: unknown): {
  expectedVersion: number;
  key: string;
  labels: LocalizedText;
  displayOrder: number;
} {
  const item = record(body);
  if (!item || !positiveVersion(item.expectedVersion))
    throw new BadRequestException('A positive expected version is required.');
  if (typeof item.key !== 'string' || !localized(item.labels))
    throw new BadRequestException('A stable option key and English label are required.');
  if (item.displayOrder !== undefined && !order(item.displayOrder))
    throw new BadRequestException('displayOrder must be a non-negative integer.');
  return {
    expectedVersion: item.expectedVersion,
    key: item.key,
    labels: item.labels,
    displayOrder: (item.displayOrder as number | undefined) ?? 0,
  };
}

function readUpdateOption(body: unknown): {
  expectedVersion: number;
  labels?: LocalizedText;
  displayOrder?: number;
} {
  const item = record(body);
  if (!item || !positiveVersion(item.expectedVersion))
    throw new BadRequestException('A positive expected version is required.');
  if ('key' in item) throw new BadRequestException('The stable option key cannot change.');
  if (item.labels !== undefined && !localized(item.labels))
    throw new BadRequestException('labels must be a localized text object.');
  if (item.displayOrder !== undefined && !order(item.displayOrder))
    throw new BadRequestException('displayOrder must be a non-negative integer.');
  if (item.labels === undefined && item.displayOrder === undefined)
    throw new BadRequestException('An option change must contain labels or displayOrder.');
  return {
    expectedVersion: item.expectedVersion,
    ...(item.labels === undefined ? {} : { labels: item.labels as LocalizedText }),
    ...(item.displayOrder === undefined ? {} : { displayOrder: item.displayOrder as number }),
  };
}

function requireUuid(value: string, message: string): void {
  if (!uuidPattern.test(value)) throw new BadRequestException(message);
}

function requireVersion(value: string | undefined): number {
  const version = Number(value?.replace(/^W\//, '').replaceAll('"', ''));
  if (!positiveVersion(version))
    throw new BadRequestException('If-Match must contain a positive version.');
  return version;
}

function mapSchemaError(error: unknown): Error {
  if (error instanceof SessionError) return new UnauthorizedException(error.message);
  if (error instanceof SchemaAuthorizationError) return new ForbiddenException(error.message);
  if (error instanceof AttributeValidationError) return new BadRequestException(error.message);
  if (error instanceof SchemaPolicyError) {
    if (error.code === 'SCHEMA_FIELD_NOT_FOUND' || error.code === 'SCHEMA_OPTION_NOT_FOUND')
      return new NotFoundException(error.message);
    if (
      error.code === 'SCHEMA_FIELD_VERSION_CONFLICT' ||
      error.code === 'SCHEMA_FIELD_CONVERSION_REQUIRED'
    )
      return new ConflictException(error.message);
    return new BadRequestException(error.message);
  }
  if (record(error)?.code === 'P2002')
    return new ConflictException('The stable key already exists for this scope and category.');
  return error as Error;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
