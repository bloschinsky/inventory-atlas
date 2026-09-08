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
  HttpException,
  Inject,
  Ip,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuthAdministrationError,
  RateLimitError,
  SessionError,
  roles,
  type AuditMetadata,
  type InvitationSummary,
  type Role,
  type SessionActor,
  type UserSummary,
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
  ApiTags,
} from '@nestjs/swagger';
import { AUTH_RUNTIME, type AuthRuntimePort } from './auth.runtime.js';
import { readSessionCookie } from './auth.http.js';
import { ProblemDetailsDto } from './contract-models.js';

class UserSummaryDto {
  @ApiProperty({ format: 'uuid', type: String }) declare id: string;
  @ApiProperty({ format: 'email', type: String }) declare email: string;
  @ApiProperty({ type: String }) declare displayName: string;
  @ApiProperty({ enum: roles, type: String }) declare role: Role;
  @ApiProperty({ enum: ['en', 'uk'], type: String }) declare locale: 'en' | 'uk';
  @ApiProperty({ enum: ['active', 'disabled'], type: String }) declare status:
    'active' | 'disabled';
  @ApiProperty({ minimum: 1, type: Number }) declare version: number;
  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String }) declare archivedAt:
    string | null;
}

class InvitationSummaryDto {
  @ApiProperty({ format: 'uuid', type: String }) declare id: string;
  @ApiProperty({ format: 'email', type: String }) declare email: string;
  @ApiProperty({ enum: roles, type: String }) declare role: Role;
  @ApiProperty({ format: 'date-time', type: String }) declare expiresAt: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String }) declare acceptedAt:
    string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String }) declare revokedAt:
    string | null;
  @ApiProperty({ minimum: 1, type: Number }) declare version: number;
}

class IssuedInvitationDto extends InvitationSummaryDto {
  @ApiProperty({
    description: 'One-time token shown only when the invitation is issued.',
    type: String,
  })
  declare token: string;
}

class IssueInvitationDto {
  @ApiProperty({ format: 'email', type: String }) declare email: string;
  @ApiProperty({ enum: roles, type: String }) declare role: Role;
}

class AcceptInvitationDto {
  @ApiProperty({ type: String, writeOnly: true }) declare token: string;
  @ApiProperty({ maxLength: 200, type: String }) declare displayName: string;
  @ApiProperty({ maxLength: 1024, type: String, writeOnly: true }) declare password: string;
  @ApiPropertyOptional({ enum: ['en', 'uk'], type: String }) declare locale?: 'en' | 'uk';
}

class UpdateUserDto {
  @ApiProperty({ minimum: 1, type: Number }) declare expectedVersion: number;
  @ApiPropertyOptional({ enum: roles, type: String }) declare role?: Role;
  @ApiPropertyOptional({ enum: ['active', 'disabled'], type: String }) declare status?:
    'active' | 'disabled';
  @ApiPropertyOptional({
    description: 'Required from an Owner for changes affecting another Owner.',
    type: Boolean,
  })
  declare ownerConfirmation?: boolean;
}

@Controller('api/v1')
@ApiTags('authentication administration')
export class AuthAdministrationController {
  constructor(@Inject(AUTH_RUNTIME) private readonly runtime: AuthRuntimePort) {}

