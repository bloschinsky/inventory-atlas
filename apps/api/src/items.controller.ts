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
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AttributeValidationError,
  ItemAccessError,
  ItemCreateError,
  ItemMovementCursorError,
  ItemPolicyError,
  ItemVersionConflictError,
  SessionError,
  StorageProjectionDestinationError,
  type CreateItemInput,
  type ItemDetail,
  type SessionActor,
  type UpdateItemInput,
} from '@inventory-atlas/backend';
import { zCreateItemRequestDto, zUpdateItemRequestDto } from '@inventory-atlas/contracts/zod';
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
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { readSessionCookie } from './auth.http.js';
import { AUTH_RUNTIME, type AuthRuntimePort } from './auth.runtime.js';
import {
  CreatedItemDto,
  CreateItemRequestDto,
  ItemDetailDto,
  ItemMovementPageDto,
  MoveItemRequestDto,
  ProblemDetailsDto,
  UpdatedItemDto,
  UpdateItemRequestDto,
  VersionConflictProblemDto,
} from './contract-models.js';
import { ITEMS_RUNTIME, type ItemsRuntimePort } from './items.runtime.js';

@Controller('api/v1/items')
@ApiCookieAuth()
@ApiTags('items')
@ApiUnauthorizedResponse({ type: ProblemDetailsDto })
@ApiForbiddenResponse({ type: ProblemDetailsDto })
export class ItemsController {
  constructor(
    @Inject(AUTH_RUNTIME) private readonly auth: AuthRuntimePort,
    @Inject(ITEMS_RUNTIME) private readonly items: ItemsRuntimePort,
  ) {}

