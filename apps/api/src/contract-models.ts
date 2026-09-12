import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProblemFieldErrorDto {
  @ApiProperty({ example: 'displayName', type: String })
  declare field: string;

  @ApiProperty({ example: ['must contain at least 1 character'], type: [String] })
  declare messages: string[];
}

export class ProblemDetailsDto {
  @ApiProperty({
    example: 'https://inventory-atlas.local/problems/validation-failed',
    type: String,
  })
  declare type: string;

  @ApiProperty({ example: 'Request validation failed', type: String })
  declare title: string;

  @ApiProperty({ example: 400, maximum: 599, minimum: 400, type: Number })
  declare status: number;

  @ApiProperty({ example: 'One or more fields are invalid.', type: String })
  declare detail: string;

  @ApiProperty({ example: 'VALIDATION_FAILED', type: String })
  declare code: string;

  @ApiProperty({
    example: '0198f40c-92f3-7a12-bc9a-653f97786c2b',
    format: 'uuid',
    type: String,
  })
  declare requestId: string;

  @ApiPropertyOptional({ type: [ProblemFieldErrorDto] })
  declare fieldErrors?: ProblemFieldErrorDto[];
}

export class ItemMutationRequestDto {
  @ApiProperty({ example: 'Cordless drill', maxLength: 200, minLength: 1, type: String })
  declare displayName: string;

  @ApiPropertyOptional({
    example: '01JBM4V6M9Q5Q2HTY0FQVN3M2D',
    pattern: '^[0-9A-HJKMNP-TV-Z]{26}$',
    type: String,
  })
  declare categoryId?: string;

  @ApiProperty({
    description: 'Known aggregate version used for optimistic concurrency.',
    example: 7,
    minimum: 1,
    type: Number,
  })
  declare expectedVersion: number;
}

export class CreateItemRequestDto {
  @ApiProperty({ format: 'uuid', type: String })
  declare categoryId: string;

  @ApiProperty({ format: 'uuid', type: String })
  declare lifecycleStatusId: string;

  @ApiProperty({ example: 'Cordless drill', maxLength: 200, minLength: 1, type: String })
  declare displayName: string;

  @ApiPropertyOptional({ maxLength: 10_000, nullable: true, type: String })
  declare description?: string | null;

  @ApiPropertyOptional({
    enum: ['public', 'authenticated', 'private', 'unlisted'],
    type: String,
  })
  declare visibility?: 'public' | 'authenticated' | 'private' | 'unlisted';

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  declare storageNodeId?: string | null;

  @ApiPropertyOptional({
    items: { maxLength: 100, minLength: 1, type: 'string' },
    maxItems: 50,
    type: 'array',
  })
  declare tags?: string[];

  @ApiPropertyOptional({ additionalProperties: true, type: 'object' })
  declare attributes?: Record<string, unknown>;
}

export class CreatedItemDto {
  @ApiProperty({ format: 'uuid', type: String })
  declare publicId: string;

