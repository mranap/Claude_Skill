import type { MetricsDto } from '@adpilot/shared';
import type { ISODateString, JobRunStatus } from '@/lib/api/types';
import type { ActivityEventDto } from '../activity/types';

export type EntityActionLevel = 'CAMPAIGN' | 'ADSET' | 'AD';

/** Budget in major units of the ad account currency (decimal string). */
export interface BudgetDto {
  type: 'DAILY' | 'LIFETIME';
  amount: string;
}

/** GET /campaigns item. */
export interface CampaignListItem {
  id: string;
  metaCampaignId: string;
  name: string;
  objective: string | null;
  status: string | null;
  effectiveStatus: string | null;
  adAccount: { id: string; name: string; metaAccountId: string };
  currency: string;
  budget: BudgetDto | null;
  countries: string[];
  templateId: string | null;
  metrics: MetricsDto | null;
  updatedAt: ISODateString;
}

export interface AdSetRow {
  id: string;
  metaAdSetId: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  optimizationGoal: string | null;
  budget: BudgetDto | null;
  countries: string[];
  metrics: MetricsDto | null;
}

export interface AdRow {
  id: string;
  metaAdId: string;
  adSetId: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  reviewFeedback: unknown;
  issuesInfo: unknown;
  metrics: MetricsDto | null;
}

/** GET /campaigns/:id */
export interface CampaignDetail {
  id: string;
  metaCampaignId: string;
  name: string;
  objective: string | null;
  status: string | null;
  effectiveStatus: string | null;
  bidStrategy: string | null;
  budget: BudgetDto | null;
  currency: string;
  adAccount: { id: string; name: string; currency: string; timezoneName: string; metaAccountId: string };
  countries: string[];
  specialAdCategories: string[];
  launchJobId: string | null;
  templateId: string | null;
  issuesInfo: unknown;
  metrics: MetricsDto | null;
  adSets: AdSetRow[];
  ads: AdRow[];
  timeline: ActivityEventDto[];
  lastSyncedAt: ISODateString;
}

export interface StatusChangeResult {
  changed: boolean;
  before: string | null;
  after: string;
}

export interface BudgetChangeResult {
  field: 'daily_budget' | 'lifetime_budget';
  before: string;
  after: string;
  currency: string;
}

/** `details` of the 409 returned for budget changes above 50 % without confirmation. */
export interface LargeBudgetChange {
  requiresConfirmation: true;
  before: string;
  after: string;
  currency: string;
  changePct: number;
}

export interface BulkTargetResult {
  id: string;
  name?: string;
  ok: boolean;
  changed?: boolean;
  error?: string;
}

/** POST /campaigns/actions/bulk-status and GET /campaigns/bulk/:id */
export interface BulkOperationDto {
  id: string;
  idempotencyKey: string;
  level: EntityActionLevel;
  action: 'PAUSE' | 'START';
  targetIds: string[];
  status: JobRunStatus;
  total: number;
  succeeded: number;
  failed: number;
  results: BulkTargetResult[] | null;
  createdAt: ISODateString;
  finishedAt: ISODateString | null;
}

/** Minimal shape the status toggle, budget editor and bulk actions work with, whatever the source row. */
export interface EntityRef {
  level: EntityActionLevel;
  id: string;
  name: string;
  status: string | null;
  effectiveStatus?: string | null;
  currency: string;
  budget?: BudgetDto | null;
}
