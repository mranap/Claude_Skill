import { Check, type LucideIcon } from 'lucide-react';
import type * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from './empty-state';
import { PageHeader } from './page-header';

/**
 * Placeholder for product sections whose API is being connected. Keeps navigation, breadcrumbs and page
 * chrome in place so the real page can drop in without layout changes.
 */
export function SectionPlaceholder({
  title,
  description,
  icon,
  highlights = [],
  actions,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  highlights?: string[];
  actions?: React.ReactNode;
}) {
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={actions}
        meta={
          <Badge variant="muted" size="sm">
            Coming soon
          </Badge>
        }
      />
      <Card className="overflow-hidden">
        <EmptyState
          icon={icon}
          title="This section is being connected"
          description="The screens are ready for the platform's API. As soon as the backend endpoints for this area are live, your data will appear here."
        >
          {highlights.length ? (
            <ul className="mt-6 grid w-full max-w-lg gap-2 text-left sm:grid-cols-2">
              {highlights.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-[13px] text-muted-foreground"
                >
                  <Check className="mt-0.5 size-3.5 shrink-0 text-primary-fg" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </EmptyState>
      </Card>
    </>
  );
}