  @Post()
  @ApiOperation({ operationId: 'createItem' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: CreateItemRequestDto })
  @ApiCreatedResponse({ type: CreatedItemDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  @ApiServiceUnavailableResponse({ type: ProblemDetailsDto })
  async createItem(
    @Body() body: unknown,
    @Headers('cookie') cookie: string | undefined,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
    @Res({ passthrough: true }) response: { header(name: string, value: string): void },
  ): Promise<CreatedItemDto> {
    try {
      const input = readCreateItem(body, request.headers['x-request-id']);
      const outcome = await this.items
        .catalogItems()
        .create(await this.actor(cookie, csrf), input, {
          idempotencyKey: idempotencyKey ?? '',
          ...(request.headers['x-request-id']
            ? { requestId: request.headers['x-request-id'] }
            : {}),
          ...(request.headers['x-correlation-id']
            ? { correlationId: request.headers['x-correlation-id'] }
            : {}),
        });
      response.header('ETag', `"${outcome.item.version}"`);
      if (outcome.replayed) response.header('Idempotency-Replayed', 'true');
      return outcome.item;
    } catch (error) {
      throw mapItemError(error, request.headers['x-request-id']);
    }
  }

  @Get(':publicId')
  @ApiOperation({ operationId: 'getItem' })
  @ApiParam({ format: 'uuid', name: 'publicId', type: String })
  @ApiOkResponse({ type: ItemDetailDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async getItem(
    @Param('publicId') publicId: string,
    @Headers('cookie') cookie: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
    @Res({ passthrough: true }) response: { header(name: string, value: string): void },
  ): Promise<ItemDetailDto> {
    requirePublicId(publicId);
    try {
      const item = await this.items.catalogItems().get(await this.reader(cookie), publicId);
      response.header('ETag', `"${item.version}"`);
      return detailDto(item);
    } catch (error) {
      throw mapItemError(error, request.headers['x-request-id']);
    }
  }

  @Patch(':publicId')
  @ApiOperation({ operationId: 'updateItem' })
  @ApiParam({ format: 'uuid', name: 'publicId', type: String })
  @ApiHeader({
    name: 'If-Match',
    required: false,
    description:
      'Expected aggregate version. Required unless the body carries `expectedVersion`; both ' +
      'must agree when both are present.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiBody({ type: UpdateItemRequestDto })
  @ApiOkResponse({ type: UpdatedItemDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: VersionConflictProblemDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  @ApiServiceUnavailableResponse({ type: ProblemDetailsDto })
  async updateItem(
    @Param('publicId') publicId: string,
    @Body() body: unknown,
    @Headers('cookie') cookie: string | undefined,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
    @Res({ passthrough: true }) response: { header(name: string, value: string): void },
  ): Promise<UpdatedItemDto> {
    const requestId = request.headers['x-request-id'];
    requirePublicId(publicId);
    try {
      const { expectedVersion, ...change } = readUpdateItem(body, ifMatch, requestId);
      const outcome = await this.items
        .catalogItems()
        .update(await this.actor(cookie, csrf), publicId, expectedVersion, change, {
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...(requestId ? { requestId } : {}),
          ...(request.headers['x-correlation-id']
            ? { correlationId: request.headers['x-correlation-id'] }
            : {}),
        });
      response.header('ETag', `"${outcome.item.version}"`);
      if (outcome.replayed) response.header('Idempotency-Replayed', 'true');
      return { ...outcome.item, invalidators: [...outcome.invalidators] };
    } catch (error) {
      throw mapItemError(error, requestId);
    }
  }

  @Post(':publicId/move')
  @HttpCode(200)
  @ApiOperation({ operationId: 'moveItem' })
  @ApiParam({ format: 'uuid', name: 'publicId', type: String })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: MoveItemRequestDto })
  @ApiOkResponse({ type: UpdatedItemDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: VersionConflictProblemDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  @ApiServiceUnavailableResponse({ type: ProblemDetailsDto })
  async moveItem(
    @Param('publicId') publicId: string,
    @Body() body: unknown,
    @Headers('cookie') cookie: string | undefined,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
    @Res({ passthrough: true }) response: { header(name: string, value: string): void },
  ): Promise<UpdatedItemDto> {
    const requestId = request.headers['x-request-id'];
    requirePublicId(publicId);
    try {
      const input = readMoveItem(body, ifMatch, requestId);
      const outcome = await this.items.catalogItems().move(
        await this.actor(cookie, csrf),
        publicId,
        input.expectedVersion,
        { storageNodeId: input.storageNodeId, ...(input.reason ? { reason: input.reason } : {}) },
        {
          idempotencyKey: idempotencyKey ?? '',
          ...(requestId ? { requestId } : {}),
          ...(request.headers['x-correlation-id']
            ? { correlationId: request.headers['x-correlation-id'] }
            : {}),
        },
      );
      response.header('ETag', `"${outcome.item.version}"`);
      if (outcome.replayed) response.header('Idempotency-Replayed', 'true');
      return { ...outcome.item, invalidators: [...outcome.invalidators] };
    } catch (error) {
      throw mapItemError(error, requestId);
    }
  }

  @Get(':publicId/movements')
  @ApiOperation({ operationId: 'listItemMovements' })
  @ApiParam({ format: 'uuid', name: 'publicId', type: String })
  @ApiOkResponse({ type: ItemMovementPageDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async listItemMovements(
    @Param('publicId') publicId: string,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
  ): Promise<ItemMovementPageDto> {
    const requestId = request.headers['x-request-id'];
    requirePublicId(publicId);
    try {
      return await this.items.catalogItems().movements(await this.reader(cookie), publicId, {
        limit: readMovementLimit(limit, requestId),
        ...(cursor ? { cursor } : {}),
      });
    } catch (error) {
      throw mapItemError(error, requestId);
    }
  }

  private async reader(cookie: string | undefined): Promise<SessionActor> {
    const token = readSessionCookie(cookie);
    if (!token) throw new SessionError('AUTH_SESSION_INVALID', 'Session is invalid or expired.');
    return (await this.auth.authSessions().authenticate(token)).actor;
  }

  private async actor(cookie: string | undefined, csrf: string | undefined): Promise<SessionActor> {
    if (!csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf))
      throw new SessionError('AUTH_CSRF_INVALID', 'CSRF token is invalid.');
    const token = readSessionCookie(cookie);
    if (!token) throw new SessionError('AUTH_SESSION_INVALID', 'Session is invalid or expired.');
    return (await this.auth.authSessions().authenticate(token, csrf)).actor;
  }
}

function readCreateItem(value: unknown, requestId = 'unknown'): CreateItemInput {
  const parsed = zCreateItemRequestDto.safeParse(value);
  if (!parsed.success)
    throw validationProblem(
      parsed.error.issues.map((issue) => ({
        field: issue.path.length ? issue.path.join('.') : '$',
        messages: [issue.message],
      })),
      requestId,
    );
  return {
    categoryId: parsed.data.categoryId,
    lifecycleStatusId: parsed.data.lifecycleStatusId,
    displayName: parsed.data.displayName,
    ...(parsed.data.description === undefined ? {} : { description: parsed.data.description }),
    ...(parsed.data.visibility === undefined ? {} : { visibility: parsed.data.visibility }),
    ...(parsed.data.storageNodeId === undefined
      ? {}
      : { storageNodeId: parsed.data.storageNodeId }),
    ...(parsed.data.tags === undefined ? {} : { tags: parsed.data.tags }),
    ...(parsed.data.attributes === undefined ? {} : { attributes: parsed.data.attributes }),
  };
}

function detailDto(item: ItemDetail): ItemDetailDto {
  return { ...item, tags: [...item.tags], attributes: { ...item.attributes } };
}

function requirePublicId(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))
    throw new BadRequestException('The Item public ID is invalid.');
}

/** Parses `If-Match` in both strong and weak form; a non-numeric entity tag is rejected. */
function parseIfMatch(value: string | undefined): number | null {
  if (value === undefined) return null;
  const version = Number(value.trim().replace(/^W\//u, '').replaceAll('"', ''));
  if (!Number.isSafeInteger(version) || version < 1)
    throw new BadRequestException('If-Match must contain a positive version.');
  return version;
}

function readUpdateItem(
  value: unknown,
  ifMatch: string | undefined,
  requestId = 'unknown',
): UpdateItemInput & { expectedVersion: number } {
  const headerVersion = parseIfMatch(ifMatch);
  const parsed = zUpdateItemRequestDto.safeParse(
    headerVersion !== null && isRecord(value) && value.expectedVersion === undefined
      ? { ...value, expectedVersion: headerVersion }
      : value,
  );
  if (!parsed.success)
    throw validationProblem(
      parsed.error.issues.map((issue) => ({
        field: issue.path.length ? issue.path.join('.') : '$',
        messages: [issue.message],
      })),
      requestId,
    );
  if (headerVersion !== null && headerVersion !== parsed.data.expectedVersion)
    throw validationProblem(
      [{ field: 'expectedVersion', messages: ['IF_MATCH_MISMATCH'] }],
      requestId,
    );
  return {
    expectedVersion: parsed.data.expectedVersion,
    ...(parsed.data.categoryId === undefined ? {} : { categoryId: parsed.data.categoryId }),
    ...(parsed.data.lifecycleStatusId === undefined
      ? {}
      : { lifecycleStatusId: parsed.data.lifecycleStatusId }),
    ...(parsed.data.displayName === undefined ? {} : { displayName: parsed.data.displayName }),
    ...(parsed.data.description === undefined ? {} : { description: parsed.data.description }),
    ...(parsed.data.visibility === undefined ? {} : { visibility: parsed.data.visibility }),
    ...(parsed.data.storageNodeId === undefined
      ? {}
      : { storageNodeId: parsed.data.storageNodeId }),
    ...(parsed.data.tags === undefined ? {} : { tags: parsed.data.tags }),
    ...(parsed.data.attributes === undefined ? {} : { attributes: parsed.data.attributes }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapItemError(error: unknown, requestId = 'unknown'): Error {
  if (error instanceof BadRequestException) return error;
  if (error instanceof SessionError) return new UnauthorizedException(error.message);
  if (error instanceof ItemAccessError)
    return error.code === 'ITEM_NOT_FOUND'
      ? new NotFoundException(error.message)
      : new ForbiddenException(error.message);
  if (error instanceof ItemVersionConflictError)
    return new ConflictException({
      code: error.code,
      currentVersion: error.currentVersion,
      detail: error.message,
      requestId,
      safeDiff: error.safeDiff,
      status: 409,
      title: 'Item version conflict',
      type: 'https://inventory-atlas.local/problems/item-version-conflict',
    });
  if (error instanceof ItemPolicyError)
    return validationProblem([{ field: error.fieldKey, messages: [error.code] }], requestId);
  if (error instanceof StorageProjectionDestinationError)
    return validationProblem([{ field: 'storageNodeId', messages: [error.code] }], requestId);
  if (error instanceof AttributeValidationError)
    return validationProblem(
      error.issues.map((issue) => ({
        field: `attributes.${issue.fieldKey}`,
        messages: [issue.code],
      })),
      requestId,
    );
  if (error instanceof ItemMovementCursorError)
    return validationProblem([{ field: 'cursor', messages: [error.code] }], requestId);
  if (error instanceof ItemCreateError) {
    if (error.code === 'ITEM_CREATE_FORBIDDEN') return new ForbiddenException(error.message);
    if (error.code === 'ITEM_IDEMPOTENCY_IN_PROGRESS')
      return new ServiceUnavailableException({
        code: error.code,
        detail: error.message,
        requestId,
        status: 503,
        title: 'Request is still in progress',
        type: 'https://inventory-atlas.local/problems/idempotency-in-progress',
      });
    if (error.code === 'ITEM_IDEMPOTENCY_CONFLICT')
      return new ConflictException({
        code: error.code,
        detail: error.message,
        requestId,
        status: 409,
        title: 'Idempotency conflict',
        type: 'https://inventory-atlas.local/problems/idempotency-conflict',
      });
    return validationProblem([{ field: 'idempotencyKey', messages: [error.code] }], requestId);
  }
  return error as Error;
}

function readMoveItem(
  value: unknown,
  ifMatch: string | undefined,
  requestId: string | undefined,
): { expectedVersion: number; storageNodeId: string | null; reason?: string } {
  const headerVersion = parseIfMatch(ifMatch);
  if (!isRecord(value))
    throw validationProblem([{ field: '$', messages: ['Expected an object.'] }], requestId);
  const expectedVersion =
    value.expectedVersion === undefined ? headerVersion : Number(value.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1)
    throw validationProblem(
      [{ field: 'expectedVersion', messages: ['Expected a positive integer.'] }],
      requestId,
    );
  if (headerVersion === null || headerVersion !== expectedVersion)
    throw validationProblem(
      [{ field: 'expectedVersion', messages: ['IF_MATCH_MISMATCH'] }],
      requestId,
    );
  const storageNodeId = value.storageNodeId;
  if (
    storageNodeId !== null &&
    (typeof storageNodeId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        storageNodeId,
      ))
  )
    throw validationProblem(
      [{ field: 'storageNodeId', messages: ['Expected a UUID or null.'] }],
      requestId,
    );
  if (
    value.reason !== undefined &&
    (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.trim().length > 512)
  )
    throw validationProblem(
      [{ field: 'reason', messages: ['Expected between 1 and 512 characters.'] }],
      requestId,
    );
  return {
    expectedVersion: Number(expectedVersion),
    storageNodeId,
    ...(typeof value.reason === 'string' ? { reason: value.reason.trim() } : {}),
  };
}

function readMovementLimit(value: string | undefined, requestId: string | undefined): number {
  if (value === undefined) return 25;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw validationProblem(
      [{ field: 'limit', messages: ['Expected an integer between 1 and 100.'] }],
      requestId,
    );
  return limit;
}

function validationProblem(
  fieldErrors: { field: string; messages: string[] }[],
  requestId = 'unknown',
): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    detail: 'One or more fields are invalid.',
    fieldErrors,
    requestId,
    status: 400,
    title: 'Request validation failed',
    type: 'https://inventory-atlas.local/problems/validation-failed',
  });
}
