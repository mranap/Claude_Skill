'use client';

import { SMTP_ENCRYPTIONS, smtpSettingsSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { MailCheck, PlugZap } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorAlert } from '@/components/shared/error-alert';
import { NumberField, TextField } from '@/components/shared/form';
import { useAuth } from '@/features/auth/auth-context';
import type { AdminSettingGroup } from '@/lib/api/types';
import { adminSettingsApi, pickSchemaValues, secretErrors, secretPatch, useSaveSettings } from '../api';
import { managePermission } from '../categories';
import { SecretField } from '../secret-field';
import { SelectField, SwitchField } from '../fields';
import { FieldGrid, FieldSection, SettingsFormCard } from '../settings-form-card';

const ENCRYPTION_LABELS: Record<
  (typeof SMTP_ENCRYPTIONS)[number],
  { label: string; description: string; port: number }
> = {
  STARTTLS: {
    label: 'STARTTLS',
    description: 'Upgrade to TLS after connecting (usually port 587)',
    port: 587,
  },
  SSL: { label: 'SSL/TLS', description: 'Implicit TLS from the start (usually port 465)', port: 465 },
  NONE: { label: 'None', description: 'Unencrypted — only for local relays', port: 25 },
};

const schema = smtpSettingsSchema.superRefine((v, ctx) => {
  if (!v.enabled) return;
  if (!v.host) ctx.addIssue({ code: 'custom', path: ['host'], message: 'Required when SMTP is enabled' });
  if (!v.fromEmail)
    ctx.addIssue({ code: 'custom', path: ['fromEmail'], message: 'Required when SMTP is enabled' });
});

export function SmtpSettingsForm({
  values,
  readOnly,
}: {
  values: AdminSettingGroup<'smtp'>;
  readOnly: boolean;
}) {
  const save = useSaveSettings('smtp');
  const form = useForm({
    resolver: zodResolver(schema),
    values: pickSchemaValues(smtpSettingsSchema.shape, values),
  });
  const [secrets, setSecrets] = useState<Record<string, string | null | undefined>>({});
  const [testOpen, setTestOpen] = useState(false);
  const [secretError, setSecretError] = useState<Record<string, string>>({});
  const patch = secretPatch(secrets);
  const dirty = form.formState.isDirty || Object.keys(patch).length > 0;
  // With a stored password, the API asks for it again when the server or the username changes.
  const [host, port, encryption, username] = useWatch({
    control: form.control,
    name: ['host', 'port', 'encryption', 'username'],
  });
  const connectionChanged =
    host !== values.host ||
    port !== values.port ||
    encryption !== values.encryption ||
    username !== values.username;
  const needsPassword = !!values.passwordSet && connectionChanged && typeof secrets.password !== 'string';

  const verify = useMutation({
    mutationFn: adminSettingsApi.verifySmtp,
    onSuccess: () =>
      toast.success('SMTP connection verified', {
        description: 'The server accepted the connection and credentials.',
      }),
  });

  return (
    <>
      <SettingsFormCard
        title="SMTP"
        description="Outgoing mail server for invitations, password resets and notifications."
        form={form}
        readOnly={readOnly}
        permission={managePermission('smtp')}
        extraDirty={Object.keys(patch).length > 0}
        onDiscard={() => {
          setSecrets({});
          setSecretError({});
        }}
        onSubmit={async (v) => {
          setSecretError({});
          try {
            await save.mutateAsync({ values: v, secrets: patch });
          } catch (error) {
            const fieldErrors = secretErrors(error);
            if (!Object.keys(fieldErrors).length) throw error;
            setSecretError(fieldErrors);
            // Open the password input so it can be re-entered right away.
            if (fieldErrors.password && typeof secrets.password !== 'string')
              setSecrets((s) => ({ ...s, password: '' }));
            return false;
          }
          setSecrets({});
        }}
        footerActions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => verify.mutate()}
              loading={verify.isPending}
              disabled={dirty}
            >
              <PlugZap />
              Verify connection
            </Button>
            <Button type="button" variant="outline" onClick={() => setTestOpen(true)} disabled={dirty}>
              <MailCheck />
              Send test e-mail
            </Button>
          </>
        }
        before={
          <>
            {dirty && !readOnly ? (
              <Alert variant="info">
                <AlertDescription className="text-foreground/80">
                  Save your changes before testing — tests use the saved configuration.
                </AlertDescription>
              </Alert>
            ) : null}
            {verify.error ? <ErrorAlert error={verify.error} title="Connection failed" /> : null}
          </>
        }
      >
        <SwitchField
          control={form.control}
          name="enabled"
          label="Send e-mails"
          description="When off, e-mails are queued but not sent."
        />
        <FieldSection title="Server">
          <FieldGrid columns={3}>
            <TextField
              control={form.control}
              name="host"
              label="Host"
              placeholder="smtp.example.com"
              autoComplete="off"
              className="sm:col-span-2 xl:col-span-1"
            />
            <NumberField control={form.control} name="port" label="Port" min={1} max={65535} />
            <SelectField
              control={form.control}
              name="encryption"
              label="Encryption"
              options={SMTP_ENCRYPTIONS.map((e) => ({
                value: e,
                label: ENCRYPTION_LABELS[e].label,
                description: ENCRYPTION_LABELS[e].description,
              }))}
            />
          </FieldGrid>
        </FieldSection>
        <FieldSection title="Authentication">
          <FieldGrid>
            <TextField
              control={form.control}
              name="username"
              label="Username"
              autoComplete="off"
              placeholder="Optional"
            />
            <SecretField
              label="Password"
              isSet={!!values.passwordSet}
              value={secrets.password}
              onChange={(v) => {
                setSecrets((s) => ({ ...s, password: v }));
                setSecretError((e) => ({ ...e, password: '' }));
              }}
              disabled={readOnly}
              description={
                needsPassword
                  ? 'Re-enter the password: it is required again when the host, port, encryption or username changes.'
                  : undefined
              }
              error={secretError.password || null}
            />
          </FieldGrid>
        </FieldSection>
        <FieldSection title="Sender">
          <FieldGrid>
            <TextField
              control={form.control}
              name="fromEmail"
              label="From e-mail"
              type="email"
              placeholder="no-reply@example.com"
            />
            <TextField control={form.control} name="fromName" label="From name" placeholder="AdPilot" />
          </FieldGrid>
        </FieldSection>
      </SettingsFormCard>
      {testOpen ? <SmtpTestDialog onClose={() => setTestOpen(false)} /> : null}
    </>
  );
}

const testSchema = z.object({ to: z.email('Enter a valid e-mail address') });

function SmtpTestDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [to, setTo] = useState(user.email);
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: (address: string) => adminSettingsApi.testSmtp(address),
    onSuccess: (_res, address) => {
      toast.success('Test e-mail sent', { description: `Check the inbox of ${address}.` });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <form
          noValidate
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = testSchema.safeParse({ to });
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Invalid address');
              return;
            }
            setError(null);
            send.mutate(parsed.data.to);
          }}
        >
          <DialogHeader>
            <DialogTitle>Send a test e-mail</DialogTitle>
            <DialogDescription>
              The message is sent synchronously, so any SMTP error is shown right here.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-3">
            {send.error ? <ErrorAlert error={send.error} title="Sending failed" /> : null}
            <div className="grid gap-2">
              <Label htmlFor="smtp-test-to">Recipient</Label>
              <Input
                id="smtp-test-to"
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-invalid={!!error}
                autoFocus
              />
              {error ? <p className="text-xs font-medium text-destructive-fg">{error}</p> : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={send.isPending}>
              Send test e-mail
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
