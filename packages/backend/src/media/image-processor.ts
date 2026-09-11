import { spawn } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { orientedDimensions, type VariantDefinition, type VariantName } from './image-variants.js';
import { stripWebpMetadata, WebpContainerError } from './webp-metadata.js';

/**
 * Image decoding contract (blueprint section 12.2). No implementation of this port may decode an
 * image inside the calling process: decoding happens in a one-shot child launched through a
 * resource-limit wrapper, so a malformed or hostile image can cost at most that child.
 */
export interface ImageProcessorPort {
  /** Reads the header only. The result is what the pixel limit is enforced against. */
  probe(sourcePath: string): Promise<ImageProbe>;
  /** Produces one variant file. The child applies orientation and strips all metadata. */
  render(input: RenderRequest): Promise<RenderedVariant>;
  /** Decodes the known fixtures and reports what this deployment can actually read. */
  checkCapabilities(fixtures: readonly CapabilityFixture[]): Promise<CapabilityReport>;
}

export interface ImageProbe {
  width: number;
  height: number;
  bands: number;
  loader: string;
  /** EXIF orientation as stored; the pixels are rotated and the tag is dropped on render. */
  orientation: number | null;
  byteSize: number;
}

export interface RenderRequest {
  sourcePath: string;
  targetPath: string;
  variant: VariantDefinition;
}

export interface RenderedVariant {
  name: VariantName;
  path: string;
  width: number;
  height: number;
  mimeType: string;
}

export interface CapabilityFixture {
  format: string;
  mimeType: string;
  path: string;
}

export interface CapabilityResult {
  format: string;
  mimeType: string;
  decoded: boolean;
  loader: string | null;
  errorCode: string | null;
}

export interface CapabilityReport {
  available: boolean;
  results: readonly CapabilityResult[];
  checkedAt: Date;
}

export type ImageProcessingCode =
  | 'MEDIA_PROCESSOR_UNAVAILABLE'
  | 'MEDIA_SOURCE_UNREADABLE'
  | 'MEDIA_INPUT_BYTES_EXCEEDED'
  | 'MEDIA_PIXEL_LIMIT_EXCEEDED'
  | 'MEDIA_DECODE_UNSUPPORTED'
  | 'MEDIA_DECODE_FAILED'
  | 'MEDIA_PROCESSING_TIMEOUT'
  | 'MEDIA_PROCESSING_CHILD_CRASHED';

/**
 * A decoding failure. `permanent` decides the job outcome: a malformed image or an oversized
 * pixel count will never succeed and goes straight to dead state, while a crash, an OOM kill, a
 * timeout or a missing decoder is retried under the normal backoff.
 */
export class ImageProcessingError extends Error {
  constructor(
    readonly code: ImageProcessingCode,
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = 'ImageProcessingError';
  }
}

export interface ImageProcessingLimits {
  /** Refuses the object before a decoder is even launched. */
  maxInputBytes: number;
  /** Decode-bomb ceiling checked against the header, before any pixel is produced. */
  maxPixels: number;
  /** Address-space and resident-size cap handed to the child. */
  childRssMb: number;
  childTimeoutMs: number;
  /** libvips worker threads inside the child; the blueprint fixes this at one. */
  concurrency: number;
}

export interface ChildOutcome {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnErrorCode: string | null;
}

export interface ChildLauncher {
  (
    command: string,
    args: readonly string[],
    options: { timeoutMs: number; rssMb: number; concurrency: number },
  ): Promise<ChildOutcome>;
}

/** Never keep more than this much child output; a chatty decoder must not grow the heap. */
const maxCapturedOutputBytes = 64 * 1_024;

/**
 * Builds the resource-limit wrapper. The limits are applied by the shell before `exec`, and the
 * real command is passed as positional arguments rather than interpolated into the script, so
 * nothing in a filename can ever be read as shell syntax.
 */
export function resourceLimitedCommand(
  binary: string,
  args: readonly string[],
  limits: { rssMb: number; timeoutMs: number },
): { command: string; args: string[] } {
  const addressSpaceKb = Math.max(1, Math.round(limits.rssMb * 1_024));
  const cpuSeconds = Math.max(1, Math.ceil(limits.timeoutMs / 1_000));
  const script = [
    `ulimit -v ${addressSpaceKb} 2>/dev/null || true`,
    `ulimit -t ${cpuSeconds} 2>/dev/null || true`,
    // No core dump survives a crash: it would contain decoded private image data.
    'ulimit -c 0 2>/dev/null || true',
    'exec "$0" "$@"',
  ].join('; ');
  return { command: '/bin/sh', args: ['-c', script, binary, ...args] };
}

