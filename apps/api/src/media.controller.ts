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
  Put,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  MediaAccessError,
  MediaPolicyError,
  MediaVersionConflictError,
  SessionError,
  type MediaView,
  type SessionActor,
  type UploadSessionView,
} from '@inventory-atlas/backend';
import {
  zBeginUploadRequestDto,
  zFinalizeUploadRequestDto,
  zReorderMediaRequestDto,
} from '@inventory-atlas/contracts/zod';
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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { readSessionCookie } from './auth.http.js';
import { AUTH_RUNTIME, type AuthRuntimePort } from './auth.runtime.js';
import {
  BeginUploadRequestDto,
  FinalizeUploadRequestDto,
  MediaItemDto,
  ProblemDetailsDto,
  ReorderMediaRequestDto,
  UploadSessionDto,
  VersionConflictProblemDto,
} from './contract-models.js';
import { MEDIA_RUNTIME, type MediaRuntimePort } from './media.runtime.js';

@Controller('api/v1')
@ApiCookieAuth()
@ApiTags('media')
@ApiUnauthorizedResponse({ type: ProblemDetailsDto })
@ApiForbiddenResponse({ type: ProblemDetailsDto })
export class MediaController {
  constructor(
    @Inject(AUTH_RUNTIME) private readonly auth: AuthRuntimePort,
    @Inject(MEDIA_RUNTIME) private readonly media: MediaRuntimePort,
  ) {}

