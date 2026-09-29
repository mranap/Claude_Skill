'use client';

import { TELEGRAM_MODES, telegramSettingsSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Bot, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Label } from '@/components/ui/label';
import { ErrorAlert } from '@/components/shared/error-alert';
import type { AdminSettingGroup, SettingsEnvironment } from '@/lib/api/types';
import { adminSettingsApi, pickSchemaValues, secretPatch, useSaveSettings } from '../api';
import { managePermission } from '../categories';
import { SecretField } from '../secret-field';
import { SelectField, SwitchField } from '../fields';
import { FieldGrid, FieldSection, SettingsFormCard } from '../settings-form-card';

const MODE_LABELS: Record<(typeof TELEGRAM_MODES)[number], { label: string; description: string }> = {
  POLLING: { label: 'Long polling', description: 'The worker asks Telegram for updates. Works everywhere.' },
  WEBHOOK: { label: 'Webhook', description: 'Telegram calls AdPilot. Requires a public https:// APP_URL.' },
};

export function TelegramSettingsForm({
  values,
  readOnly,
  environment,
}: {
  values: AdminSettingGroup<'telegram'>;
  readOnly: boolean;
  environment: SettingsEnvironment;
}) {
  const save = useSaveSettings('telegram');
  const form = useForm({
    resolver: zodResolver(telegramSettingsSchema),
    values: pickSchemaValues(telegramSettingsSchema.shape, values),
  });
  const [secrets, setSecrets] = useState<Record<string, string | null | undefined>>({});
  const patch = secretPatch(secrets);
  const dirty = form.formState.isDirty || Object.keys(patch).length > 0;
  const mode = useWatch({ control: form.control, name: 'mode' });
  const enabled = useWatch({ control: form.control, name: 'enabled' });
  const httpsApp = environment.appUrl.startsWith('https://');
  const test = useMutation({ mutationFn: adminSettingsApi.testTelegram });

  return (
    <SettingsFormCard
      title="Telegram"
      description="The bot that delivers notifications to users who linked their Telegram account."
      form={form}
      readOnly={readOnly}
      permission={managePermission('telegram')}
      extraDirty={Object.keys(patch).length > 0}
      onDiscard={() => setSecrets({})}
      onSubmit={async (v) => {
        // The bot username is derived from the token by the API.
        await save.mutateAsync({ values: v, secrets: patch });
        setSecrets({});
      }}
      footerActions={
        <Button
          type="button"
          variant="outline"
          onClick={() => test.mutate()}
          loading={test.isPending}
          disabled={dirty || !values.botTokenSet}
        >
          <Bot />
          Test bot
        </Button>
      }
      before={
        <>
          {test.data ? (
            <Alert variant="success">
              <AlertTitle>Bot @{test.data.bot.username} is working</AlertTitle>
              <AlertDescription>
                {test.data.sentToYou
                  ? 'A confirmation message was sent to your linked Telegram chat.'
                  : 'Link your own Telegram in Settings → Notifications to receive a test message.'}
                {test.data.webhook?.url ? ` Webhook: ${test.data.webhook.url}.` : ''}
                {test.data.webhook?.last_error_message
                  ? ` Last webhook error: ${test.data.webhook.last_error_message}.`
                  : ''}
              </AlertDescription>
            </Alert>
          ) : null}
          {test.error ? <ErrorAlert error={test.error} title="Bot test failed" /> : null}
        </>
      }
    >
      <SwitchField
        control={form.control}
        name="enabled"
        label="Enable Telegram notifications"
        description="Users can link Telegram and receive alerts once a bot token is set."
      />
      {enabled && !values.botTokenSet && secrets.botToken === undefined ? (
        <Alert variant="warning">
          <AlertDescription className="text-foreground/80">
            Add a bot token below, otherwise nothing can be delivered.
          </AlertDescription>
        </Alert>
      ) : null}
      <FieldSection
        title="Bot"
        description={
          <>
            Create a bot with{' '}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary-fg hover:underline"
            >
              @BotFather
            </a>{' '}
            and paste its token. The token is validated with Telegram and stored encrypted.
          </>
        }
      >
        <FieldGrid>
          <SecretField
            label="Bot token"
            isSet={!!values.botTokenSet}
            value={secrets.botToken}
            onChange={(v) => setSecrets((s) => ({ ...s, botToken: v }))}
            placeholder="123456789:AA…"
            disabled={readOnly}
          />
          <div className="grid gap-2">
            <Label>Bot username</Label>
            <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm">
              {values.botUsername ? (
                <>
                  <span className="font-medium">@{values.botUsername}</span>
                  <a
                    href={`https://t.me/${values.botUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-muted-foreground hover:text-foreground"
                    aria-label="Open bot in Telegram"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                </>
              ) : (
                <span className="text-muted-foreground">Filled in automatically from the token</span>
              )}
            </div>
          </div>
        </FieldGrid>
      </FieldSection>
      <FieldSection title="Delivery mode">
        <FieldGrid>
          <SelectField
            control={form.control}
            name="mode"
            label="Mode"
            options={TELEGRAM_MODES.map((m) => ({
              value: m,
              label: MODE_LABELS[m].label,
              description: MODE_LABELS[m].description,
            }))}
          />
          <div className="grid gap-2">
            <Label className="flex items-center gap-2">
              Webhook URL
              {values.webhookSecretSet ? (
                <Badge variant="success" size="sm">
                  Secret set
                </Badge>
              ) : (
                <Badge variant="muted" size="sm">
                  No secret yet
                </Badge>
              )}
            </Label>
            <div className="flex h-9 items-center gap-1 rounded-md border bg-muted/40 pr-1 pl-3 text-sm">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {environment.telegramWebhookUrl}
              </span>
              <CopyButton value={environment.telegramWebhookUrl} />
            </div>
            <p className="text-xs text-muted-foreground">
              The webhook secret is generated by the platform when you switch to webhook mode.
            </p>
          </div>
        </FieldGrid>
        {mode === 'WEBHOOK' && !httpsApp ? (
          <Alert variant="warning">
            <AlertTitle>Webhook mode needs HTTPS</AlertTitle>
            <AlertDescription>
              APP_URL is {environment.appUrl}. Telegram only calls https:// URLs, so saving will fail until
              the platform runs behind HTTPS.
            </AlertDescription>
          </Alert>
        ) : null}
      </FieldSection>
    </SettingsFormCard>
  );
}
