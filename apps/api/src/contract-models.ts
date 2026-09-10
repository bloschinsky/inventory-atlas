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
    description: 'Visibility-safe fields that changed since the submitted version.',
    example: { displayName: 'Cordless drill (workshop)' },
    type: 'object',
  })
  declare safeDiff: Record<string, unknown>;
}

export const contractModels = [
  ProblemFieldErrorDto,
  ProblemDetailsDto,
  ItemMutationRequestDto,
  CreateItemRequestDto,
  CreatedItemDto,
  ItemSummaryDto,
  CursorPageDto,
  ItemPageResponseDto,
  VersionConflictProblemDto,
] as const;