  @Post('media/upload-sessions')
  @ApiOperation({ operationId: 'beginMediaUpload' })
  @ApiBody({ type: BeginUploadRequestDto })
  @ApiCreatedResponse({ type: UploadSessionDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async beginUpload(
    @Body() body: unknown,
    @Headers('cookie') cookie: string | undefined,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
  ): Promise<UploadSessionDto> {
    const requestId = request.headers['x-request-id'];
    try {
      const input = readBeginUpload(body, requestId);
      return sessionDto(
        await this.media.media().beginUpload(await this.actor(cookie, csrf), input),
      );
    } catch (error) {
      throw mapMediaError(error, requestId);
    }
  }

  /**
   * Streams the declared file into temporary storage. The session already carries the filename,
   * media type and byte size, so the request body is the raw object and nothing else.
   */
  @Put('media/upload-sessions/:id/content')
  @ApiOperation({ operationId: 'uploadMediaContent' })
  @ApiParam({ format: 'uuid', name: 'id', type: String })
  @ApiBody({ description: 'Raw image bytes.', schema: { format: 'binary', type: 'string' } })
  @ApiOkResponse({ type: UploadSessionDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async uploadContent(
    @Param('id') id: string,
    @Headers('cookie') cookie: string | undefined,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Req() request: { headers: Record<string, string | undefined>; raw: Readable },
  ): Promise<UploadSessionDto> {
    const requestId = request.headers['x-request-id'];
    requireUuid(id, 'The upload session ID is invalid.');
    try {
      return sessionDto(
        await this.media.media().receiveContent(await this.actor(cookie, csrf), id, request.raw),
      );
    } catch (error) {
      throw mapMediaError(error, requestId);
    }
  }

  @Post('media/upload-sessions/:id/finalize')
  @HttpCode(201)
  @ApiOperation({ operationId: 'finalizeMediaUpload' })
  @ApiParam({ format: 'uuid', name: 'id', type: String })
  @ApiBody({ type: FinalizeUploadRequestDto })
  @ApiCreatedResponse({ type: MediaItemDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async finalizeUpload(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('cookie') cookie: string | undefined,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
  ): Promise<MediaItemDto> {
    const requestId = request.headers['x-request-id'];
    requireUuid(id, 'The upload session ID is invalid.');
    try {
      const input = readFinalizeUpload(body, requestId);
      return mediaDto(
        await this.media
          .media()
          .finalizeUpload(await this.actor(cookie, csrf), id, input, metadataFor(request)),
      );
    } catch (error) {
      throw mapMediaError(error, requestId);
    }
  }

  @Get('items/:publicId/media')
  @ApiOperation({ operationId: 'listItemMedia' })
  @ApiParam({ format: 'uuid', name: 'publicId', type: String })
  @ApiOkResponse({ type: [MediaItemDto] })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async listItemMedia(
    @Param('publicId') publicId: string,
    @Headers('cookie') cookie: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
  ): Promise<MediaItemDto[]> {
    requireUuid(publicId, 'The Item public ID is invalid.');
    try {
      return (await this.media.media().listItemMedia(await this.reader(cookie), publicId)).map(
        mediaDto,
      );
    } catch (error) {
      throw mapMediaError(error, request.headers['x-request-id']);
    }
  }

  @Patch('media/relations/reorder')
  @ApiOperation({ operationId: 'reorderItemMedia' })
  @ApiBody({ type: ReorderMediaRequestDto })
  @ApiOkResponse({ type: [MediaItemDto] })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: VersionConflictProblemDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async reorder(
    @Body() body: unknown,
    @Headers('cookie') cookie: string | undefined,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
  ): Promise<MediaItemDto[]> {
    const requestId = request.headers['x-request-id'];
    try {
      const input = readReorder(body, requestId);
      return (
        await this.media
          .media()
          .reorderGallery(
            await this.actor(cookie, csrf),
            input.itemPublicId,
            input.expectedVersion,
            input.order,
            metadataFor(request),
          )
      ).map(mediaDto);
    } catch (error) {
      throw mapMediaError(error, requestId);
    }
  }

  @Post('media/relations/:id/primary')
  @HttpCode(200)
  @ApiOperation({ operationId: 'setPrimaryItemMedia' })
  @ApiParam({ format: 'uuid', name: 'id', type: String })
  @ApiOkResponse({ type: [MediaItemDto] })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: VersionConflictProblemDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async setPrimary(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
  ): Promise<MediaItemDto[]> {
    const requestId = request.headers['x-request-id'];
    requireUuid(id, 'The media relation ID is invalid.');
    try {
      return (
        await this.media
          .media()
          .setPrimary(
            await this.actor(cookie, csrf),
            id,
            requireVersion(ifMatch),
            metadataFor(request),
          )
      ).map(mediaDto);
    } catch (error) {
      throw mapMediaError(error, requestId);
    }
  }

  @Delete('media/relations/:id')
  @HttpCode(204)
  @ApiOperation({ operationId: 'detachItemMedia' })
  @ApiParam({ format: 'uuid', name: 'id', type: String })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: VersionConflictProblemDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async detach(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
  ): Promise<void> {
    const requestId = request.headers['x-request-id'];
    requireUuid(id, 'The media relation ID is invalid.');
    try {
      await this.media
        .media()
        .detachRelation(
          await this.actor(cookie, csrf),
          id,
          requireVersion(ifMatch),
          metadataFor(request),
        );
    } catch (error) {
      throw mapMediaError(error, requestId);
    }
  }

  @Get('media/assets/:id/content')
  @ApiOperation({ operationId: 'readMediaAsset' })
  @ApiParam({ format: 'uuid', name: 'id', type: String })
  @ApiOkResponse({ description: 'The stored image bytes.' })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async readAsset(
    @Param('id') id: string,
    @Headers('cookie') cookie: string | undefined,
    @Req() request: { headers: Record<string, string | undefined> },
    @Res({ passthrough: true }) response: { header(name: string, value: string): void },
  ): Promise<Readable> {
    requireUuid(id, 'The media asset ID is invalid.');
    try {
      const { asset, content } = await this.media
        .media()
        .openAssetContent(await this.reader(cookie), id);
      response.header('Content-Type', asset.mimeType);
      response.header('Content-Length', String(asset.byteSize));
      response.header('ETag', `"${asset.checksumSha256}"`);
      // Stored bytes are immutable: a new upload always produces a new asset id.
      response.header('Cache-Control', 'private, max-age=31536000, immutable');
      response.header('Content-Disposition', 'inline');
      response.header('X-Content-Type-Options', 'nosniff');
      return content;
    } catch (error) {
      throw mapMediaError(error, request.headers['x-request-id']);
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

function metadataFor(request: { headers: Record<string, string | undefined> }): {
  requestId?: string;
  correlationId?: string;
} {
  const requestId = request.headers['x-request-id'];
  const correlationId = request.headers['x-correlation-id'];
  return { ...(requestId ? { requestId } : {}), ...(correlationId ? { correlationId } : {}) };
}

function sessionDto(session: UploadSessionView): UploadSessionDto {
  return { ...session };
}

function mediaDto(media: MediaView): MediaItemDto {
  return { ...media };
}

function readBeginUpload(
  value: unknown,
  requestId = 'unknown',
): { itemPublicId: string; filename: string; mimeType: string; byteSize: number } {
  const parsed = zBeginUploadRequestDto.safeParse(value);
  if (!parsed.success) throw validationProblem(issuesOf(parsed.error), requestId);
  return {
    itemPublicId: parsed.data.itemPublicId,
    filename: parsed.data.filename,
    mimeType: parsed.data.mimeType,
    byteSize: parsed.data.byteSize,
  };
}

function readFinalizeUpload(
  value: unknown,
  requestId = 'unknown',
): { checksumSha256?: string | null; role?: string; altText?: string | null; visibility?: string } {
  const parsed = zFinalizeUploadRequestDto.safeParse(value ?? {});
  if (!parsed.success) throw validationProblem(issuesOf(parsed.error), requestId);
  return {
    ...(parsed.data.checksumSha256 === undefined
      ? {}
      : { checksumSha256: parsed.data.checksumSha256 }),
    ...(parsed.data.role === undefined ? {} : { role: parsed.data.role }),
    ...(parsed.data.altText === undefined ? {} : { altText: parsed.data.altText }),
    ...(parsed.data.visibility === undefined ? {} : { visibility: parsed.data.visibility }),
  };
}

function readReorder(
  value: unknown,
  requestId = 'unknown',
): { itemPublicId: string; expectedVersion: number; order: string[] } {
  const parsed = zReorderMediaRequestDto.safeParse(value);
  if (!parsed.success) throw validationProblem(issuesOf(parsed.error), requestId);
  return {
    itemPublicId: parsed.data.itemPublicId,
    expectedVersion: parsed.data.expectedVersion,
    order: [...parsed.data.order],
  };
}

function issuesOf(error: { issues: { path: PropertyKey[]; message: string }[] }): {
  field: string;
  messages: string[];
}[] {
  return error.issues.map((issue) => ({
    field: issue.path.length ? issue.path.join('.') : '$',
    messages: [issue.message],
  }));
}

function requireUuid(value: string, message: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))
    throw new BadRequestException(message);
}

function requireVersion(value: string | undefined): number {
  const version = Number(value?.trim().replace(/^W\//u, '').replaceAll('"', ''));
  if (!Number.isSafeInteger(version) || version < 1)
    throw new BadRequestException('If-Match must contain a positive version.');
  return version;
}

function mapMediaError(error: unknown, requestId = 'unknown'): Error {
  if (error instanceof BadRequestException) return error;
  if (error instanceof SessionError) return new UnauthorizedException(error.message);
  if (error instanceof MediaPolicyError)
    return validationProblem([{ field: error.fieldKey, messages: [error.code] }], requestId);
  if (error instanceof MediaVersionConflictError)
    return new ConflictException({
      code: error.code,
      currentVersion: error.currentVersion,
      detail: error.message,
      requestId,
      safeDiff: {},
      status: 409,
      title: 'Item version conflict',
      type: 'https://inventory-atlas.local/problems/item-version-conflict',
    });
  if (error instanceof MediaAccessError) {
    if (error.code === 'MEDIA_FORBIDDEN') return new ForbiddenException(error.message);
    if (error.code === 'MEDIA_SESSION_STATE_INVALID' || error.code === 'MEDIA_SESSION_EXPIRED')
      return validationProblem([{ field: 'sessionId', messages: [error.code] }], requestId);
    return new NotFoundException(error.message);
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
