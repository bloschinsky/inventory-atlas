import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Headers,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AttributeValidationError,
  ItemCreateError,
  ItemPolicyError,
  SessionError,
  type CreateItemInput,
  type SessionActor,
} from '@inventory-atlas/backend';
import { zCreateItemRequestDto } from '@inventory-atlas/contracts/zod';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { readSessionCookie } from './auth.http.js';
import { AUTH_RUNTIME, type AuthRuntimePort } from './auth.runtime.js';
import { CreatedItemDto, CreateItemRequestDto, ProblemDetailsDto } from './contract-models.js';
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

function mapItemError(error: unknown, requestId = 'unknown'): Error {
  if (error instanceof BadRequestException) return error;
  if (error instanceof SessionError) return new UnauthorizedException(error.message);
  if (error instanceof ItemPolicyError)
    return validationProblem([{ field: error.fieldKey, messages: [error.code] }], requestId);
  if (error instanceof AttributeValidationError)
    return validationProblem(
      error.issues.map((issue) => ({
        field: `attributes.${issue.fieldKey}`,
        messages: [issue.code],
      })),
      requestId,
    );
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
