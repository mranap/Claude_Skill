'use client';

import { Bell, ChartColumn, Mail, MousePointerClick, Plus, Send, Trash, Wallet } from 'lucide-react';
import { useState } from 'react';
import type * as React from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput, decimalToMinorUnits } from '@/components/ui/money-input';
import { PasswordInput } from '@/components/ui/password-input';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Stepper } from '@/components/ui/stepper';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DateRangePicker, type DateRangeValue } from '@/components/shared/date-range-picker';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorAlert } from '@/components/shared/error-alert';
import { JsonViewer } from '@/components/shared/json-viewer';
import { KeyValueList } from '@/components/shared/key-value';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { ApiError } from '@/lib/api/errors';

const META_ERROR = new ApiError({
  status: 422,
  code: 'META_API_ERROR',
  message: 'Meta rejected the request',
  requestId: 'req_7f3a9c21',
  meta: {
    friendlyMessage: 'The daily budget is lower than the minimum Meta allows for this ad account currency.',
    userTitle: 'Budget too low',
    code: 100,
    subcode: 1885272,
    type: 'OAuthException',
    message: 'Invalid parameter: The budget you entered is too low.',
    fbtraceId: 'AbCdEf123XyZ',
    httpStatus: 400,
    category: 'VALIDATION',
    retryable: false,
  },
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

/** Development-only gallery of the design-system components (not routed in production). */
export function UiKit() {
  const [money, setMoney] = useState('25.50');
  const [range, setRange] = useState<DateRangeValue | null>(null);
  const [channel, setChannel] = useState<'EMAIL' | 'TELEGRAM' | 'BOTH' | 'OFF'>('BOTH');
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="UI kit"
        description="Design-system components in one place (development only)."
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'UI kit' }]}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Buttons">
          <div className="flex flex-wrap gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">
              <Trash />
              Delete
            </Button>
            <Button variant="destructive-outline">Danger outline</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="xs">Extra small</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Add">
              <Plus />
            </Button>
            <Button loading>Saving</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Section>

        <Section title="Badges & status">
          <div className="flex flex-wrap gap-2">
            {(
              ['default', 'secondary', 'outline', 'success', 'warning', 'danger', 'info', 'muted'] as const
            ).map((v) => (
              <Badge key={v} variant={v}>
                {v}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              'ACTIVE',
              'BLOCKED',
              'PENDING',
              'RUNNING',
              'COMPLETED',
              'PARTIAL_FAILURE',
              'FAILED',
              'EXPIRED',
              'UNCHECKED',
            ].map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
        </Section>

        <Section title="Inputs">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="kit-input">Text</Label>
              <Input id="kit-input" placeholder="Campaign name" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="kit-invalid">Invalid</Label>
              <Input id="kit-invalid" aria-invalid defaultValue="bad value" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="kit-money">Daily budget (string decimal)</Label>
              <MoneyInput id="kit-money" value={money} onValueChange={setMoney} currency="USD" />
              <p className="text-xs text-muted-foreground">
                Minor units sent to the API: {decimalToMinorUnits(money || '0')}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="kit-password">Password</Label>
              <PasswordInput id="kit-password" defaultValue="" showStrength />
            </div>
            <div className="grid gap-2">
              <Label>Select</Label>
              <Select defaultValue="LOWEST_COST">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOWEST_COST" description="Get the most results for your budget">
                    Highest volume
                  </SelectItem>
                  <SelectItem value="COST_CAP" description="Keep the average cost per result near a target">
                    Cost per result goal
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Date range</Label>
              <DateRangePicker value={range} onChange={setRange} />
            </div>
          </div>
          <Textarea placeholder="Primary text" rows={2} />
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox defaultChecked /> Checkbox
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch defaultChecked /> Switch
            </label>
            <RadioGroup defaultValue="a" className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="a" /> Option A
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="b" /> Option B
              </label>
            </RadioGroup>
          </div>
          <SegmentedControl
            aria-label="Channel"
            value={channel}
            onValueChange={setChannel}
            options={[
              { value: 'EMAIL', label: 'Email', icon: <Mail /> },
              { value: 'TELEGRAM', label: 'Telegram', icon: <Send /> },
              { value: 'BOTH', label: 'Both' },
              { value: 'OFF', label: 'Off' },
            ]}
          />
        </Section>

        <Section title="Stepper">
          <Stepper
            current={3}
            steps={[
              { id: '1', title: 'Account' },
              { id: '2', title: 'Campaign' },
              { id: '3', title: 'Budget', state: 'error', description: 'Too low' },
              { id: '4', title: 'Audience' },
              { id: '5', title: 'Placements' },
              { id: '6', title: 'Creatives' },
              { id: '7', title: 'Copy' },
              { id: '8', title: 'Tracking' },
              { id: '9', title: 'Review' },
            ]}
            onStepClick={() => undefined}
          />
          <Progress value={64} />
          <Progress indeterminate tone="success" />
        </Section>

        <Section title="Stat cards">
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard
              label="Spend"
              value="$12,480.20"
              icon={Wallet}
              delta={{ value: 12.4, label: 'vs. previous 7 days' }}
            />
            <StatCard
              label="Cost per result"
              value="$3.12"
              icon={ChartColumn}
              delta={{ value: 8.1, positiveIsGood: false, label: 'vs. previous 7 days' }}
            />
            <StatCard label="Clicks" value="18,204" icon={MousePointerClick} delta={{ value: 0 }} />
            <StatCard label="Loading" value="—" icon={Bell} loading />
          </div>
        </Section>

        <Section title="Alerts & errors">
          <Alert variant="info">
            <AlertTitle>Heads up</AlertTitle>
            <AlertDescription>Statistics sync every 35 minutes.</AlertDescription>
          </Alert>
          <Alert variant="success">
            <AlertTitle>Launched</AlertTitle>
            <AlertDescription>3 ad sets and 9 ads were created.</AlertDescription>
          </Alert>
          <Alert variant="warning">
            <AlertTitle>Token expires soon</AlertTitle>
            <AlertDescription>Reconnect the Meta profile within 5 days.</AlertDescription>
          </Alert>
          <ErrorAlert error={META_ERROR} onRetry={() => undefined} />
        </Section>

        <Section title="Data display">
          <KeyValueList
            items={[
              { label: 'Ad account', value: 'act_1234567890', mono: true, copy: 'act_1234567890' },
              { label: 'Currency', value: 'USD' },
              { label: 'Time zone', value: 'America/New_York' },
            ]}
          />
          <JsonViewer
            value={{
              call_count: 28,
              total_cputime: 12,
              total_time: 9,
              estimated_time_to_regain_access: 0,
              ok: true,
              note: null,
            }}
          />
        </Section>

        <Section title="Disclosure & overlays">
          <Tabs defaultValue="one">
            <TabsList>
              <TabsTrigger value="one">Overview</TabsTrigger>
              <TabsTrigger value="two">Details</TabsTrigger>
            </TabsList>
            <TabsContent value="one">
              <p className="text-sm text-muted-foreground">Tab content.</p>
            </TabsContent>
            <TabsContent value="two">
              <Skeleton className="h-10" />
            </TabsContent>
          </Tabs>
          <Accordion type="single" collapsible>
            <AccordionItem value="a">
              <AccordionTrigger>What does “Advantage+ placements” mean?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                Meta decides where ads are shown to get the best results.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          <div className="flex flex-wrap gap-2">
            <SimpleTooltip content="Tooltips use the inverted surface">
              <Button variant="outline">Hover me</Button>
            </SimpleTooltip>
            <Button variant="destructive-outline" onClick={() => setConfirmOpen(true)}>
              Type-to-confirm dialog
            </Button>
          </div>
          <EmptyState
            icon={Bell}
            title="Empty state"
            description="Used by tables and lists without data."
            compact
          />
        </Section>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete campaign “Summer sale”?"
        description="The campaign and its ad sets are deleted at Meta. This cannot be undone."
        confirmText="Summer sale"
        confirmLabel="Delete campaign"
        destructive
        onConfirm={() => new Promise((resolve) => setTimeout(resolve, 600))}
      />
    </>
  );
}
