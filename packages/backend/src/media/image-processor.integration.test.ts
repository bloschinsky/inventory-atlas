import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mediaCapabilityFixtures } from './capability-fixtures.js';
import {
  ChildImageProcessor,
  classifyChildFailure,
  resourceLimitedCommand,
  spawnLimitedChild,
  uprightDimensions,
  type CapabilityFixture,
} from './image-processor.js';
import { isForbiddenMetadataField, variantPlan } from './image-variants.js';

// The decoder is a real process, so these run with the rest of the integration suite inside the
// container that actually ships libvips.
const suite = process.env.INTEGRATION_DATABASE_URL ? describe : describe.skip;

const limits = {
  maxInputBytes: 26_214_400,
  maxPixels: 40_000_000,
  childRssMb: 512,
  childTimeoutMs: 30_000,
  concurrency: 1,
};

let workspace: string;
let fixtures: CapabilityFixture[];
let processor: ChildImageProcessor;

/** Runs one capped child directly, to assert the wrapper itself rather than a decode result. */
function runCapped(
  binary: string,
  args: readonly string[],
  options: { rssMb: number; timeoutMs: number },
) {
  const wrapped = resourceLimitedCommand(binary, args, options);
  return spawnLimitedChild(wrapped.command, wrapped.args, {
    timeoutMs: options.timeoutMs,
    rssMb: options.rssMb,
    concurrency: 1,
  });
}

suite('MED-02 image processing capabilities', () => {
  beforeAll(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'atlas-capability-'));
    fixtures = await mediaCapabilityFixtures();
    processor = new ChildImageProcessor(limits);
  });

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it('decodes the committed JPEG, PNG, WebP and HEIC fixtures', async () => {
    const report = await processor.checkCapabilities(fixtures);
    expect(report.results.map((result) => result.format).sort()).toEqual([
      'heic',
      'jpeg',
      'png',
      'webp',
    ]);
    for (const result of report.results)
      expect({ format: result.format, decoded: result.decoded, error: result.errorCode }).toEqual({
        format: result.format,
        decoded: true,
        error: null,
      });
    // HEIC is the format ADR-011 singles out: it must decode through libheif, not a fallback.
    expect(report.results.find((result) => result.format === 'heic')!.loader).toContain('heif');
    expect(report.available).toBe(true);
  });

  it('reports an unavailable decoder instead of throwing at startup', async () => {
    const missing = new ChildImageProcessor(limits, { header: 'vips-absent', thumbnail: 'vips' });
    const report = await missing.checkCapabilities(fixtures);
    expect(report.available).toBe(false);
    expect(report.results.every((result) => result.errorCode !== null)).toBe(true);
  });

  it('produces a WebP thumbnail that carries no metadata', async () => {
    const jpeg = fixtures.find((fixture) => fixture.format === 'jpeg')!;
    const target = path.join(workspace, 'thumb.webp');
    const rendered = await processor.render({
      sourcePath: jpeg.path,
      targetPath: target,
      variant: variantPlan[0]!,
    });
    expect(rendered).toMatchObject({ name: 'thumb', width: 16, height: 16 });
    const header = await runCapped('vipsheader', ['-a', target], {
      rssMb: limits.childRssMb,
      timeoutMs: limits.childTimeoutMs,
    });
    expect(header.code).toBe(0);
    expect(header.stdout).toContain('webpload');
    const fields = header.stdout
      .split('\n')
      .map((line) => line.split(':')[0]!.trim())
      .filter(Boolean);
    expect(fields.filter((field) => isForbiddenMetadataField(field))).toEqual([]);
  });

  it('applies EXIF orientation to the pixels and drops the GPS tag with it', async () => {
    const jpeg = fixtures.find((fixture) => fixture.format === 'jpeg')!;
    const rotated = path.join(workspace, 'rotated.jpg');
    await writeFile(rotated, withExifOrientationAndGps(await readFile(jpeg.path)));

    const probe = await processor.probe(rotated);
    expect(probe.orientation).toBe(6);
    // A quarter turn swaps what a viewer sees, which is what gets recorded on the asset.
    expect(uprightDimensions({ ...probe, width: 40, height: 30 })).toEqual({
      width: 30,
      height: 40,
    });

    const target = path.join(workspace, 'rotated-thumb.webp');
    await processor.render({
      sourcePath: rotated,
      targetPath: target,
      variant: variantPlan[0]!,
    });
    const header = await runCapped('vipsheader', ['-a', target], {
      rssMb: limits.childRssMb,
      timeoutMs: limits.childTimeoutMs,
    });
    expect(header.stdout.toLowerCase()).not.toContain('gps');
    expect(header.stdout.toLowerCase()).not.toContain('exif');
  });

  it('refuses bytes that are not a decodable image, permanently', async () => {
    const garbage = path.join(workspace, 'not-an-image.jpg');
    await writeFile(garbage, Buffer.from('this is plain text, not a JPEG at all'));
    await expect(processor.probe(garbage)).rejects.toMatchObject({
      code: 'MEDIA_DECODE_UNSUPPORTED',
      permanent: true,
    });
  });

  it('refuses an input above the byte limit before launching a decoder', async () => {
    const tight = new ChildImageProcessor({ ...limits, maxInputBytes: 32 });
    const jpeg = fixtures.find((fixture) => fixture.format === 'jpeg')!;
    await expect(tight.probe(jpeg.path)).rejects.toMatchObject({
      code: 'MEDIA_INPUT_BYTES_EXCEEDED',
      permanent: true,
    });
  });

  it('refuses an image above the decoded pixel limit', async () => {
    const tight = new ChildImageProcessor({ ...limits, maxPixels: 100 });
    for (const fixture of fixtures)
      await expect(tight.probe(fixture.path)).rejects.toMatchObject({
        code: 'MEDIA_PIXEL_LIMIT_EXCEEDED',
        permanent: true,
      });
  });

  it('hands the child a real address-space cap', async () => {
    const outcome = await runCapped('/bin/sh', ['-c', 'ulimit -v'], {
      rssMb: 64,
      timeoutMs: 5_000,
    });
    expect(outcome.code).toBe(0);
    expect(outcome.stdout.trim()).toBe('65536');
  });

  it('kills a child that outlives its timeout and reports it as retryable', async () => {
    const outcome = await runCapped('/bin/sleep', ['30'], { rssMb: 64, timeoutMs: 500 });
    expect(outcome.timedOut).toBe(true);
    expect(outcome.signal).toBe('SIGKILL');
    expect(classifyChildFailure(outcome)).toMatchObject({
      code: 'MEDIA_PROCESSING_TIMEOUT',
      permanent: false,
    });
  });

  it('survives a child that crashes and reports it as retryable', async () => {
    const outcome = await runCapped('/bin/sh', ['-c', 'kill -SEGV $$'], {
      rssMb: 64,
      timeoutMs: 5_000,
    });
    expect(outcome.signal).toBe('SIGSEGV');
    expect(classifyChildFailure(outcome)).toMatchObject({
      code: 'MEDIA_PROCESSING_CHILD_CRASHED',
      permanent: false,
    });
    // The calling process is untouched: it observed the failure as a value, not an exception.
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('fails a decode that cannot fit inside the memory cap without escaping the child', async () => {
    const starved = new ChildImageProcessor({ ...limits, childRssMb: 8 });
    const jpeg = fixtures.find((fixture) => fixture.format === 'jpeg')!;
    await expect(starved.probe(jpeg.path)).rejects.toMatchObject({ name: 'ImageProcessingError' });
  });
});

