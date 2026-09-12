import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
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
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AttributeValidationError,
  SessionError,
  StorageAccessError,
  StoragePolicyError,
  storageNodeTypes,
  storageVisibilities,
  type CreateStorageNodeInput,
  type MoveStorageNodeInput,
  type SessionActor,
  type UpdateStorageNodeInput,
} from '@inventory-atlas/backend';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { readSessionCookie } from './auth.http.js';
import { AUTH_RUNTIME, type AuthRuntimePort } from './auth.runtime.js';
import {
  CreateStorageNodeRequestDto,
  MoveStorageNodeRequestDto,
  ProblemDetailsDto,
  StorageNodeDetailDto,
  StorageNodePageDto,
  StorageNodeSummaryDto,
  UpdateStorageNodeRequestDto,
  VersionConflictProblemDto,
} from './contract-models.js';
import { STORAGE_RUNTIME, type StorageRuntimePort } from './storage.runtime.js';

@Controller('api/v1/storage-nodes')
@ApiCookieAuth()
@ApiTags('storage')
@ApiUnauthorizedResponse({ type: ProblemDetailsDto })
@ApiForbiddenResponse({ type: ProblemDetailsDto })
export class StorageNodesController {
  constructor(
    @Inject(AUTH_RUNTIME) private readonly auth: AuthRuntimePort,
    @Inject(STORAGE_RUNTIME) private readonly runtime: StorageRuntimePort,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listStorageNodes' })
  @ApiQuery({ format: 'uuid', name: 'parentPublicId', required: false, type: String })
  @ApiQuery({ maximum: 100, minimum: 1, name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiOkResponse({ type: StorageNodePageDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  async list(
    @Query('parentPublicId') parentPublicId: string | undefined,
    @Query('limit') limitValue: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
  ): Promise<StorageNodePageDto> {
    try {
      if (parentPublicId) requireUuid(parentPublicId, 'parentPublicId');
      const limit = readLimit(limitValue);
      return await this.runtime.storage().list(await this.reader(cookie), {
        ...(parentPublicId ? { parentPublicId } : {}),
        ...(limit === undefined ? {} : { limit }),
        ...(cursor ? { cursor } : {}),
      });
    } catch (error) {
      throw mapStorageError(error, request.headers['x-request-id']);
    }
  }

  @Post()
  @ApiOperation({ operationId: 'createStorageNode' })
  @ApiBody({ type: CreateStorageNodeRequestDto })
  @ApiCreatedResponse({ type: StorageNodeSummaryDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  async create(
    @Body() body: unknown,
    @Headers('cookie') cookie: string | undefined,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
    @Res({ passthrough: true }) response: { header(name: string, value: string): void },
  ): Promise<StorageNodeSummaryDto> {
    try {
      const node = await this.runtime
        .storage()
        .create(await this.actor(cookie, csrf), readCreate(body), requestMetadata(request.headers));
      response.header('ETag', `"${node.version}"`);
      return node;
    } catch (error) {
      throw mapStorageError(error, request.headers['x-request-id']);
    }
  }

  @Get(':publicId')
  @ApiOperation({ operationId: 'getStorageNode' })
  @ApiParam({ format: 'uuid', name: 'publicId', type: String })
  @ApiQuery({ maximum: 100, minimum: 1, name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiOkResponse({ type: StorageNodeDetailDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async get(
    @Param('publicId') publicId: string,
    @Query('limit') limitValue: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
    @Res({ passthrough: true }) response: { header(name: string, value: string): void },
  ): Promise<StorageNodeDetailDto> {
    try {
      requireUuid(publicId, 'publicId');
      const limit = readLimit(limitValue);
      const node = await this.runtime.storage().get(await this.reader(cookie), publicId, {
        ...(limit === undefined ? {} : { limit }),
        ...(cursor ? { cursor } : {}),
      });
      response.header('ETag', `"${node.version}"`);
      return node;
    } catch (error) {
      throw mapStorageError(error, request.headers['x-request-id']);
    }
  }

  @Patch(':publicId')
  @ApiOperation({ operationId: 'updateStorageNode' })
  @ApiParam({ format: 'uuid', name: 'publicId', type: String })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiBody({ type: UpdateStorageNodeRequestDto })
  @ApiOkResponse({ type: StorageNodeSummaryDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: VersionConflictProblemDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async update(
    @Param('publicId') publicId: string,
    @Body() body: unknown,
    @Headers('cookie') cookie: string | undefined,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
    @Res({ passthrough: true }) response: { header(name: string, value: string): void },
  ): Promise<StorageNodeSummaryDto> {
    try {
      requireUuid(publicId, 'publicId');
      const parsed = readUpdate(body, ifMatch);
      const node = await this.runtime
        .storage()
        .update(
          await this.actor(cookie, csrf),
          publicId,
          parsed.expectedVersion,
          parsed.input,
          requestMetadata(request.headers),
        );
      response.header('ETag', `"${node.version}"`);
      return node;
    } catch (error) {
      throw mapStorageError(error, request.headers['x-request-id']);
    }
  }

  @Post(':publicId/move')
  @HttpCode(200)
  @ApiOperation({ operationId: 'moveStorageNode' })
  @ApiParam({ format: 'uuid', name: 'publicId', type: String })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiBody({ type: MoveStorageNodeRequestDto })
  @ApiOkResponse({ type: StorageNodeSummaryDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async move(
    @Param('publicId') publicId: string,
    @Body() body: unknown,
    @Headers('cookie') cookie: string | undefined,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
    @Res({ passthrough: true }) response: { header(name: string, value: string): void },
  ): Promise<StorageNodeSummaryDto> {
    try {
      requireUuid(publicId, 'publicId');
      const parsed = readMove(body, ifMatch);
      const node = await this.runtime
        .storage()
        .move(
          await this.actor(cookie, csrf),
          publicId,
          parsed.expectedVersion,
          parsed.input,
          requestMetadata(request.headers),
        );
      response.header('ETag', `"${node.version}"`);
      return node;
    } catch (error) {
      throw mapStorageError(error, request.headers['x-request-id']);
    }
  }

  private async reader(cookie: string | undefined): Promise<SessionActor> {
    const token = readSessionCookie(cookie);
    if (!token) throw new SessionError('AUTH_SESSION_INVALID', 'Session is invalid or expired.');
    return (await this.auth.authSessions().authenticate(token)).actor;
  }

  private async actor(cookie: string | undefined, csrf: string | undefined): Promise<SessionActor> {
    if (!csrf || !/^[A-Za-z0-9_-]{43}$/u.test(csrf))
      throw new SessionError('AUTH_CSRF_INVALID', 'CSRF token is invalid.');
    const token = readSessionCookie(cookie);
    if (!token) throw new SessionError('AUTH_SESSION_INVALID', 'Session is invalid or expired.');
    return (await this.auth.authSessions().authenticate(token, csrf)).actor;
  }
}

function readCreate(value: unknown): CreateStorageNodeInput {
  const body = record(value);
  const nodeType = stringValue(body.nodeType, 'nodeType');
  const title = stringValue(body.title, 'title');
  const parentPublicId = optionalNullableString(body.parentPublicId, 'parentPublicId');
  if (parentPublicId) requireUuid(parentPublicId, 'parentPublicId');
  const visibility = optionalEnum(body.visibility, storageVisibilities, 'visibility');
  const code = optionalNullableString(body.code, 'code');
  return {
    nodeType: enumValue(nodeType, storageNodeTypes, 'nodeType'),
    title,
    ...(parentPublicId === undefined ? {} : { parentPublicId }),
    ...(code === undefined ? {} : { code }),
    ...(visibility === undefined ? {} : { visibility }),
    ...(body.attributes === undefined ? {} : { attributes: record(body.attributes) }),
  };
}

function readUpdate(
  value: unknown,
  ifMatch: string | undefined,
): { expectedVersion: number; input: UpdateStorageNodeInput } {
  const body = record(value);
  const headerVersion = ifMatch
    ? positiveVersion(ifMatch.replace(/^W\//u, '').replaceAll('"', ''))
    : null;
  const bodyVersion =
    body.expectedVersion === undefined ? null : positiveVersion(body.expectedVersion);
  if (headerVersion !== null && bodyVersion !== null && headerVersion !== bodyVersion)
    throw new StoragePolicyError(
      'STORAGE_VERSION_CONFLICT',
      'expectedVersion',
      'If-Match and expectedVersion must agree.',
    );
  const expectedVersion = headerVersion ?? bodyVersion;
  if (expectedVersion === null)
    throw new StoragePolicyError(
      'STORAGE_VERSION_CONFLICT',
      'expectedVersion',
      'Expected version is required.',
    );
  const input: UpdateStorageNodeInput = {};
  if (body.nodeType !== undefined)
    input.nodeType = enumValue(
      stringValue(body.nodeType, 'nodeType'),
      storageNodeTypes,
      'nodeType',
    );
  if (body.title !== undefined) input.title = stringValue(body.title, 'title');
  if (body.code !== undefined) {
    const code = optionalNullableString(body.code, 'code');
    if (code !== undefined) input.code = code;
  }
  if (body.visibility !== undefined)
    input.visibility = enumValue(
      stringValue(body.visibility, 'visibility'),
      storageVisibilities,
      'visibility',
    );
  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') bad('archived');
    input.archived = body.archived as boolean;
  }
  if (body.attributes !== undefined) input.attributes = record(body.attributes);
  if (!Object.keys(input).length) bad('$');
  return { expectedVersion, input };
}

function readMove(
  value: unknown,
  ifMatch: string | undefined,
): { expectedVersion: number; input: MoveStorageNodeInput } {
  const body = record(value);
  const headerVersion = ifMatch
    ? positiveVersion(ifMatch.replace(/^W\//u, '').replaceAll('"', ''))
    : null;
  const bodyVersion =
    body.expectedVersion === undefined ? null : positiveVersion(body.expectedVersion);
  if (headerVersion !== null && bodyVersion !== null && headerVersion !== bodyVersion)
    throw new StoragePolicyError(
      'STORAGE_VERSION_CONFLICT',
      'expectedVersion',
      'If-Match and expectedVersion must agree.',
    );
  const expectedVersion = headerVersion ?? bodyVersion;
  if (expectedVersion === null)
    throw new StoragePolicyError(
      'STORAGE_VERSION_CONFLICT',
      'expectedVersion',
      'Expected version is required.',
    );
  const targetParentPublicId = stringValue(body.targetParentPublicId, 'targetParentPublicId');
  requireUuid(targetParentPublicId, 'targetParentPublicId');
  const reason = optionalNullableString(body.reason, 'reason');
  if (reason !== undefined && reason !== null && reason.length > 512) bad('reason');
  return {
    expectedVersion,
    input: {
      targetParentPublicId,
      ...(reason === undefined || reason === null ? {} : { reason }),
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad('$');
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) bad(field);
  return value as string;
}

function optionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return stringValue(value, field);
}

function enumValue<const T extends readonly string[]>(
  value: string,
  allowed: T,
  field: string,
): T[number] {
  if (!allowed.includes(value)) bad(field);
  return value as T[number];
}

function optionalEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] | undefined {
  return value === undefined ? undefined : enumValue(stringValue(value, field), allowed, field);
}

function positiveVersion(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) bad('expectedVersion');
  return parsed;
}

function readLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) bad('limit');
  return limit;
}

function requireUuid(value: string, field: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))
    bad(field);
}

function requestMetadata(headers: Record<string, string | undefined>) {
  return {
    ...(headers['x-request-id'] ? { requestId: headers['x-request-id'] } : {}),
    ...(headers['x-correlation-id'] ? { correlationId: headers['x-correlation-id'] } : {}),
  };
}

function bad(field: string): never {
  throw new BadRequestException({
    code: 'VALIDATION_FAILED',
    detail: 'One or more fields are invalid.',
    fieldErrors: [{ field, messages: ['INVALID'] }],
    requestId: 'unknown',
    status: 400,
    title: 'Request validation failed',
    type: 'https://inventory-atlas.local/problems/validation-failed',
  });
}

function mapStorageError(error: unknown, requestId = 'unknown'): Error {
  if (error instanceof BadRequestException) return error;
  if (error instanceof SessionError) return new UnauthorizedException(error.message);
  if (error instanceof StorageAccessError)
    return error.code === 'STORAGE_NOT_FOUND'
      ? new NotFoundException(error.message)
      : new ForbiddenException(error.message);
  if (error instanceof StoragePolicyError) {
    if (error.code === 'STORAGE_NOT_FOUND' || error.code === 'STORAGE_PARENT_NOT_FOUND')
      return new NotFoundException(error.message);
    if (error.code === 'STORAGE_VERSION_CONFLICT' && error.currentVersion)
      return new ConflictException({
        code: error.code,
        currentVersion: error.currentVersion,
        detail: error.message,
        requestId,
        safeDiff: {},
        status: 409,
        title: 'StorageNode version conflict',
        type: 'https://inventory-atlas.local/problems/storage-version-conflict',
      });
    return new BadRequestException({
      code: 'VALIDATION_FAILED',
      detail: error.message,
      fieldErrors: [{ field: error.fieldKey, messages: [error.code] }],
      requestId,
      status: 400,
      title: 'Request validation failed',
      type: 'https://inventory-atlas.local/problems/validation-failed',
    });
  }
  if (error instanceof AttributeValidationError)
    return new BadRequestException({
      code: 'VALIDATION_FAILED',
      detail: 'One or more fields are invalid.',
      fieldErrors: error.issues.map((issue) => ({
        field: `attributes.${issue.fieldKey}`,
        messages: [issue.code],
      })),
      requestId,
      status: 400,
      title: 'Request validation failed',
      type: 'https://inventory-atlas.local/problems/validation-failed',
    });
  if (isStorageConcurrencyError(error))
    return new ConflictException({
      code: 'STORAGE_MOVE_CONFLICT',
      detail: 'The storage tree changed during this request. Reload it and try again.',
      requestId,
      status: 409,
      title: 'Storage tree conflict',
      type: 'https://inventory-atlas.local/problems/storage-move-conflict',
    });
  return error as Error;
}

function isStorageConcurrencyError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === '40001' || error.code === '40P01';
}