  @Get('admin/users')
  @ApiCookieAuth()
  @ApiOperation({ operationId: 'listUsers' })
  @ApiOkResponse({ type: [UserSummaryDto] })
  @ApiForbiddenResponse({ type: ProblemDetailsDto })
  async users(@Headers('cookie') cookie?: string): Promise<UserSummaryDto[]> {
    try {
      return (await this.runtime.authAdministration().listUsers(await this.actor(cookie))).map(
        userDto,
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get('admin/invitations')
  @ApiCookieAuth()
  @ApiOperation({ operationId: 'listInvitations' })
  @ApiOkResponse({ type: [InvitationSummaryDto] })
  async invitations(@Headers('cookie') cookie?: string): Promise<InvitationSummaryDto[]> {
    try {
      return (
        await this.runtime.authAdministration().listInvitations(await this.actor(cookie))
      ).map(invitationDto);
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post('admin/invitations')
  @ApiCookieAuth()
  @ApiOperation({ operationId: 'issueInvitation' })
  @ApiCreatedResponse({ type: IssuedInvitationDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  async issue(
    @Body() body: unknown,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
    @Req() request?: { headers: Record<string, string | undefined> },
    @Ip() ip?: string,
  ): Promise<IssuedInvitationDto> {
    if (!isIssueBody(body)) throw new BadRequestException('Invitation details are invalid.');
    try {
      const actor = await this.mutationActor(cookie, csrf);
      const issued = await this.runtime
        .authAdministration()
        .issueInvitation(actor, body, metadata(request, ip));
      return { ...invitationDto(issued), token: issued.token };
    } catch (error) {
      throw mapError(error);
    }
  }

  @Delete('admin/invitations/:id')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiOperation({ operationId: 'revokeInvitation' })
  @ApiNoContentResponse()
  async revokeInvitation(
    @Param('id') id: string,
    @Headers('if-match') ifMatch?: string,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
    @Req() request?: { headers: Record<string, string | undefined> },
    @Ip() ip?: string,
  ): Promise<void> {
    if (!uuidPattern.test(id)) throw new BadRequestException('Invitation ID is invalid.');
    try {
      await this.runtime
        .authAdministration()
        .revokeInvitation(
          await this.mutationActor(cookie, csrf),
          id,
          requireVersion(ifMatch),
          metadata(request, ip),
        );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post('auth/invitations/accept')
  @ApiOperation({ operationId: 'acceptInvitation' })
  @ApiCreatedResponse({ type: UserSummaryDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  async accept(
    @Body() body: unknown,
    @Req() request?: { headers: Record<string, string | undefined> },
    @Ip() ip?: string,
    @Res({ passthrough: true }) reply?: { header(name: string, value: string): void },
  ): Promise<UserSummaryDto> {
    if (!isAcceptBody(body))
      throw new BadRequestException('Invitation acceptance details are invalid.');
    const identity = `${ip ?? ''}|${body.token}`;
    try {
      this.runtime.authRateLimiter().consume('invitation', identity);
      const user = await this.runtime
        .authAdministration()
        .acceptInvitation(body.token, body, metadata(request, ip));
      this.runtime.authRateLimiter().reset('invitation', identity);
      return userDto(user);
    } catch (error) {
      if (error instanceof RateLimitError) {
        reply?.header('Retry-After', String(error.retryAfterSeconds));
        throw new HttpException(error.message, 429);
      }
      throw mapError(error);
    }
  }

  @Patch('admin/users/:id')
  @ApiCookieAuth()
  @ApiOperation({ operationId: 'updateUser' })
  @ApiOkResponse({ type: UserSummaryDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  async updateUser(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
    @Req() request?: { headers: Record<string, string | undefined> },
    @Ip() ip?: string,
  ): Promise<UserSummaryDto> {
    if (!uuidPattern.test(id) || !isUpdateUserBody(body))
      throw new BadRequestException('User change is invalid.');
    try {
      const user = await this.runtime
        .authAdministration()
        .updateUser(await this.mutationActor(cookie, csrf), id, body, metadata(request, ip));
      return userDto(user);
    } catch (error) {
      throw mapError(error);
    }
  }

  @Delete('admin/users/:id')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiOperation({ operationId: 'archiveUser' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async archiveUser(
    @Param('id') id: string,
    @Headers('if-match') ifMatch?: string,
    @Headers('x-owner-confirmation') confirmation?: string,
    @Headers('cookie') cookie?: string,
    @Headers('x-csrf-token') csrf?: string,
    @Req() request?: { headers: Record<string, string | undefined> },
    @Ip() ip?: string,
  ): Promise<void> {
    if (!uuidPattern.test(id)) throw new BadRequestException('User ID is invalid.');
    try {
      await this.runtime
        .authAdministration()
        .archiveUser(
          await this.mutationActor(cookie, csrf),
          id,
          requireVersion(ifMatch),
          confirmation === 'true',
          metadata(request, ip),
        );
    } catch (error) {
      throw mapError(error);
    }
  }

  private async actor(cookie: string | undefined, csrf?: string): Promise<SessionActor> {
    const token = readSessionCookie(cookie);
    if (!token) throw new SessionError('AUTH_SESSION_INVALID', 'Session is invalid or expired.');
    return (await this.runtime.authSessions().authenticate(token, csrf)).actor;
  }

  private async mutationActor(
    cookie: string | undefined,
    csrf: string | undefined,
  ): Promise<SessionActor> {
    if (!csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf))
      throw new SessionError('AUTH_CSRF_INVALID', 'CSRF token is invalid.');
    return this.actor(cookie, csrf);
  }
}

function metadata(
  request: { headers: Record<string, string | undefined> } | undefined,
  ip: string | undefined,
): AuditMetadata {
  const userAgent = request?.headers['user-agent'];
  const requestId = request?.headers['x-request-id'];
  const correlationId = request?.headers['x-correlation-id'];
  return {
    ...(ip ? { ipAddress: ip } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(requestId ? { requestId } : {}),
    ...(correlationId ? { correlationId } : {}),
  };
}

function userDto(value: UserSummary): UserSummaryDto {
  return { ...value, archivedAt: value.archivedAt?.toISOString() ?? null };
}
function invitationDto(value: InvitationSummary): InvitationSummaryDto {
  return {
    ...value,
    expiresAt: value.expiresAt.toISOString(),
    acceptedAt: value.acceptedAt?.toISOString() ?? null,
    revokedAt: value.revokedAt?.toISOString() ?? null,
  };
}
function isIssueBody(value: unknown): value is IssueInvitationDto {
  const body = record(value);
  return (
    !!body &&
    typeof body.email === 'string' &&
    body.email.length <= 320 &&
    typeof body.role === 'string' &&
    roles.includes(body.role as Role)
  );
}
function isAcceptBody(value: unknown): value is AcceptInvitationDto {
  const body = record(value);
  return (
    !!body &&
    typeof body.token === 'string' &&
    typeof body.displayName === 'string' &&
    body.displayName.trim().length > 0 &&
    body.displayName.length <= 200 &&
    typeof body.password === 'string' &&
    body.password.length > 0 &&
    body.password.length <= 1024 &&
    (body.locale === undefined || body.locale === 'en' || body.locale === 'uk')
  );
}
function isUpdateUserBody(value: unknown): value is UpdateUserDto {
  const body = record(value);
  return (
    !!body &&
    Number.isSafeInteger(body.expectedVersion) &&
    Number(body.expectedVersion) > 0 &&
    (body.role === undefined ||
      (typeof body.role === 'string' && roles.includes(body.role as Role))) &&
    (body.status === undefined || body.status === 'active' || body.status === 'disabled') &&
    (body.ownerConfirmation === undefined || typeof body.ownerConfirmation === 'boolean')
  );
}
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}
function requireVersion(value: string | undefined): number {
  const normalized = value?.replace(/^W\//, '').replaceAll('"', '');
  const version = Number(normalized);
  if (!Number.isSafeInteger(version) || version <= 0)
    throw new BadRequestException('If-Match must contain a positive version.');
  return version;
}
function mapError(error: unknown): Error {
  if (error instanceof SessionError) return new UnauthorizedException(error.message);
  if (!(error instanceof AuthAdministrationError)) return error as Error;
  if (error.code === 'AUTH_FORBIDDEN') return new ForbiddenException(error.message);
  if (error.code === 'AUTH_USER_NOT_FOUND' || error.code === 'AUTH_INVITATION_NOT_FOUND')
    return new NotFoundException(error.message);
  if (
    error.code === 'AUTH_VERSION_CONFLICT' ||
    error.code === 'AUTH_INVITATION_EMAIL_EXISTS' ||
    error.code === 'AUTH_LAST_OWNER_REQUIRED'
  )
    return new ConflictException(error.message);
  return new BadRequestException(error.message);
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