/**
 * Splices a minimal EXIF APP1 segment carrying Orientation = 6 and a GPS IFD into a JPEG. It is
 * built here rather than committed as a fixture so the bytes under test are visible next to the
 * expectation they support.
 */
function withExifOrientationAndGps(jpeg: Buffer): Buffer {
  const tiff = Buffer.alloc(56);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(0x002a, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8); // IFD0 entry count
  // Orientation (0x0112), SHORT, 1, value 6.
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(6, 18);
  // GPSInfoIFDPointer (0x8825), LONG, 1, offset 38.
  tiff.writeUInt16LE(0x8825, 22);
  tiff.writeUInt16LE(4, 24);
  tiff.writeUInt32LE(1, 26);
  tiff.writeUInt32LE(38, 30);
  tiff.writeUInt32LE(0, 34); // no IFD1
  tiff.writeUInt16LE(1, 38); // GPS IFD entry count
  // GPSLatitudeRef (0x0001), ASCII, 2, "N".
  tiff.writeUInt16LE(0x0001, 40);
  tiff.writeUInt16LE(2, 42);
  tiff.writeUInt32LE(2, 44);
  tiff.write('N\0', 48, 'ascii');
  tiff.writeUInt32LE(0, 52);

  const identifier = Buffer.from('Exif\0\0', 'ascii');
  const marker = Buffer.alloc(4);
  marker.writeUInt16BE(0xffe1, 0);
  marker.writeUInt16BE(identifier.length + tiff.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), marker, identifier, tiff, jpeg.subarray(2)]);
}
