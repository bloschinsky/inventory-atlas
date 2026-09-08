import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  HttpCode,
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
  permissionsFor,
  RateLimitError,
  SessionError,
  sessionPolicy,
  type SessionActor,
} from '@inventory-atlas/backend';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AUTH_RUNTIME, type AuthRuntimePort } from './auth.runtime.js';
import { clearedSessionCookie, readSessionCookie, sessionCookie } from './auth.http.js';
import { ProblemDetailsDto } from './contract-models.js';

class SignInRequestDto {
  @ApiProperty({ example: 'owner@example.test', format: 'email', type: String })
  declare email: string;

  @ApiProperty({ example: 'correct horse battery staple', type: String, writeOnly: true })
  declare password: string;
}

class SessionActorDto implements SessionActor {
  @ApiProperty({ format: 'uuid', type: String })
  declare id: string;

  @ApiProperty({ format: 'email', type: String })
  declare email: string;

  @ApiProperty({ type: String })
  declare displayName: string;

  @ApiProperty({ enum: ['en', 'uk'], type: String })
  declare locale: 'en' | 'uk';

  @ApiProperty({ enum: ['viewer', 'editor', 'admin', 'owner'], type: String })
  declare role: 'viewer' | 'editor' | 'admin' | 'owner';

  @ApiProperty({ enum: permissionsFor('owner'), isArray: true, type: String })
  declare permissions: SessionActor['permissions'];
}

class SessionResponseDto {
  @ApiProperty({ format: 'uuid', type: String })
  declare sessionId: string;

  @ApiProperty({ type: String, description: 'Send as X-CSRF-Token on authenticated mutations.' })
  declare csrfToken: string;

  @ApiProperty({ format: 'date-time', type: String })
  declare idleExpiresAt: string;

  @ApiProperty({ format: 'date-time', type: String })
  declare absoluteExpiresAt: string;

  @ApiProperty({ type: SessionActorDto })
  declare actor: SessionActorDto;
}

class CurrentSessionResponseDto {
  @ApiProperty({ format: 'uuid', type: String })
  declare sessionId: string;

  @ApiProperty({ type: String, description: 'Send as X-CSRF-Token on authenticated mutations.' })
  declare csrfToken: string;

  @ApiProperty({ format: 'date-time', type: String })
  declare idleExpiresAt: string;

  @ApiProperty({ format: 'date-time', type: String })
  declare absoluteExpiresAt: string;

  @ApiProperty({ type: SessionActorDto })
  declare actor: SessionActorDto;
}

class SessionSummaryDto {
  @ApiProperty({ format: 'uuid', type: String }) declare id: string;
  @ApiProperty({ format: 'date-time', type: String }) declare createdAt: string;
  @ApiProperty({ format: 'date-time', type: String }) declare lastSeenAt: string;
  @ApiProperty({ format: 'date-time', type: String }) declare idleExpiresAt: string;
  @ApiProperty({ format: 'date-time', type: String }) declare absoluteExpiresAt: string;
  @ApiProperty({ type: Boolean }) declare current: boolean;
  @ApiPropertyOptional({ nullable: true, type: String }) declare userAgentSummary: string | null;
}

class UpdateLocaleRequestDto {
  @ApiProperty({ enum: ['en', 'uk'], type: String }) declare locale: 'en' | 'uk';
}

interface RequestHeaders {
  cookie?: string;
  'user-agent'?: string;
  'x-request-id'?: string;
  'x-correlation-id'?: string;
}

interface ReplyHeaders {
  header(name: string, value: string): void;
}

@Controller('api/v1/auth')
@ApiTags('authentication')
export class AuthController {
  constructor(@Inject(AUTH_RUNTIME) private readonly runtime: AuthRuntimePort) {}

  @Post('session')
  @HttpCode(200)
  @ApiOperation({ operationId: 'createAuthSession' })
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiUnauthorizedResponse({ type: ProblemDetailsDto })
  async signIn(
    @Body() body: unknown,
    @Ip() ipAddress: string,
    @Req() request: { headers: RequestHeaders },
    @Res({ passthrough: true }) reply: ReplyHeaders,
  ): Promise<SessionResponseDto> {
    if (!isSignInBody(body)) throw new BadRequestException('Email and password are required.');
    const rateIdentity = `${ipAddress}|${body.email.trim().toLowerCase()}`;
    try {
      this.runtime.authRateLimiter().consume('sign-in', rateIdentity);
      const userAgent = request.headers['user-agent'];
      const issued = await this.runtime.authSessions().signIn(body.email, body.password, {
        ipAddress,
        ...(userAgent ? { userAgent } : {}),
        ...(request.headers['x-request-id'] ? { requestId: request.headers['x-request-id'] } : {}),
        ...(request.headers['x-correlation-id']
          ? { correlationId: request.headers['x-correlation-id'] }
          : {}),
      });
      reply.header(
        'Set-Cookie',
        sessionCookie(
          issued.token,
          this.runtime.secureSessionCookies(),
          sessionPolicy.absoluteLifetimeMs / 1_000,
        ),
      );
      reply.header('Cache-Control', 'no-store');
      this.runtime.authRateLimiter().reset('sign-in', rateIdentity);
      return {
        sessionId: issued.id,
        csrfToken: issued.csrfToken,
        idleExpiresAt: issued.idleExpiresAt.toISOString(),
        absoluteExpiresAt: issued.absoluteExpiresAt.toISOString(),
        actor: issued.actor,
      };
    } catch (error) {
      if (error instanceof RateLimitError) {
        reply.header('Retry-After', String(error.retryAfterSeconds));
        throw new HttpException(error.message, 429);
      }
      throw mapSessionError(error);
    }
  }

