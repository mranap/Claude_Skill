import {
  Activity,
  Briefcase,
  CircleCheck,
  CircleX,
  KeyRound,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  ShieldX,
  Wallet,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { RelativeTime } from '@/components/shared/relative-time';
import { cn } from '@/lib/utils/cn';
import { formatDateTime } from '@/lib/utils/format';
import { humanize } from '@/lib/utils/strings';
import type { ActivityEventDto } from './types';

const ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  CAMPAIGN_CREATED: { icon: Rocket, tone: 'text-primary-fg bg-primary/10' },
  LAUNCH_COMPLETED: { icon: CircleCheck, tone: 'text-success-fg bg-success/10' },
  LAUNCH_FAILED: { icon: CircleX, tone: 'text-destructive-fg bg-destructive/10' },
  STARTED: { icon: Play, tone: 'text-success-fg bg-success/10' },
  PAUSED: { icon: Pause, tone: 'text-muted-foreground bg-muted' },
  BUDGET_CHANGED: { icon: Wallet, tone: 'text-info-fg bg-info/10' },
  RULE_TRIGGERED: { icon: Workflow, tone: 'text-primary-fg bg-primary/10' },
  STATUS_CHANGED: { icon: Activity, tone: 'text-info-fg bg-info/10' },
  ACCOUNT_STATUS_CHANGED: { icon: Briefcase, tone: 'text-warning-fg bg-warning/12' },
  TOKEN_STATUS_CHANGED: { icon: KeyRound, tone: 'text-warning-fg bg-warning/12' },
  AD_REJECTED: { icon: ShieldX, tone: 'text-destructive-fg bg-destructive/10' },
  SYNC_FAILED: { icon: RefreshCw, tone: 'text-destructive-fg bg-destructive/10' },
};

const SOURCES: Record<string, string> = {
  USER: 'You',
  RULE: 'Rule',
  SYSTEM: 'System',
  META_SYNC: 'Meta sync',
  LAUNCH: 'Launch',
  BULK: 'Bulk action',
};

function detailChips(details: Record<string, unknown> | null): [string, string][] {
  if (!details) return [];
  return Object.entries(details)
    .filter(([key, value]) => (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') && !/id$/i.test(key))
    .slice(0, 4)
    .map(([key, value]) => [humanize(key), String(value)]);
}

/** Vertical timeline of activity events (newest first). */
export function ActivityTimeline({ events, className }: { events: ActivityEventDto[]; className?: string }) {
  return (
    <ol className={cn('grid', className)}>
      {events.map((event, index) => {
        const meta = ICONS[event.type] ?? { icon: Activity, tone: 'text-muted-foreground bg-muted' };
        const Icon = meta.icon;
        const chips = detailChips(event.details);
        return (
          <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
            {index < events.length - 1 ? <span aria-hidden className="absolute top-8 bottom-0 left-[15px] w-px bg-border" /> : null}
            <span className={cn('relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full', meta.tone)}>
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="grid min-w-0 flex-1 gap-1 pt-1">
              <p className="text-sm leading-5 text-foreground">{event.title}</p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <SimpleTooltip content={formatDateTime(event.createdAt, { seconds: true })}>
                  <span>
                    <RelativeTime value={event.createdAt} />
                  </span>
                </SimpleTooltip>
                <span aria-hidden>·</span>
                <span>{SOURCES[event.source] ?? humanize(event.source)}</span>
                {event.entityLevel && event.entityLevel !== 'ACCOUNT' ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{humanize(event.entityLevel === 'ADSET' ? 'ad set' : event.entityLevel)}</span>
                  </>
                ) : null}
                {chips.map(([label, value]) => (
                  <Badge key={label} variant="outline" size="sm" className="font-normal">
                    {label}: {value}
                  </Badge>
                ))}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