  @ApiProperty({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', type: String })
  declare slug: string;

  @ApiProperty({ type: String })
  declare displayName: string;

  @ApiProperty({ minimum: 1, type: Number })
  declare version: number;
}

export class UpdateItemRequestDto {
  @ApiProperty({
    description: 'Known aggregate version; must equal the current Item version.',
    example: 3,
    minimum: 1,
    type: Number,
  })
  declare expectedVersion: number;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  declare categoryId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  declare lifecycleStatusId?: string;

  @ApiPropertyOptional({ example: 'Cordless drill', maxLength: 200, minLength: 1, type: String })
  declare displayName?: string;

  @ApiPropertyOptional({ maxLength: 10_000, nullable: true, type: String })
  declare description?: string | null;

  @ApiPropertyOptional({ enum: ['public', 'authenticated', 'private', 'unlisted'], type: String })
  declare visibility?: 'public' | 'authenticated' | 'private' | 'unlisted';

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  declare storageNodeId?: string | null;

  @ApiPropertyOptional({
    items: { maxLength: 100, minLength: 1, type: 'string' },
    maxItems: 50,
    type: 'array',
  })
  declare tags?: string[];

  @ApiPropertyOptional({
    description: 'Submitted attribute values keyed by stable field key. Absent keys are kept.',
    additionalProperties: true,
    type: 'object',
  })
  declare attributes?: Record<string, unknown>;
}

export class UpdatedItemDto extends CreatedItemDto {
  @ApiProperty({
    description: 'Search invalidation registry events this update fired.',
    enum: ['ItemCreated', 'AttributeChanged', 'ItemVisibilityChanged'],
    isArray: true,
    type: String,
  })
  declare invalidators: string[];
}

export class ItemDetailDto {
  @ApiProperty({ format: 'uuid', type: String }) declare publicId: string;

  @ApiProperty({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', type: String }) declare slug: string;

  @ApiProperty({ type: String }) declare displayName: string;

  @ApiPropertyOptional({ nullable: true, type: String }) declare description: string | null;

  @ApiProperty({ format: 'uuid', type: String }) declare categoryId: string;

  @ApiProperty({ format: 'uuid', type: String }) declare lifecycleStatusId: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  declare storageNodeId: string | null;

  @ApiProperty({ enum: ['public', 'authenticated', 'private', 'unlisted'], type: String })
  declare visibility: string;

  @ApiProperty({ minimum: 1, type: Number }) declare version: number;

  @ApiProperty({ items: { type: 'string' }, type: 'array' }) declare tags: string[];

  @ApiProperty({
    description: 'Attribute values the actor may read, keyed by stable field key.',
    additionalProperties: true,
    type: 'object',
  })
  declare attributes: Record<string, unknown>;

  @ApiProperty({ format: 'date-time', type: String }) declare updatedAt: string;
}

export class BeginUploadRequestDto {
  @ApiProperty({ format: 'uuid', type: String })
  declare itemPublicId: string;

  @ApiProperty({ example: 'front-view.jpg', maxLength: 255, minLength: 1, type: String })
  declare filename: string;

  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'], type: String })
  declare mimeType: string;

  @ApiProperty({ description: 'Declared byte size of the file.', minimum: 1, type: Number })
  declare byteSize: number;
}

export class UploadSessionDto {
  @ApiProperty({ format: 'uuid', type: String }) declare sessionId: string;

  @ApiProperty({
    description: 'Where the raw bytes are streamed with a PUT request.',
    example: '/api/v1/media/upload-sessions/{id}/content',
    type: String,
  })
  declare uploadUrl: string;

  @ApiProperty({ type: String }) declare declaredFilename: string;
  @ApiProperty({ type: String }) declare declaredMimeType: string;
  @ApiProperty({ minimum: 1, type: Number }) declare declaredByteSize: number;
  @ApiProperty({ format: 'date-time', type: String }) declare expiresAt: string;

  @ApiProperty({
    enum: ['pending', 'received', 'finalized', 'failed', 'expired'],
    type: String,
  })
  declare state: string;
}

export class FinalizeUploadRequestDto {
  @ApiPropertyOptional({
    description: 'Client-computed SHA-256 of the uploaded bytes; rejected when it disagrees.',
    nullable: true,
    pattern: '^[0-9a-f]{64}$',
    type: String,
  })
  declare checksumSha256?: string | null;

  @ApiPropertyOptional({ enum: ['primary', 'gallery', 'container_photo'], type: String })
  declare role?: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true, type: String })
  declare altText?: string | null;

  @ApiPropertyOptional({ enum: ['public', 'authenticated', 'private'], type: String })
  declare visibility?: string;
}

export class MediaVariantDto {
  @ApiProperty({ enum: ['thumb', 'card', 'preview'], type: String }) declare name: string;
  @ApiProperty({ example: 'image/webp', type: String }) declare mimeType: string;
  @ApiProperty({ minimum: 1, type: Number }) declare byteSize: number;
  @ApiPropertyOptional({ minimum: 1, nullable: true, type: Number }) declare width: number | null;
  @ApiPropertyOptional({ minimum: 1, nullable: true, type: Number }) declare height: number | null;

  @ApiProperty({ description: 'Where the processed bytes are served from.', type: String })
  declare contentUrl: string;
}

export class MediaItemDto {
  @ApiProperty({ format: 'uuid', type: String }) declare relationId: string;
  @ApiProperty({ format: 'uuid', type: String }) declare assetId: string;

  @ApiProperty({ enum: ['primary', 'gallery', 'container_photo'], type: String })
  declare role: string;

  @ApiProperty({ minimum: 0, type: Number }) declare position: number;

  @ApiPropertyOptional({ nullable: true, type: String }) declare altText: string | null;

  @ApiProperty({ enum: ['public', 'authenticated', 'private'], type: String })
  declare visibility: string;

  @ApiProperty({ type: String }) declare originalFilename: string;
  @ApiProperty({ type: String }) declare mimeType: string;
  @ApiProperty({ minimum: 1, type: Number }) declare byteSize: number;
  @ApiPropertyOptional({ minimum: 1, nullable: true, type: Number }) declare width: number | null;
  @ApiPropertyOptional({ minimum: 1, nullable: true, type: Number }) declare height: number | null;
  @ApiProperty({ pattern: '^[0-9a-f]{64}$', type: String }) declare checksumSha256: string;

  @ApiProperty({ enum: ['pending', 'ready', 'failed'], type: String })
  declare processingState: string;

  @ApiProperty({ description: 'Where the stored bytes are served from.', type: String })
  declare contentUrl: string;

  @ApiProperty({
    description: 'Processed renditions; empty while the asset is pending or failed.',
    type: [MediaVariantDto],
  })
  declare variants: MediaVariantDto[];

  @ApiPropertyOptional({
    description: 'Smallest completed rendition, or null while only the original exists.',
    nullable: true,
    type: String,
  })
  declare thumbnailUrl: string | null;
}

export class ReorderMediaRequestDto {
  @ApiProperty({ format: 'uuid', type: String })
  declare itemPublicId: string;

  @ApiProperty({
    description: 'Known Item version; a stale value is rejected instead of reordering.',
    minimum: 1,
    type: Number,
  })
  declare expectedVersion: number;

  @ApiProperty({
    description: 'Every active gallery relation exactly once, in the intended order.',
    items: { format: 'uuid', type: 'string' },
    minItems: 1,
    type: 'array',
  })
  declare order: string[];
}

export class ItemSummaryDto {
  @ApiProperty({ example: 'itm_01JBM4V6M9Q5Q2HTY0FQVN3M2D', type: String })
  declare publicId: string;

  @ApiProperty({ example: 'Cordless drill', type: String })
  declare displayName: string;

  @ApiProperty({ example: 8, minimum: 1, type: Number })
  declare version: number;
}

export class CursorPageDto {
  @ApiPropertyOptional({
    description: 'Opaque cursor for the next page.',
    example: 'eyJpZCI6Ii4uLiJ9',
    type: String,
  })
  declare nextCursor?: string;

  @ApiProperty({ example: 25, maximum: 100, minimum: 1, type: Number })
  declare limit: number;
}

export class ItemPageResponseDto {
  @ApiProperty({ type: [ItemSummaryDto] })
  declare items: ItemSummaryDto[];

  @ApiProperty({ type: CursorPageDto })
  declare page: CursorPageDto;
}

export class VersionConflictProblemDto extends ProblemDetailsDto {
  @ApiProperty({ example: 8, minimum: 1, type: Number })
  declare currentVersion: number;

  @ApiProperty({
    additionalProperties: true,
    description:
      'Visibility-safe fields that differ between the stored Item and the rejected submission. ' +
      'Each entry carries the current and submitted value; fields the actor cannot view are ' +
      'never included.',
    example: {
      displayName: { current: 'Cordless drill (workshop)', submitted: 'Cordless drill' },
    },
    type: 'object',
  })
  declare safeDiff: Record<string, unknown>;
}

export class CreateStorageNodeRequestDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  declare parentPublicId?: string | null;

  @ApiProperty({
    enum: ['site', 'room', 'zone', 'rack', 'shelf', 'container', 'custom'],
    type: String,
  })
  declare nodeType: string;

  @ApiProperty({ maxLength: 500, minLength: 1, type: String })
  declare title: string;

  @ApiPropertyOptional({ maxLength: 128, nullable: true, type: String })
  declare code?: string | null;

  @ApiPropertyOptional({
    enum: ['public', 'authenticated', 'private', 'unlisted'],
    type: String,
  })
  declare visibility?: string;

  @ApiPropertyOptional({ additionalProperties: true, type: 'object' })
  declare attributes?: Record<string, unknown>;
}

export class UpdateStorageNodeRequestDto {
  @ApiProperty({ minimum: 1, type: Number })
  declare expectedVersion: number;

