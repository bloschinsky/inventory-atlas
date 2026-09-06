export const supportedLocales = ['en', 'uk'] as const;
export const defaultLocale = 'en' as const;

export type SupportedLocale = (typeof supportedLocales)[number];
export type PublicCatalogMode = 'public' | 'authenticated';
export type JobRunnerMode = 'compact' | 'worker' | 'disabled';

export interface BootstrapSettings {
  appBaseUrl: string;
  defaultLocale: SupportedLocale;
  publicCatalogMode: PublicCatalogMode;
}

export interface RuntimeConfiguration extends BootstrapSettings {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  kyselyDatabaseUrl: string;
  sessionSecret: string;
  cookieSecure: boolean;
  mediaDriver: 'local' | 's3';
  mediaLocalPath: string | undefined;
  mediaMaxUploadBytes: number;
  mediaMaxPixels: number;
  mediaChildRssMb: number;
  mediaChildTimeoutMs: number;
  jobRunnerMode: JobRunnerMode;
  prismaPoolMax: number;
  kyselyPoolMax: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  trustProxy: boolean | string | string[];
  appVersion: string;
  buildRevision: string;
  s3:
    | {
        endpoint: string;
        bucket: string;
        region: string;
        accessKeyIdFile: string;
        secretAccessKeyFile: string;
      }
    | undefined;
}

export class ConfigurationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

function value(environment: Environment, name: string): string {
  const result = environment[name]?.trim();
  if (!result) throw new ConfigurationError('CONFIG_REQUIRED', `${name} is required.`);
  return result;
}

function oneOf<const T extends readonly string[]>(
  environment: Environment,
  name: string,
  allowed: T,
  fallback?: T[number],
): T[number] {
  const result = environment[name]?.trim() || fallback;
  if (!result || !allowed.includes(result)) {
    throw new ConfigurationError(
      'CONFIG_INVALID_ENUM',
      `${name} must be one of: ${allowed.join(', ')}.`,
    );
  }
  return result as T[number];
}

function positiveInteger(environment: Environment, name: string): number {
  const result = Number(value(environment, name));
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new ConfigurationError('CONFIG_INVALID_INTEGER', `${name} must be a positive integer.`);
  }
  return result;
}

function booleanValue(environment: Environment, name: string): boolean {
  const raw = value(environment, name).toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new ConfigurationError('CONFIG_INVALID_BOOLEAN', `${name} must be true or false.`);
}

function urlValue(environment: Environment, name: string, protocols: readonly string[]): string {
  const raw = value(environment, name);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigurationError('CONFIG_INVALID_URL', `${name} must be an absolute URL.`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new ConfigurationError(
      'CONFIG_INVALID_URL',
      `${name} must use ${protocols.join(' or ')}.`,
    );
  }
  if (name === 'APP_BASE_URL' && (parsed.pathname !== '/' || parsed.search || parsed.hash)) {
    throw new ConfigurationError(
      'CONFIG_INVALID_BASE_URL',
      'APP_BASE_URL must not contain a path, query, or fragment.',
    );
  }
  return parsed.toString().replace(/\/$/, '');
}

function trustProxyValue(environment: Environment): boolean | string | string[] {
  const raw = value(environment, 'TRUST_PROXY').toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.includes(',')) return raw.split(',').map((item) => item.trim());
  return raw;
}

