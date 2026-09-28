import type { CreativeType } from '@adpilot/shared';
import type { BigIntString, ISODateString } from '@/lib/api/types';

export interface CreativeMetaAssetDto {
  adAccountId: string;
  adAccountName?: string;
  metaAccountId?: string;
  status: 'PENDING' | 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  metaImageHash: string | null;
  metaVideoId: string | null;
  error: string | null;
  readyAt: ISODateString | null;
}

/** GET /creatives items (library files). `previewUrl`/`fileUrl` are same-origin `/api/...` paths. */
export interface CreativeDto {
  id: string;
  type: CreativeType;
  status: 'PROCESSING' | 'READY' | 'FAILED';
  name: string;
  mimeType: string;
  extension: string;
  sizeBytes: BigIntString;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  aspectRatio: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  frameRate: number | null;
  tags: string[];
  createdAt: ISODateString;
  previewUrl: string | null;
  fileUrl: string;
  metaAssets: CreativeMetaAssetDto[];
}

export interface FileLimits {
  maxImageSizeMb: number;
  maxVideoSizeMb: number;
  maxUploadSizeMb: number;
  maxUserStorageMb: number;
  maxFilesPerUpload: number;
}

export interface CreativeUsage {
  usedBytes: BigIntString;
  quotaBytes: BigIntString;
  images: number;
  videos: number;
  limits: FileLimits;
}

/** One entry of POST /creatives/upload → `results[]`. */
export interface UploadItemResult {
  originalName: string;
  ok: boolean;
  duplicate?: boolean;
  file?: CreativeDto;
  warnings?: string[];
  error?: string;
}