  @ApiPropertyOptional({
    enum: ['site', 'room', 'zone', 'rack', 'shelf', 'container', 'custom'],
    type: String,
  })
  declare nodeType?: string;

  @ApiPropertyOptional({ maxLength: 500, minLength: 1, type: String })
  declare title?: string;

  @ApiPropertyOptional({ maxLength: 128, nullable: true, type: String })
  declare code?: string | null;

  @ApiPropertyOptional({
    enum: ['public', 'authenticated', 'private', 'unlisted'],
    type: String,
  })
  declare visibility?: string;

  @ApiPropertyOptional({ type: Boolean })
  declare archived?: boolean;

  @ApiPropertyOptional({ additionalProperties: true, type: 'object' })
  declare attributes?: Record<string, unknown>;
}

export class MoveStorageNodeRequestDto {
  @ApiProperty({ minimum: 1, type: Number })
  declare expectedVersion: number;

  @ApiProperty({ format: 'uuid', type: String })
  declare targetParentPublicId: string;

  @ApiPropertyOptional({ maxLength: 512, minLength: 1, type: String })
  declare reason?: string;
}

export class StorageNodeSummaryDto {
  @ApiProperty({ format: 'uuid', type: String }) declare publicId: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  declare parentPublicId: string | null;
  @ApiProperty({
    enum: ['site', 'room', 'zone', 'rack', 'shelf', 'container', 'custom'],
    type: String,
  })
  declare nodeType: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiPropertyOptional({ nullable: true, type: String }) declare code: string | null;
  @ApiProperty({ enum: ['public', 'authenticated', 'private', 'unlisted'], type: String })
  declare visibility: string;
  @ApiProperty({ minimum: 0, type: Number }) declare depth: number;
  @ApiProperty({ minimum: 1, type: Number }) declare version: number;
}

export class StorageBreadcrumbDto {
  @ApiProperty({ format: 'uuid', type: String }) declare publicId: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ minimum: 0, type: Number }) declare depth: number;
}

