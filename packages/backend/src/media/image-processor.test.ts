import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ChildImageProcessor,
  classifyChildFailure,
  ImageProcessingError,
  parseHeaderFields,
  resourceLimitedCommand,
  uprightDimensions,
  type ChildLauncher,
  type ChildOutcome,
} from './image-processor.js';
import { variantPlan } from './image-variants.js';

const limits = {
  maxInputBytes: 1_024,
  maxPixels: 1_000,
  childRssMb: 64,
  childTimeoutMs: 5_000,
  concurrency: 1,
};

const success = (stdout: string): ChildOutcome => ({
  code: 0,
  signal: null,
  stdout,
  stderr: '',
  timedOut: false,
  spawnErrorCode: null,
});

const header = 'width: 10\nheight: 20\nbands: 3\nvips-loader: jpegload\n';

let workspace: string;
let source: string;
let calls: { command: string; args: readonly string[] }[];

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), 'atlas-processor-'));
  source = path.join(workspace, 'source.jpg');
  await writeFile(source, Buffer.alloc(64, 1));
  calls = [];
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function processorWith(outcome: (args: readonly string[]) => ChildOutcome): ChildImageProcessor {
  const launcher: ChildLauncher = async (command, args) => {
    calls.push({ command, args });
    return outcome(args);
  };
  return new ChildImageProcessor(limits, { header: 'vipsheader', thumbnail: 'vips' }, launcher);
}

describe('resource-limited wrapper', () => {
  it('applies the address-space, CPU and core limits before exec', () => {
    const { command, args } = resourceLimitedCommand('vips', ['thumbnail'], {
      rssMb: 256,
      timeoutMs: 30_000,
    });
    expect(command).toBe('/bin/sh');
    expect(args[0]).toBe('-c');
    expect(args[1]).toContain('ulimit -v 262144');
    expect(args[1]).toContain('ulimit -t 30');
    expect(args[1]).toContain('ulimit -c 0');
  });

  it('passes the real command as arguments so a filename can never be shell syntax', () => {
    const hostile = '/media/assets/x; rm -rf /.jpg';
    const { args } = resourceLimitedCommand('vipsheader', ['-a', hostile], {
      rssMb: 64,
      timeoutMs: 1_000,
    });
    expect(args[1]).not.toContain(hostile);
    expect(args.slice(2)).toEqual(['vipsheader', '-a', hostile]);
  });
});

