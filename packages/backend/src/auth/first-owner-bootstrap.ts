import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PasswordHasher } from './password-hasher.js';

export interface FirstOwnerBootstrapInput {
  email: string;
  displayName: string;
  password: string;
  locale?: 'en' | 'uk';
}

export interface BootstrappedOwner {
  id: string;
  email: string;
  displayName: string;
  locale: 'en' | 'uk';
  createdAt: Date;
}

export class FirstOwnerBootstrapError extends Error {
  constructor(
    readonly code: 'AUTH_BOOTSTRAP_INVALID' | 'AUTH_BOOTSTRAP_UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'FirstOwnerBootstrapError';
  }
}

/** Creates the installation's first account. Callers must not log the input. */
export async function bootstrapFirstOwner(
  prisma: PrismaClient,
  input: FirstOwnerBootstrapInput,
  passwordHasher = new PasswordHasher(),
): Promise<BootstrappedOwner> {
  const emailNormalized = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const locale = input.locale ?? 'en';
  if (!emailNormalized || !displayName || !input.password || !['en', 'uk'].includes(locale)) {
    throw new FirstOwnerBootstrapError(
      'AUTH_BOOTSTRAP_INVALID',
      'First Owner details are invalid.',
    );
  }

  const passwordHash = await passwordHasher.hash(input.password);
  return prisma.$transaction(async (transaction) => {
    // This one-time path is allowed to serialize all user inserts so even a
    // concurrent writer that does not use the advisory lock cannot create a
    // non-Owner account between the emptiness check and the insert.
    await transaction.$executeRaw`lock table users in share row exclusive mode`;
    const existing = await transaction.user.findFirst({ select: { id: true } });
    if (existing) {
      throw new FirstOwnerBootstrapError(
        'AUTH_BOOTSTRAP_UNAVAILABLE',
        'First Owner bootstrap is no longer available.',
      );
    }

    const owner = await transaction.user.create({
      data: {
        id: randomUUID(),
        emailNormalized,
        displayName,
        passwordHash,
        role: 'owner',
        locale,
      },
      select: {
        id: true,
        emailNormalized: true,
        displayName: true,
        locale: true,
        createdAt: true,
      },
    });
    return {
      id: owner.id,
      email: owner.emailNormalized,
      displayName: owner.displayName,
      locale: owner.locale as 'en' | 'uk',
      createdAt: owner.createdAt,
    };
  });
}