export class StorageContentDto {
  @ApiProperty({ enum: ['node', 'item'], type: String }) declare kind: string;
  @ApiProperty({ format: 'uuid', type: String }) declare publicId: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ enum: ['public', 'authenticated', 'private', 'unlisted'], type: String })
  declare visibility: string;
  @ApiProperty({ minimum: 1, type: Number }) declare version: number;
}

export class StorageContentPageDto {
  @ApiProperty({ type: [StorageContentDto] }) declare entries: StorageContentDto[];
  @ApiPropertyOptional({ nullable: true, type: String }) declare nextCursor: string | null;
}

export class StorageNodePageDto {
  @ApiProperty({ type: [StorageNodeSummaryDto] }) declare entries: StorageNodeSummaryDto[];
  @ApiPropertyOptional({ nullable: true, type: String }) declare nextCursor: string | null;
}

export class StorageNodeDetailDto extends StorageNodeSummaryDto {
  @ApiProperty({ type: [StorageBreadcrumbDto] }) declare breadcrumb: StorageBreadcrumbDto[];
  @ApiProperty({ type: StorageContentPageDto }) declare contents: StorageContentPageDto;
  @ApiProperty({ additionalProperties: true, type: 'object' })
  declare attributes: Record<string, unknown>;
  @ApiProperty({ format: 'date-time', type: String }) declare updatedAt: string;
}

export const contractModels = [
  ProblemFieldErrorDto,
  ProblemDetailsDto,
  ItemMutationRequestDto,
  CreateItemRequestDto,
  CreatedItemDto,
  UpdateItemRequestDto,
  UpdatedItemDto,
  ItemDetailDto,
  BeginUploadRequestDto,
  UploadSessionDto,
  FinalizeUploadRequestDto,
  MediaVariantDto,
  MediaItemDto,
  ReorderMediaRequestDto,
  ItemSummaryDto,
  CursorPageDto,
  ItemPageResponseDto,
  VersionConflictProblemDto,
  CreateStorageNodeRequestDto,
  UpdateStorageNodeRequestDto,
  MoveStorageNodeRequestDto,
  StorageNodeSummaryDto,
  StorageBreadcrumbDto,
  StorageContentDto,
  StorageContentPageDto,
  StorageNodePageDto,
  StorageNodeDetailDto,
] as const;
