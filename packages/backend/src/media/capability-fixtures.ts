import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { approvedImageMimeTypes } from './media-policy.js';
import type { CapabilityFixture } from './image-processor.js';

/** `db/fixtures/media`, both from `src` in development and from `dist` in the runtime image. */
export const defaultCapabilityFixtureRoot = fileURLToPath(
  new URL('../../../../db/fixtures/media/', import.meta.url),
);

interface FixtureManifest {
  fixtures?: { format?: unknown; file?: unknown; mime?: unknown; committed?: unknown }[];
}

/**
 * The committed capability fixtures (blueprint section 12.2). The manifest is the single list;
 * reading it here keeps the startup check and the fixture inventory from drifting apart, and the
 * result is filtered to the approved upload types so an extra fixture cannot widen the surface.
 */
export async function mediaCapabilityFixtures(
  root: string = defaultCapabilityFixtureRoot,
): Promise<CapabilityFixture[]> {
  const manifest = JSON.parse(
    await readFile(path.join(root, 'manifest.json'), 'utf8'),
  ) as FixtureManifest;
  const fixtures = (manifest.fixtures ?? [])
    .filter(
      (entry) =>
        entry.committed === true &&
        typeof entry.file === 'string' &&
        typeof entry.format === 'string' &&
        approvedImageMimeTypes.includes(entry.mime as never),
    )
    .map((entry) => ({
      format: String(entry.format),
      mimeType: String(entry.mime),
      path: path.join(root, String(entry.file)),
    }));
  if (fixtures.length !== approvedImageMimeTypes.length)
    throw new Error(
      `The media fixture manifest must cover all ${approvedImageMimeTypes.length} approved image types.`,
    );
  return fixtures;
}