/**
 * Runs one capped child to completion. The wall-clock timeout is enforced here in addition to
 * the CPU limit inside the wrapper, because a child blocked on I/O burns no CPU time at all.
 */
export const spawnLimitedChild: ChildLauncher = (command, args, options) =>
  new Promise<ChildOutcome>((resolve) => {
    const child = spawn(command, [...args], {
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        // One libvips worker thread, and a small allocator arena count to keep the capped
        // address space usable.
        VIPS_CONCURRENCY: String(options.concurrency),
        VIPS_WARNING: '0',
        MALLOC_ARENA_MAX: '2',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnErrorCode: string | null = null;
    const capture = (target: 'out' | 'err') => (chunk: Buffer | string) => {
      const text = String(chunk);
      if (target === 'out') stdout = (stdout + text).slice(0, maxCapturedOutputBytes);
      else stderr = (stderr + text).slice(0, maxCapturedOutputBytes);
    };
    child.stdout?.on('data', capture('out'));
    child.stderr?.on('data', capture('err'));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);
    timer.unref?.();
    child.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      spawnErrorCode = error.code ?? 'ESPAWN';
      resolve({ code: null, signal: null, stdout, stderr, timedOut, spawnErrorCode });
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut, spawnErrorCode });
    });
  });

/**
 * The libvips implementation. Every decode is a separate short-lived `vipsheader` or `vips
 * thumbnail` process wrapped in `ulimit`, which is what keeps HEIC decoding - the most exposed
 * surface in the pipeline - out of the API process entirely (ADR-011).
 */
export class ChildImageProcessor implements ImageProcessorPort {
  constructor(
    private readonly limits: ImageProcessingLimits,
    private readonly binaries: { header: string; thumbnail: string } = {
      header: 'vipsheader',
      thumbnail: 'vips',
    },
    private readonly launch: ChildLauncher = spawnLimitedChild,
  ) {}

  async probe(sourcePath: string): Promise<ImageProbe> {
    const byteSize = await this.requireReadableSize(sourcePath);
    const outcome = await this.run(this.binaries.header, ['-a', sourcePath]);
    const fields = parseHeaderFields(outcome.stdout);
    const width = Number(fields.get('width'));
    const height = Number(fields.get('height'));
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
      throw new ImageProcessingError(
        'MEDIA_DECODE_FAILED',
        'The decoder reported no usable image dimensions.',
        true,
      );
    if (width * height > this.limits.maxPixels)
      throw new ImageProcessingError(
        'MEDIA_PIXEL_LIMIT_EXCEEDED',
        `A decoded image may contain at most ${this.limits.maxPixels} pixels.`,
        true,
      );
    const orientation = Number(fields.get('orientation'));
    return {
      width,
      height,
      bands: Number(fields.get('bands')) || 0,
      loader: fields.get('vips-loader') ?? 'unknown',
      orientation: Number.isSafeInteger(orientation) && orientation > 0 ? orientation : null,
      byteSize,
    };
  }

  async render(input: RenderRequest): Promise<RenderedVariant> {
    await this.requireReadableSize(input.sourcePath);
    // Options travel inside the target filename; libvips parses them, no shell ever sees them.
    const target = `${input.targetPath}[Q=${input.variant.quality},strip]`;
    await this.run(this.binaries.thumbnail, [
      'thumbnail',
      input.sourcePath,
      target,
      String(input.variant.maxEdge),
      '--height',
      String(input.variant.maxEdge),
      // Never enlarge: an upscaled variant would cost bytes and add no detail.
      '--size',
      'down',
    ]);
    // The pinned libvips ignores `strip` for WebP and writes an EXIF chunk anyway, so the
    // metadata policy is enforced on the container bytes rather than trusted to the flag.
    try {
      await writeFile(input.targetPath, stripWebpMetadata(await readFile(input.targetPath)));
    } catch (error) {
      if (!(error instanceof WebpContainerError)) throw error;
      // The decoder produced something this build cannot guarantee is metadata-free. Refusing is
      // the only safe answer: publishing it could publish a location tag with it.
      throw new ImageProcessingError('MEDIA_DECODE_FAILED', error.message, true);
    }
    const produced = await this.probe(input.targetPath);
    return {
      name: input.variant.name,
      path: input.targetPath,
      width: produced.width,
      height: produced.height,
      mimeType: input.variant.mimeType,
    };
  }

