import type { EntityLevel } from '@adpilot/shared';
import type { ISODateString } from '@/lib/api/types';

/** Activity timeline entry (campaign / ad account history, dashboard "recent events"). */
export interface ActivityEventDto {
  id: string;
  userId: string;
  adAccountId: string | null;
  entityLevel: EntityLevel | null;
  entityMetaId: string | null;
  entityName: string | null;
  type: string;
  title: string;
  details: Record<string, unknown> | null;
  source: 'USER' | 'RULE' | 'SYSTEM' | 'META_SYNC' | 'LAUNCH' | string;
  actorUserId: string | null;
  createdAt: ISODateString;
}
