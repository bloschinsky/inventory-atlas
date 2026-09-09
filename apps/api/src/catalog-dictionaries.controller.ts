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
  UnauthorizedException,
} from '@nestjs/common';
import {
  CatalogDictionaryAuthorizationError,
  DictionaryPolicyError,
  type CategoryRecord,
  type LifecycleStatusRecord,
  type LocalizedLabel,
  type SessionActor,
  SessionError,
} from '@inventory-atlas/backend';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { readSessionCookie } from './auth.http.js';
import { AUTH_RUNTIME, type AuthRuntimePort } from './auth.runtime.js';
import { CATALOG_RUNTIME, type CatalogRuntimePort } from './catalog.runtime.js';
import { ProblemDetailsDto } from './contract-models.js';

class LocalizedLabelDto implements LocalizedLabel {
  @ApiProperty({ example: 'Tools', maxLength: 200, minLength: 1, type: String }) declare en: string;
  @ApiPropertyOptional({ example: 'Інструменти', maxLength: 200, minLength: 1, type: String })
  declare uk?: string;
}

class CategoryDto {
  @ApiProperty({ format: 'uuid', type: String }) declare id: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String }) declare parentId:
    string | null;
  @ApiProperty({ example: 'tools', pattern: '^[a-z][a-z0-9_]{0,63}$', type: String })
  declare key: string;
  @ApiProperty({ type: LocalizedLabelDto }) declare labels: LocalizedLabelDto;
  @ApiPropertyOptional({ nullable: true, type: String }) declare displayTemplate: string | null;
  @ApiProperty({ minimum: 0, type: Number }) declare displayOrder: number;
  @ApiProperty({ minimum: 1, type: Number }) declare version: number;
  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String }) declare archivedAt:
    string | null;
}

class LifecycleStatusDto {
  @ApiProperty({ format: 'uuid', type: String }) declare id: string;
  @ApiProperty({ example: 'stored', pattern: '^[a-z][a-z0-9_]{0,63}$', type: String })
  declare key: string;
  @ApiProperty({ type: LocalizedLabelDto }) declare labels: LocalizedLabelDto;
  @ApiProperty({
    example: 'status.info',
    pattern: '^[a-z][a-z0-9]*(?:\\.[a-z0-9]+)*$',
    type: String,
  })
  declare colorToken: string;
  @ApiProperty({ minimum: 0, type: Number }) declare displayOrder: number;
  @ApiProperty({ minimum: 1, type: Number }) declare version: number;
  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String }) declare archivedAt:
    string | null;
}

class CreateCategoryDto {
  @ApiProperty({ pattern: '^[a-z][a-z0-9_]{0,63}$', type: String }) declare key: string;
  @ApiProperty({ type: LocalizedLabelDto }) declare labels: LocalizedLabelDto;
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String }) declare parentId?:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) declare displayTemplate?: string | null;
  @ApiProperty({ minimum: 0, type: Number }) declare displayOrder: number;
}

class UpdateCategoryDto {
  @ApiProperty({ minimum: 1, type: Number }) declare expectedVersion: number;
  @ApiPropertyOptional({ type: LocalizedLabelDto }) declare labels?: LocalizedLabelDto;
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String }) declare parentId?:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) declare displayTemplate?: string | null;
  @ApiPropertyOptional({ minimum: 0, type: Number }) declare displayOrder?: number;
}

class CreateLifecycleStatusDto {
  @ApiProperty({ pattern: '^[a-z][a-z0-9_]{0,63}$', type: String }) declare key: string;
  @ApiProperty({ type: LocalizedLabelDto }) declare labels: LocalizedLabelDto;
  @ApiProperty({ pattern: '^[a-z][a-z0-9]*(?:\\.[a-z0-9]+)*$', type: String })
  declare colorToken: string;
  @ApiProperty({ minimum: 0, type: Number }) declare displayOrder: number;
}

class UpdateLifecycleStatusDto {
  @ApiProperty({ minimum: 1, type: Number }) declare expectedVersion: number;
  @ApiPropertyOptional({ type: LocalizedLabelDto }) declare labels?: LocalizedLabelDto;
  @ApiPropertyOptional({ pattern: '^[a-z][a-z0-9]*(?:\\.[a-z0-9]+)*$', type: String })
  declare colorToken?: string;
  @ApiPropertyOptional({ minimum: 0, type: Number }) declare displayOrder?: number;
}