  /**
   * The startup decode check. Every approved format is decoded from its committed fixture, so a
   * deployment whose image lacks a codec says so instead of discovering it on a user upload.
   */
  async checkCapabilities(fixtures: readonly CapabilityFixture[]): Promise<CapabilityReport> {
    const results: CapabilityResult[] = [];
    for (const fixture of fixtures) {
      try {
        const probe = await this.probe(fixture.path);
        results.push({
          format: fixture.format,
          mimeType: fixture.mimeType,
          decoded: true,
          loader: probe.loader,
          errorCode: null,
        });
      } catch (error) {
        results.push({
          format: fixture.format,
          mimeType: fixture.mimeType,
          decoded: false,
          loader: null,
          errorCode:
            error instanceof ImageProcessingError ? error.code : 'MEDIA_PROCESSOR_UNAVAILABLE',
        });
      }
    }
    return {
      available: results.length > 0 && results.every((result) => result.decoded),
      results,
      checkedAt: new Date(),
    };
  }

  private async requireReadableSize(path: string): Promise<number> {
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      throw new ImageProcessingError(
        'MEDIA_SOURCE_UNREADABLE',
        'The stored object is missing or unreadable.',
        false,
      );
    }
    if (size > this.limits.maxInputBytes)
      throw new ImageProcessingError(
        'MEDIA_INPUT_BYTES_EXCEEDED',
        `An image may contain at most ${this.limits.maxInputBytes} bytes.`,
        true,
      );
    return size;
  }

  private async run(binary: string, args: readonly string[]): Promise<ChildOutcome> {
    const { command, args: wrapped } = resourceLimitedCommand(binary, args, {
      rssMb: this.limits.childRssMb,
      timeoutMs: this.limits.childTimeoutMs,
    });
    const outcome = await this.launch(command, wrapped, {
      timeoutMs: this.limits.childTimeoutMs,
      rssMb: this.limits.childRssMb,
      concurrency: this.limits.concurrency,
    });
    if (outcome.code === 0) return outcome;
    throw classifyChildFailure(outcome);
  }
}

/**
 * Maps a child outcome onto the stable error surface. The distinction that matters is whether a
 * retry could ever help: a decoder that is not installed, a killed child and a timeout are all
 * worth retrying, while bytes that are not a decodable image are not.
 */
export function classifyChildFailure(outcome: ChildOutcome): ImageProcessingError {
  if (outcome.spawnErrorCode)
    return new ImageProcessingError(
      'MEDIA_PROCESSOR_UNAVAILABLE',
      'The image processor could not be launched in this deployment.',
      false,
    );
  if (outcome.timedOut)
    return new ImageProcessingError(
      'MEDIA_PROCESSING_TIMEOUT',
      'Image processing exceeded the configured timeout.',
      false,
    );
  if (outcome.signal)
    return new ImageProcessingError(
      'MEDIA_PROCESSING_CHILD_CRASHED',
      `The image processing child was terminated by ${outcome.signal}.`,
      false,
    );
  const stderr = outcome.stderr.toLowerCase();
  // libvips reports both a missing loader and a rejected header through the same exit code.
  if (
    /not a known file format|unable to load|is not in a supported format|no such file or directory/u.test(
      stderr,
    )
  )
    return new ImageProcessingError(
      'MEDIA_DECODE_UNSUPPORTED',
      'The stored bytes are not a decodable image in this deployment.',
      true,
    );
  if (/cannot allocate memory|out of memory|std::bad_alloc/u.test(stderr))
    return new ImageProcessingError(
      'MEDIA_PROCESSING_CHILD_CRASHED',
      'The image processing child exhausted its memory limit.',
      false,
    );
  return new ImageProcessingError('MEDIA_DECODE_FAILED', 'The image could not be processed.', true);
}

/** `vipsheader -a` prints `key: value` lines after a one-line summary. */
export function parseHeaderFields(output: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/u.exec(line.trim());
    if (match) fields.set(match[1]!.toLowerCase(), match[2]!.trim());
  }
  return fields;
}

/** Dimensions as a viewer sees them once the stored orientation has been applied. */
export function uprightDimensions(probe: ImageProbe): { width: number; height: number } {
  return orientedDimensions(probe.width, probe.height, probe.orientation);
}