export function parseEnvironment(environment: Environment): RuntimeConfiguration {
  const nodeEnv = oneOf(environment, 'NODE_ENV', ['development', 'test', 'production'] as const);
  const appBaseUrl = urlValue(environment, 'APP_BASE_URL', ['http:', 'https:']);
  const databaseUrl = urlValue(environment, 'DATABASE_URL', ['postgres:', 'postgresql:']);
  const kyselyDatabaseUrl = urlValue(environment, 'KYSELY_DATABASE_URL', [
    'postgres:',
    'postgresql:',
  ]);
  const sessionSecret = value(environment, 'SESSION_SECRET');
  const cookieSecure = booleanValue(environment, 'COOKIE_SECURE');
  const mediaDriver = oneOf(environment, 'MEDIA_DRIVER', ['local', 's3'] as const);
  const prismaPoolMax = positiveInteger(environment, 'PRISMA_POOL_MAX');
  const kyselyPoolMax = positiveInteger(environment, 'KYSELY_POOL_MAX');

  if (prismaPoolMax + kyselyPoolMax > 12) {
    throw new ConfigurationError(
      'CONFIG_CONNECTION_BUDGET',
      'PRISMA_POOL_MAX and KYSELY_POOL_MAX may total at most 12 per process.',
    );
  }
  if (
    nodeEnv === 'production' &&
    (sessionSecret.length < 32 || sessionSecret.toLowerCase().includes('replace'))
  ) {
    throw new ConfigurationError(
      'CONFIG_UNSAFE_SESSION_SECRET',
      'SESSION_SECRET must contain at least 32 characters in production.',
    );
  }
  if (
    nodeEnv === 'production' &&
    [databaseUrl, kyselyDatabaseUrl].some((url) => new URL(url).password.includes('replace'))
  ) {
    throw new ConfigurationError(
      'CONFIG_UNSAFE_DATABASE_PASSWORD',
      'Database connection URLs still contain an example password.',
    );
  }
  if (
    nodeEnv === 'production' &&
    !cookieSecure &&
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(appBaseUrl).hostname)
  ) {
    throw new ConfigurationError(
      'CONFIG_INSECURE_COOKIE',
      'COOKIE_SECURE must be true for a non-loopback production base URL.',
    );
  }

  const mediaLocalPath =
    mediaDriver === 'local' ? value(environment, 'MEDIA_LOCAL_PATH') : undefined;
  if (mediaLocalPath && !mediaLocalPath.startsWith('/')) {
    throw new ConfigurationError(
      'CONFIG_INVALID_MEDIA_PATH',
      'MEDIA_LOCAL_PATH must be an absolute container path.',
    );
  }
  const s3 =
    mediaDriver === 's3'
      ? {
          endpoint: urlValue(environment, 'S3_ENDPOINT', ['http:', 'https:']),
          bucket: value(environment, 'S3_BUCKET'),
          region: value(environment, 'S3_REGION'),
          accessKeyIdFile: value(environment, 'S3_ACCESS_KEY_ID_FILE'),
          secretAccessKeyFile: value(environment, 'S3_SECRET_ACCESS_KEY_FILE'),
        }
      : undefined;
  if (s3 && (!s3.accessKeyIdFile.startsWith('/') || !s3.secretAccessKeyFile.startsWith('/'))) {
    throw new ConfigurationError(
      'CONFIG_INVALID_SECRET_PATH',
      'S3 credential file references must be absolute container paths.',
    );
  }

  return {
    nodeEnv,
    appBaseUrl,
    databaseUrl,
    kyselyDatabaseUrl,
    sessionSecret,
    cookieSecure,
    defaultLocale: oneOf(environment, 'DEFAULT_LOCALE', supportedLocales, defaultLocale),
    publicCatalogMode: oneOf(
      environment,
      'PUBLIC_CATALOG_MODE',
      ['public', 'authenticated'] as const,
      'authenticated',
    ),
    mediaDriver,
    mediaLocalPath,
    mediaMaxUploadBytes: positiveInteger(environment, 'MEDIA_MAX_UPLOAD_BYTES'),
    mediaMaxPixels: positiveInteger(environment, 'MEDIA_MAX_PIXELS'),
    mediaChildRssMb: positiveInteger(environment, 'MEDIA_CHILD_RSS_MB'),
    mediaChildTimeoutMs: positiveInteger(environment, 'MEDIA_CHILD_TIMEOUT_MS'),
    jobRunnerMode: oneOf(environment, 'JOB_RUNNER_MODE', [
      'compact',
      'worker',
      'disabled',
    ] as const),
    prismaPoolMax,
    kyselyPoolMax,
    logLevel: oneOf(environment, 'LOG_LEVEL', ['debug', 'info', 'warn', 'error'] as const, 'info'),
    trustProxy: trustProxyValue(environment),
    appVersion: environment.APP_VERSION?.trim() || '0.1.0-dev.1',
    buildRevision: environment.VCS_REF?.trim() || 'unknown',
    s3,
  };
}

export function resolveBootstrapSettings(
  environment: RuntimeConfiguration,
  database: BootstrapSettings,
  warn: (message: string) => void,
): BootstrapSettings {
  if (environment.nodeEnv === 'production' && environment.appBaseUrl !== database.appBaseUrl) {
    throw new ConfigurationError(
      'CONFIG_APP_BASE_URL_CONFLICT',
      'APP_BASE_URL conflicts with the database-authoritative canonical URL.',
    );
  }
  if (
    environment.nodeEnv === 'production' &&
    environment.publicCatalogMode !== database.publicCatalogMode
  ) {
    throw new ConfigurationError(
      'CONFIG_PUBLIC_CATALOG_MODE_CONFLICT',
      'PUBLIC_CATALOG_MODE conflicts with the database-authoritative access policy.',
    );
  }
  if (environment.defaultLocale !== database.defaultLocale) {
    warn(`DEFAULT_LOCALE differs from the database setting; using ${database.defaultLocale}.`);
  }
  if (environment.nodeEnv !== 'production' && environment.appBaseUrl !== database.appBaseUrl) {
    warn('APP_BASE_URL differs from the database setting; the database value wins.');
  }
  if (
    environment.nodeEnv !== 'production' &&
    environment.publicCatalogMode !== database.publicCatalogMode
  ) {
    warn('PUBLIC_CATALOG_MODE differs from the database setting; the database value wins.');
  }
  return database;
}
