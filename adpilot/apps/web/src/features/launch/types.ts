import type { LaunchItemKind, LaunchItemStatus, LaunchJobStatus, MetaErrorDetails } from '@adpilot/shared';
import type { ISODateString } from '@/lib/api/types';

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
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

export interface DryRunItem {
  key: string;
  kind: LaunchItemKind;
  name: string;
  parentKey?: string;
  payload: Record<string, unknown>;
}

export interface DryRunResult extends ValidationResult {
  summary?: PlanSummary;
  items?: DryRunItem[];
}

export interface LaunchDraftDto {
  id: string;
  name: string;
  templateId: string | null;
  profileId: string | null;
  adAccountId: string | null;
  schemaVersion: number;
  config: Record<string, unknown>;
  status: 'DRAFT' | 'LAUNCHED' | 'ARCHIVED';
  clonedFromId: string | null;
  lastValidatedAt: ISODateString | null;
  validationResult: ValidationResult | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface DraftListItem {
  id: string;
  name: string;
  status: 'DRAFT' | 'LAUNCHED' | 'ARCHIVED';
  template: { id: string; name: string } | null;
  profileId: string | null;
  adAccountId: string | null;
  variants: number;
  lastValidatedAt: ISODateString | null;
  updatedAt: ISODateString;
  createdAt: ISODateString;
}

export interface LaunchJobListItem {
  id: string;
  code: string;
  name: string;
  status: LaunchJobStatus;
  progress: number;
  currentStep: string | null;
  totalItems: number;
  createdItems: number;
  failedItems: number;
  metaCampaignId: string | null;
  createdAt: ISODateString;
  finishedAt: ISODateString | null;
  adAccount: { id: string; name: string; metaAccountId: string };
}

export interface LaunchItemError {
  message: string;
  meta?: MetaErrorDetails;
}

export interface LaunchJobItemDto {
  id: string;
  kind: LaunchItemKind;
  key: string;
  parentKey: string | null;
  name: string;
  status: LaunchItemStatus;
  metaId: string | null;
  attemptCount: number;
  lastError: LaunchItemError | null;
  errorCategory: string | null;
  updatedAt: ISODateString;
}

export interface LaunchJobDto {
  id: string;
  draftId: string | null;
  templateId: string | null;
  profileId: string;
  adAccountId: string;
  code: string;
  name: string;
  status: LaunchJobStatus;
  progress: number;
  currentStep: string | null;
  summary: PlanSummary | null;
  error: { message: string; details?: unknown } | null;
  warnings: ValidationIssue[] | null;
  activateOnSuccess: boolean;
  totalItems: number;
  createdItems: number;
  failedItems: number;
  attempt: number;
  metaCampaignId: string | null;
  queuedAt: ISODateString;
  startedAt: ISODateString | null;
  finishedAt: ISODateString | null;
  cancelRequestedAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  items: LaunchJobItemDto[];
  adAccount: { id: string; name: string; metaAccountId: string; currency: string };
}
