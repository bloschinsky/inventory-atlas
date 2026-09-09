import { pathToFileURL } from 'node:url';
import type { PrismaClient } from './generated/prisma/client.js';
import { createSettingsClient } from './settings.repository.js';

export const lifecycleStatusSeeds = [
  {
    id: '01000000-0000-4000-8000-000000000001',
    key: 'stored',
    labelI18n: { en: 'Stored', uk: 'На зберіганні' },
    colorToken: 'status.neutral',
    displayOrder: 10,
  },
  {
    id: '01000000-0000-4000-8000-000000000002',
    key: 'reserved',
    labelI18n: { en: 'Reserved', uk: 'Зарезервовано' },
    colorToken: 'status.info',
    displayOrder: 20,
  },
  {
    id: '01000000-0000-4000-8000-000000000003',
    key: 'lent',
    labelI18n: { en: 'Lent', uk: 'Позичено' },
    colorToken: 'status.warning',
    displayOrder: 30,
  },
  {
    id: '01000000-0000-4000-8000-000000000004',
    key: 'for_sale',
    labelI18n: { en: 'For sale', uk: 'На продаж' },
    colorToken: 'status.info',
    displayOrder: 40,
  },
  {
    id: '01000000-0000-4000-8000-000000000005',
    key: 'sold',
    labelI18n: { en: 'Sold', uk: 'Продано' },
    colorToken: 'status.success',
    displayOrder: 50,
  },
  {
    id: '01000000-0000-4000-8000-000000000006',
    key: 'lost',
    labelI18n: { en: 'Lost', uk: 'Втрачено' },
    colorToken: 'status.danger',
    displayOrder: 60,
  },
  {
    id: '01000000-0000-4000-8000-000000000007',
    key: 'archived',
    labelI18n: { en: 'Archived', uk: 'Архівовано' },
    colorToken: 'status.muted',
    displayOrder: 70,
  },
] as const;

export async function seedLifecycleStatuses(
  prisma: Pick<PrismaClient, 'lifecycleStatus'>,
): Promise<number> {
  const result = await prisma.lifecycleStatus.createMany({
    data: lifecycleStatusSeeds.map((seed) => ({ ...seed, labelI18n: { ...seed.labelI18n } })),
    skipDuplicates: true,
  });
  return result.count;
}

export async function runSeeds(connectionString = process.env.DATABASE_URL): Promise<void> {
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const prisma = createSettingsClient(connectionString, 1);
  try {
    const inserted = await seedLifecycleStatuses(prisma);
    process.stdout.write(`db:seed: inserted ${inserted} missing lifecycle statuses.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSeeds();
}
