import type { LaunchConfig } from '@adpilot/shared';
import type { AdAccount, CreativeFile, MetaProfile, Page, Pixel, Proxy } from '../../generated/prisma/client';

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface LaunchContext {
  config: LaunchConfig;
  profile: MetaProfile & { proxy: Proxy | null };
  adAccount: AdAccount;
  page: Page | null;
  pixel: Pixel | null;
  creatives: Map<string, CreativeFile>;
}

/** Reference to a value produced by another plan item (resolved at execution time). */
export interface PlanRef {
  $ref: string;
  field: 'metaId' | 'imageHash' | 'videoId' | 'thumbnailUrl';
}

export interface PlanItem {
  key: string;
  kind: 'MEDIA_IMAGE' | 'MEDIA_VIDEO' | 'CAMPAIGN' | 'ADSET' | 'CREATIVE' | 'AD';
  parentKey?: string;
  name: string;
  /** Meta request parameters; values may contain PlanRef objects. */
  payload: Record<string, unknown>;
  /** For media items: the library file id. */
  creativeFileId?: string;
}

export interface PlanSummary {
  campaigns: number;
  adSets: number;
  ads: number;
  creatives: number;
  mediaUploads: number;
  currency: string;
  budget: {
    level: 'CAMPAIGN' | 'ADSET';
    type: 'DAILY' | 'LIFETIME';
    campaignAmount?: string;
    perAdSet: { variant: string; amount: string }[];
    total: string;
  };
  bidStrategy: string;
  geos: { variant: string; countries: string[]; locales: string[] }[];
  audience: {
    ageMin: number;
    ageMax: number;
    genders: string;
    advantageAudience: boolean;
    customAudiences: number;
    excludedAudiences: number;
    interests: number;
  };
  placements: string;
  creativeFiles: { creativeFileId: string; name: string; type: string }[];
  objective: string;
  optimizationGoal: string;
  destination: string;
  activateOnSuccess: boolean;
}

export interface LaunchPlan {
  version: 1;
  code: string;
  adAccountMetaId: string;
  items: PlanItem[];
  summary: PlanSummary;
}