  @Get('sessions')
  @ApiCookieAuth()
  @ApiOperation({ operationId: 'listAuthSessions' })
  @ApiOkResponse({ type: [SessionSummaryDto] })
  @ApiUnauthorizedResponse({ type: ProblemDetailsDto })
  async sessions(@Headers('cookie') cookieHeader?: string): Promise<SessionSummaryDto[]> {
    try {
      const sessions = await this.runtime.authSessions().listOwned(requireSession(cookieHeader));
      return sessions.map((session) => ({
        ...session,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        idleExpiresAt: session.idleExpiresAt.toISOString(),
        absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      }));
    } catch (error) {
      throw mapSessionError(error);
    }
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({ operationId: 'getCurrentActor' })
  @ApiOkResponse({ type: CurrentSessionResponseDto })
  @ApiUnauthorizedResponse({ type: ProblemDetailsDto })
  async current(
    @Headers('cookie') cookieHeader: string | undefined,
    @Res({ passthrough: true }) reply: ReplyHeaders,
  ): Promise<CurrentSessionResponseDto> {
    reply.header('Cache-Control', 'no-store');
    try {
      const current = await this.runtime.authSessions().authenticate(requireSession(cookieHeader));
      return {
        sessionId: current.id,
        csrfToken: current.csrfToken,
        idleExpiresAt: current.idleExpiresAt.toISOString(),
        absoluteExpiresAt: current.absoluteExpiresAt.toISOString(),
        actor: current.actor,
      };
    } catch (error) {
      if (error instanceof SessionError && error.code === 'AUTH_SESSION_INVALID') {
        reply.header('Set-Cookie', clearedSessionCookie(this.runtime.secureSessionCookies()));
      }
      throw mapSessionError(error);
    }
  }

  @Patch('me/locale')
  @ApiCookieAuth()
  @ApiOperation({ operationId: 'updateCurrentActorLocale' })
  @ApiBody({ type: UpdateLocaleRequestDto })
  @ApiOkResponse({ type: SessionActorDto })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto })
  @ApiUnauthorizedResponse({ type: ProblemDetailsDto })
  async updateLocale(
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('x-csrf-token') csrfToken: string | undefined,
    @Req() request: { headers: RequestHeaders },
    @Ip() ipAddress: string,
  ): Promise<SessionActorDto> {
    if (!isLocaleBody(body)) throw new BadRequestException('Language preference is invalid.');
    try {
      return await this.runtime
        .authSessions()
        .updateLocale(requireSession(cookieHeader), requireCsrf(csrfToken), body.locale, {
          ipAddress,
          ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
          ...(request.headers['x-request-id']
            ? { requestId: request.headers['x-request-id'] }
            : {}),
          ...(request.headers['x-correlation-id']
            ? { correlationId: request.headers['x-correlation-id'] }
            : {}),
        });
    } catch (error) {
      throw mapSessionError(error);
    }
  }

  @Delete('session')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiOperation({ operationId: 'deleteAuthSession' })
  @ApiNoContentResponse({ description: 'The current session was revoked.' })
  @ApiUnauthorizedResponse({ type: ProblemDetailsDto })
  async signOut(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('x-csrf-token') csrfToken: string | undefined,
    @Res({ passthrough: true }) reply: ReplyHeaders,
  ): Promise<void> {
    try {
      await this.runtime
        .authSessions()
        .revokeCurrent(requireSession(cookieHeader), requireCsrf(csrfToken));
      reply.header('Set-Cookie', clearedSessionCookie(this.runtime.secureSessionCookies()));
      reply.header('Cache-Control', 'no-store');
    } catch (error) {
      throw mapSessionError(error);
    }
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiOperation({ operationId: 'revokeAuthSession' })
  @ApiNoContentResponse({ description: 'The selected owned session was revoked.' })
  @ApiBadRequestResponse({ type: ProblemDetailsDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  @ApiUnauthorizedResponse({ type: ProblemDetailsDto })
  async revoke(
    @Param('id') sessionId: string,
    @Headers('cookie') cookieHeader?: string,
    @Headers('x-csrf-token') csrfToken?: string,
  ): Promise<void> {
    if (!uuidPattern.test(sessionId)) throw new BadRequestException('Session ID is invalid.');
    try {
      await this.runtime
        .authSessions()
        .revokeOwned(requireSession(cookieHeader), requireCsrf(csrfToken), sessionId);
    } catch (error) {
      throw mapSessionError(error);
    }
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSignInBody(value: unknown): value is SignInRequestDto {
  if (typeof value !== 'object' || value === null) return false;
  const email = (value as Record<string, unknown>).email;
  const password = (value as Record<string, unknown>).password;
  return (
    typeof email === 'string' &&
    typeof password === 'string' &&
    email.length <= 320 &&
    password.length > 0 &&
    password.length <= 1_024
  );
}

function isLocaleBody(value: unknown): value is UpdateLocaleRequestDto {
  if (typeof value !== 'object' || value === null) return false;
  const locale = (value as Record<string, unknown>).locale;
  return locale === 'en' || locale === 'uk';
}

function requireSession(cookieHeader: string | undefined): string {
  const token = readSessionCookie(cookieHeader);
  if (!token) throw new SessionError('AUTH_SESSION_INVALID', 'Session is invalid or expired.');
  return token;
}

function requireCsrf(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new SessionError('AUTH_CSRF_INVALID', 'CSRF token is invalid.');
  }
  return value;
}

function mapSessionError(error: unknown): Error {
  if (!(error instanceof SessionError)) return error as Error;
  if (error.code === 'AUTH_LOCALE_CONFLICT') return new HttpException(error.message, 409);
  if (error.code === 'AUTH_SESSION_NOT_FOUND') return new NotFoundException(error.message);
  return new UnauthorizedException(error.message);
}