describe('probe', () => {
  it('reads the header through one capped child and reports the loader', async () => {
    const probe = await processorWith(() => success(header)).probe(source);
    expect(probe).toMatchObject({ width: 10, height: 20, bands: 3, loader: 'jpegload' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe('/bin/sh');
    expect(calls[0]!.args.slice(2)).toEqual(['vipsheader', '-a', source]);
  });

  it('refuses an input larger than the configured byte limit before launching a decoder', async () => {
    const large = path.join(workspace, 'large.jpg');
    await writeFile(large, Buffer.alloc(limits.maxInputBytes + 1, 1));
    await expect(processorWith(() => success(header)).probe(large)).rejects.toMatchObject({
      code: 'MEDIA_INPUT_BYTES_EXCEEDED',
      permanent: true,
    });
    expect(calls).toHaveLength(0);
  });

  it('refuses a decode bomb from the header, before a pixel is produced', async () => {
    const bomb = 'width: 40000\nheight: 40000\nbands: 3\nvips-loader: pngload\n';
    await expect(processorWith(() => success(bomb)).probe(source)).rejects.toMatchObject({
      code: 'MEDIA_PIXEL_LIMIT_EXCEEDED',
      permanent: true,
    });
  });

  it('rejects a header without usable dimensions', async () => {
    await expect(processorWith(() => success('bands: 3\n')).probe(source)).rejects.toMatchObject({
      code: 'MEDIA_DECODE_FAILED',
    });
  });

  it('reports a missing object as retryable rather than dead', async () => {
    await expect(
      processorWith(() => success(header)).probe(path.join(workspace, 'absent.jpg')),
    ).rejects.toMatchObject({ code: 'MEDIA_SOURCE_UNREADABLE', permanent: false });
  });
});

describe('render', () => {
  it('asks libvips for a downscaled, quality-bounded, metadata-stripped variant', async () => {
    const thumb = variantPlan[0]!;
    const target = path.join(workspace, 'thumb.webp');
    // The stub stands in for the child: it produces the file the follow-up probe then reads.
    const processor = processorWith((args) => {
      if (args.includes('thumbnail')) void writeFile(target, minimalWebp());
      return success(header);
    });
    await writeFile(target, minimalWebp());
    const rendered = await processor.render({
      sourcePath: source,
      targetPath: target,
      variant: thumb,
    });
    expect(rendered).toMatchObject({ name: 'thumb', width: 10, height: 20, path: target });
    const render = calls[0]!.args.slice(2);
    expect(render[0]).toBe('vips');
    expect(render[1]).toBe('thumbnail');
    expect(render[3]).toBe(`${target}[Q=${thumb.quality},strip]`);
    expect(render.slice(4)).toEqual([
      String(thumb.maxEdge),
      '--height',
      String(thumb.maxEdge),
      '--size',
      'down',
    ]);
  });
});

describe('failure classification', () => {
  it('treats a crash, an OOM kill and a timeout as retryable', () => {
    expect(
      classifyChildFailure({
        code: null,
        signal: 'SIGKILL',
        stdout: '',
        stderr: '',
        timedOut: false,
        spawnErrorCode: null,
      }),
    ).toMatchObject({ code: 'MEDIA_PROCESSING_CHILD_CRASHED', permanent: false });
    expect(
      classifyChildFailure({
        code: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: true,
        spawnErrorCode: null,
      }),
    ).toMatchObject({ code: 'MEDIA_PROCESSING_TIMEOUT', permanent: false });
    expect(
      classifyChildFailure({
        code: 1,
        signal: null,
        stdout: '',
        stderr: 'vips: cannot allocate memory',
        timedOut: false,
        spawnErrorCode: null,
      }),
    ).toMatchObject({ code: 'MEDIA_PROCESSING_CHILD_CRASHED', permanent: false });
  });

  it('treats a missing decoder as retryable and unreadable bytes as permanent', () => {
    expect(
      classifyChildFailure({
        code: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        spawnErrorCode: 'ENOENT',
      }),
    ).toMatchObject({ code: 'MEDIA_PROCESSOR_UNAVAILABLE', permanent: false });
    expect(
      classifyChildFailure({
        code: 1,
        signal: null,
        stdout: '',
        stderr: 'vips: "x.jpg" is not a known file format',
        timedOut: false,
        spawnErrorCode: null,
      }),
    ).toMatchObject({ code: 'MEDIA_DECODE_UNSUPPORTED', permanent: true });
  });

  it('never returns anything but a classified processing error', () => {
    const failure = classifyChildFailure({
      code: 9,
      signal: null,
      stdout: '',
      stderr: 'something unexpected',
      timedOut: false,
      spawnErrorCode: null,
    });
    expect(failure).toBeInstanceOf(ImageProcessingError);
    expect(failure.code).toBe('MEDIA_DECODE_FAILED');
  });
});

describe('produced container', () => {
  it('refuses a produced variant whose metadata cannot be guaranteed removed', async () => {
    const target = path.join(workspace, 'not-webp.webp');
    const processor = processorWith(() => success(header));
    await writeFile(target, Buffer.from('this is not a RIFF container'));
    await expect(
      processor.render({ sourcePath: source, targetPath: target, variant: variantPlan[0]! }),
    ).rejects.toMatchObject({ code: 'MEDIA_DECODE_FAILED', permanent: true });
  });
});

describe('header parsing and orientation', () => {
  it('reads the key/value lines and ignores the summary line', () => {
    const fields = parseHeaderFields('/tmp/a.jpg: 16x16 uchar, 3 bands\nwidth: 16\nheight: 9\n');
    expect(fields.get('width')).toBe('16');
    expect(fields.get('height')).toBe('9');
  });

  it('swaps the stored dimensions for a quarter-turn orientation', () => {
    expect(
      uprightDimensions({
        width: 400,
        height: 300,
        bands: 3,
        loader: 'jpegload',
        orientation: 6,
        byteSize: 1,
      }),
    ).toEqual({ width: 300, height: 400 });
    expect(
      uprightDimensions({
        width: 400,
        height: 300,
        bands: 3,
        loader: 'jpegload',
        orientation: 1,
        byteSize: 1,
      }),
    ).toEqual({ width: 400, height: 300 });
  });
});

/** The smallest byte sequence the metadata strip accepts as a container. */
function minimalWebp(): Buffer {
  const pixels = Buffer.alloc(28);
  pixels.write('VP8 ', 0, 'ascii');
  pixels.writeUInt32LE(20, 4);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(pixels.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, pixels]);
}