@Controller('api/v1')
@ApiCookieAuth()
@ApiForbiddenResponse({ type: ProblemDetailsDto })
@ApiTags('catalog dictionaries')
@ApiUnauthorizedResponse({ type: ProblemDetailsDto })
export class CatalogDictionariesController {
  constructor(
    @Inject(AUTH_RUNTIME) private readonly auth: AuthRuntimePort,
    @Inject(CATALOG_RUNTIME) private readonly catalog: CatalogRuntimePort,
  ) {}

  @Get('categories')
  @ApiOperation({ operationId: 'listCategories' })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  @ApiOkResponse({ type: [CategoryDto] })
  async categories(
    @Headers('cookie') cookie?: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<CategoryDto[]> {
    try {
      return (
        await this.catalog
          .catalogDictionaries()
          .listCategories(await this.actor(cookie), parseIncludeArchived(includeArchived))
      ).map(categoryDto);
    } catch (error) {
      throw mapCatalogError(error);
    }
  }

  @Post('categories')
  @ApiOperation({ operationId: 'createCategory' })
  @ApiCreatedResponse({ type: CategoryDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  async createCategory(
    @Body() body: unknown,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
  ): Promise<CategoryDto> {
    if (!isCreateCategory(body)) throw new BadRequestException('Category details are invalid.');
    try {
      return categoryDto(
        await this.catalog
          .catalogDictionaries()
          .createCategory(await this.mutationActor(cookie, csrf), body),
      );
    } catch (error) {
      throw mapCatalogError(error);
    }
  }

  @Patch('categories/:id')
  @ApiOperation({ operationId: 'updateCategory' })
  @ApiOkResponse({ type: CategoryDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async updateCategory(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
  ): Promise<CategoryDto> {
    if (!uuidPattern.test(id) || !isUpdateCategory(body))
      throw new BadRequestException('Category change is invalid.');
    const { expectedVersion, ...change } = body;
    try {
      return categoryDto(
        await this.catalog
          .catalogDictionaries()
          .updateCategory(await this.mutationActor(cookie, csrf), id, expectedVersion, change),
      );
    } catch (error) {
      throw mapCatalogError(error);
    }
  }

  @Delete('categories/:id')
  @HttpCode(204)
  @ApiOperation({ operationId: 'archiveCategory' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async archiveCategory(
    @Param('id') id: string,
    @Headers('if-match') ifMatch?: string,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
  ): Promise<void> {
    if (!uuidPattern.test(id)) throw new BadRequestException('Category ID is invalid.');
    try {
      await this.catalog
        .catalogDictionaries()
        .archiveCategory(await this.mutationActor(cookie, csrf), id, requireVersion(ifMatch));
    } catch (error) {
      throw mapCatalogError(error);
    }
  }

  @Get('lifecycle-statuses')
  @ApiOperation({ operationId: 'listLifecycleStatuses' })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  @ApiOkResponse({ type: [LifecycleStatusDto] })
  async statuses(
    @Headers('cookie') cookie?: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<LifecycleStatusDto[]> {
    try {
      return (
        await this.catalog
          .catalogDictionaries()
          .listLifecycleStatuses(await this.actor(cookie), parseIncludeArchived(includeArchived))
      ).map(statusDto);
    } catch (error) {
      throw mapCatalogError(error);
    }
  }

  @Post('lifecycle-statuses')
  @ApiOperation({ operationId: 'createLifecycleStatus' })
  @ApiCreatedResponse({ type: LifecycleStatusDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  async createStatus(
    @Body() body: unknown,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
  ): Promise<LifecycleStatusDto> {
    if (!isCreateStatus(body))
      throw new BadRequestException('Lifecycle status details are invalid.');
    try {
      return statusDto(
        await this.catalog
          .catalogDictionaries()
          .createLifecycleStatus(await this.mutationActor(cookie, csrf), body),
      );
    } catch (error) {
      throw mapCatalogError(error);
    }
  }

  @Patch('lifecycle-statuses/:id')
  @ApiOperation({ operationId: 'updateLifecycleStatus' })
  @ApiOkResponse({ type: LifecycleStatusDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async updateStatus(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
  ): Promise<LifecycleStatusDto> {
    if (!uuidPattern.test(id) || !isUpdateStatus(body))
      throw new BadRequestException('Lifecycle status change is invalid.');
    const { expectedVersion, ...change } = body;
    try {
      return statusDto(
        await this.catalog
          .catalogDictionaries()
          .updateLifecycleStatus(
            await this.mutationActor(cookie, csrf),
            id,
            expectedVersion,
            change,
          ),
      );
    } catch (error) {
      throw mapCatalogError(error);
    }
  }

  @Delete('lifecycle-statuses/:id')
  @HttpCode(204)
  @ApiOperation({ operationId: 'archiveLifecycleStatus' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async archiveStatus(
    @Param('id') id: string,
    @Headers('if-match') ifMatch?: string,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
  ): Promise<void> {
    if (!uuidPattern.test(id)) throw new BadRequestException('Lifecycle status ID is invalid.');
    try {
      await this.catalog
        .catalogDictionaries()
        .archiveLifecycleStatus(
          await this.mutationActor(cookie, csrf),
          id,
          requireVersion(ifMatch),
        );
    } catch (error) {
      throw mapCatalogError(error);
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

function categoryDto(row: CategoryRecord): CategoryDto {
  return { ...row, archivedAt: row.archivedAt?.toISOString() ?? null };
}
function statusDto(row: LifecycleStatusRecord): LifecycleStatusDto {
  return { ...row, archivedAt: row.archivedAt?.toISOString() ?? null };
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
function labels(value: unknown): value is LocalizedLabel {
  const item = record(value);
  return (
    !!item && typeof item.en === 'string' && (item.uk === undefined || typeof item.uk === 'string')
  );
}
function order(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function optionalUuid(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === 'string' && uuidPattern.test(value))
  );
}
function isCreateCategory(value: unknown): value is CreateCategoryDto {
  const item = record(value);
  return (
    !!item &&
    typeof item.key === 'string' &&
    labels(item.labels) &&
    order(item.displayOrder) &&
    optionalUuid(item.parentId) &&
    (item.displayTemplate === undefined ||
      item.displayTemplate === null ||
      typeof item.displayTemplate === 'string')
  );
}
function isUpdateCategory(value: unknown): value is UpdateCategoryDto {
  const item = record(value);
  if (
    !item ||
    'key' in item ||
    !positiveVersion(item.expectedVersion) ||
    (item.labels !== undefined && !labels(item.labels)) ||
    !optionalUuid(item.parentId) ||
    (item.displayTemplate !== undefined &&
      item.displayTemplate !== null &&
      typeof item.displayTemplate !== 'string') ||
    (item.displayOrder !== undefined && !order(item.displayOrder))
  )
    return false;
  return ['labels', 'parentId', 'displayTemplate', 'displayOrder'].some((key) => key in item);
}
function isCreateStatus(value: unknown): value is CreateLifecycleStatusDto {
  const item = record(value);
  return (
    !!item &&
    typeof item.key === 'string' &&
    labels(item.labels) &&
    typeof item.colorToken === 'string' &&
    order(item.displayOrder)
  );
}
function isUpdateStatus(value: unknown): value is UpdateLifecycleStatusDto {
  const item = record(value);
  if (
    !item ||
    'key' in item ||
    !positiveVersion(item.expectedVersion) ||
    (item.labels !== undefined && !labels(item.labels)) ||
    (item.colorToken !== undefined && typeof item.colorToken !== 'string') ||
    (item.displayOrder !== undefined && !order(item.displayOrder))
  )
    return false;
  return ['labels', 'colorToken', 'displayOrder'].some((key) => key in item);
}
function positiveVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
function requireVersion(value: string | undefined): number {
  const version = Number(value?.replace(/^W\//, '').replaceAll('"', ''));
  if (!positiveVersion(version))
    throw new BadRequestException('If-Match must contain a positive version.');
  return version;
}
function mapCatalogError(error: unknown): Error {
  if (error instanceof SessionError) return new UnauthorizedException(error.message);
  if (error instanceof CatalogDictionaryAuthorizationError)
    return new ForbiddenException(error.message);
  if (error instanceof DictionaryPolicyError) {
    if (error.code === 'CATALOG_DICTIONARY_NOT_FOUND') return new NotFoundException(error.message);
    if (error.code === 'CATALOG_DICTIONARY_VERSION_CONFLICT')
      return new ConflictException(error.message);
    return new BadRequestException(error.message);
  }
  if (record(error)?.code === 'P2002')
    return new ConflictException('The dictionary key already exists.');
  return error as Error;
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
