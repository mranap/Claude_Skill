'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  PROXY_TYPES,
  accessTokenSchema,
  metaAppIdSchema,
  metaProfileCreateSchema,
  proxyInputSchema,
  type ProxyInput,
  type ProxyType,
  type metaConnectionTestSchema,
  type metaProfileUpdateSchema,
} from '@adpilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, FlaskConical, Globe, KeyRound, PlugZap } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ErrorAlert } from '@/components/shared/error-alert';
import { Form, FormField, FormRootError, TextField } from '@/components/shared/form';
import { getErrorMessage, isApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { cn } from '@/lib/utils/cn';
import { metaProfilesApi } from './api';
import { ProxyTestResultView, TokenInspectionResult } from './inspection';
import type { ConnectionTestResponse, MetaProfileDto, ProfileSaveResponse } from './types';

type SecretMode = 'keep' | 'replace' | 'clear';

const baseSchema = z.object({
  name: metaProfileCreateSchema.shape.name,
  accessToken: z.string(),
  notes: z.string().trim().max(2000),
  useProxy: z.boolean(),
  proxy: z.object({
    type: z.enum(PROXY_TYPES),
    host: z.string(),
    port: z.string(),
    username: z.string(),
    password: z.string(),
    removePassword: z.boolean(),
  }),
  appId: z.string(),
  appSecret: z.string(),
  removeAppSecret: z.boolean(),
});
type FormValues = z.infer<typeof baseSchema>;

/** Field rules come from the shared schemas; the form keeps flat, always-defined values. */
function makeSchema(mode: 'create' | 'edit', hasStoredPassword: boolean) {
  return baseSchema.superRefine((v, ctx) => {
    const token = v.accessToken.trim();
    if (mode === 'create' || token) {
      const r = accessTokenSchema.safeParse(token);
      if (!r.success)
        ctx.addIssue({
          code: 'custom',
          path: ['accessToken'],
          message: token ? (r.error.issues[0]?.message ?? 'Invalid token') : 'Paste the access token',
        });
    }
    if (v.useProxy) {
      const r = proxyInputSchema.safeParse(toProxyInput(v, mode, hasStoredPassword));
      if (!r.success) {
        for (const issue of r.error.issues)
          ctx.addIssue({
            code: 'custom',
            path: ['proxy', ...issue.path.map(String)],
            message: issue.message,
          });
      }
    }
    if (v.appId.trim()) {
      const r = metaAppIdSchema.safeParse(v.appId);
      if (!r.success)
        ctx.addIssue({
          code: 'custom',
          path: ['appId'],
          message: r.error.issues[0]?.message ?? 'Invalid App ID',
        });
    }
    if (v.appSecret.trim() && !/^[a-f0-9]{32}$/i.test(v.appSecret.trim())) {
      ctx.addIssue({
        code: 'custom',
        path: ['appSecret'],
        message: 'App secret is a 32 character hex string',
      });
    }
  });
}

function passwordMode(v: FormValues, mode: 'create' | 'edit', hasStoredPassword: boolean): SecretMode {
  if (v.proxy.password) return 'replace';
  if (mode === 'edit' && hasStoredPassword && !v.proxy.removePassword) return 'keep';
  return 'clear';
}

function toProxyInput(v: FormValues, mode: 'create' | 'edit', hasStoredPassword: boolean): ProxyInput {
  const pm = passwordMode(v, mode, hasStoredPassword);
  return {
    type: v.proxy.type,
    host: v.proxy.host.trim(),
    port: Number(v.proxy.port),
    username: v.proxy.username.trim() || null,
    // undefined keeps the stored password (edit), null removes it
    password: pm === 'replace' ? v.proxy.password : pm === 'keep' ? undefined : null,
  };
}

function defaults(profile?: MetaProfileDto): FormValues {
  return {
    name: profile?.name ?? '',
    accessToken: '',
    notes: profile?.notes ?? '',
    useProxy: !!profile?.proxy,
    proxy: {
      type: profile?.proxy?.type ?? 'HTTP',
      host: profile?.proxy?.host ?? '',
      port: profile?.proxy ? String(profile.proxy.port) : '',
      username: profile?.proxy?.username ?? '',
      password: '',
      removePassword: false,
    },
    appId: profile?.appId ?? '',
    appSecret: '',
    removeAppSecret: false,
  };
}

interface TestState {
  kind: 'token' | 'proxy' | 'connection';
  result: ConnectionTestResponse;
  signature: string;
}

export function ProfileDialog({
  open,
  onOpenChange,
  profile,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit mode when set. */
  profile?: MetaProfileDto;
  onSaved?: (response: ProfileSaveResponse) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {open ? <ProfileForm profile={profile} onDone={() => onOpenChange(false)} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ProfileForm({
  profile,
  onDone,
  onSaved,
}: {
  profile?: MetaProfileDto;
  onDone: () => void;
  onSaved?: (response: ProfileSaveResponse) => void;
}) {
  const mode = profile ? 'edit' : 'create';
  const hasStoredPassword = !!profile?.proxy?.hasPassword;
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(makeSchema(mode, hasStoredPassword)),
    defaultValues: defaults(profile),
    mode: 'onTouched',
  });
  const values = useWatch({ control: form.control }) as FormValues;
  const [test, setTest] = useState<TestState | null>(null);
  const [appOpen, setAppOpen] = useState(!!profile?.appId);

  const signature = JSON.stringify({
    t: values.accessToken,
    p: values.useProxy ? values.proxy : null,
    a: values.appId,
    s: values.appSecret,
  });
  const proxyChanged =
    mode === 'create' ||
    values.useProxy !== !!profile?.proxy ||
    (values.useProxy &&
      (values.proxy.type !== profile?.proxy?.type ||
        values.proxy.host.trim() !== profile?.proxy?.host ||
        values.proxy.port !== String(profile?.proxy?.port) ||
        values.proxy.username.trim() !== (profile?.proxy?.username ?? '') ||
        !!values.proxy.password ||
        values.proxy.removePassword));

  const testMutation = useMutation({
    mutationFn: async (kind: TestState['kind']): Promise<ConnectionTestResponse> => {
      const token = values.accessToken.trim();
      const withApp = {
        appId: values.appId.trim() || undefined,
        appSecret: values.appSecret.trim() || undefined,
      };
      // Saved profile without a new token: validate the stored token / proxy on the server.
      if (mode === 'edit' && profile && kind !== 'proxy' && !token) {
        return { token: await metaProfilesApi.validate(profile.id) };
      }
      if (mode === 'edit' && profile && kind === 'proxy' && !proxyChanged) {
        return { proxy: await metaProfilesApi.testProxy(profile.id) };
      }
      const body: z.input<typeof metaConnectionTestSchema> = {};
      if (kind !== 'proxy') Object.assign(body, { accessToken: token }, withApp);
      if (kind !== 'token' && values.useProxy) body.proxy = toProxyInput(values, mode, hasStoredPassword);
      return metaProfilesApi.test(body);
    },
    onSuccess: (result, kind) => setTest({ kind, result, signature }),
    // A rejected proxy (e.g. a private address while the admin setting forbids it) belongs to the proxy fields.
    onError: (error) => {
      if (isApiError(error, 'PROXY_ERROR') && values.useProxy)
        form.setError('proxy.host', { type: 'server', message: getErrorMessage(error) });
    },
  });

  const runTest = async (kind: TestState['kind']) => {
    const fields: (keyof FormValues | `proxy.${string}`)[] = [];
    if (kind !== 'proxy' && (mode === 'create' || values.accessToken.trim()))
      fields.push('accessToken', 'appId', 'appSecret');
    if (kind !== 'token') fields.push('proxy.host', 'proxy.port', 'proxy.username', 'proxy.password');
    const ok = fields.length ? await form.trigger(fields as Parameters<typeof form.trigger>[0]) : true;
    if (!ok) return;
    testMutation.mutate(kind);
  };

  const save = async (v: FormValues) => {
    try {
      await persist(v);
    } catch (error) {
      if (isApiError(error, 'PROXY_ERROR') && v.useProxy) {
        form.setError(
          'proxy.host',
          { type: 'server', message: getErrorMessage(error) },
          { shouldFocus: true },
        );
        return;
      }
      throw error;
    }
  };

  const persist = async (v: FormValues) => {
    let response: ProfileSaveResponse;
    if (mode === 'create') {
      const body = metaProfileCreateSchema.parse({
        name: v.name,
        accessToken: v.accessToken.trim(),
        notes: v.notes.trim() || null,
        proxy: v.useProxy ? toProxyInput(v, mode, hasStoredPassword) : null,
        appId: v.appId.trim() || null,
        appSecret: v.appSecret.trim() || null,
      });
      response = await metaProfilesApi.create(body);
    } else {
      const body: z.input<typeof metaProfileUpdateSchema> = {};
      if (v.name.trim() !== profile!.name) body.name = v.name.trim();
      if (v.notes.trim() !== (profile!.notes ?? '')) body.notes = v.notes.trim() || null;
      if (v.accessToken.trim()) body.accessToken = v.accessToken.trim();
      if (!v.useProxy && profile!.proxy) body.proxy = null;
      else if (v.useProxy && proxyChanged) body.proxy = toProxyInput(v, mode, hasStoredPassword);
      if (v.appId.trim() !== (profile!.appId ?? '')) body.appId = v.appId.trim() || null;
      if (v.appSecret.trim()) body.appSecret = v.appSecret.trim();
      else if (v.removeAppSecret && profile!.hasAppSecret) body.appSecret = null;
      if (!Object.keys(body).length) {
        onDone();
        return;
      }
      response = await metaProfilesApi.update(profile!.id, body);
    }
    queryClient.setQueryData(queryKeys.metaProfiles.detail(response.profile.id), response.profile);
    await queryClient.invalidateQueries({ queryKey: queryKeys.metaProfiles.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.adAccounts.all });
    const inspection = response.inspection;
    if (inspection && !inspection.valid)
      toast.warning('Profile saved, but the token check failed', { description: inspection.message });
    else if (inspection?.missingRequired.length)
      toast.warning('Profile saved with missing permissions', {
        description: inspection.missingRequired.join(', '),
      });
    else
      toast.success(mode === 'create' ? 'Meta profile added' : 'Profile updated', {
        description: inspection?.valid ? 'Discovering Business Managers, ad accounts and pages…' : undefined,
      });
    onSaved?.(response);
    onDone();
  };

  const stale = test && test.signature !== signature;
  const tokenLabel = mode === 'edit' && !values.accessToken.trim() ? 'Validate saved token' : 'Test token';
  const pending = testMutation.isPending ? testMutation.variables : null;

  return (
    <Form form={form} onSubmit={save} className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle>{mode === 'create' ? 'Add Meta profile' : `Edit “${profile!.name}”`}</DialogTitle>
        <DialogDescription>
          The token is encrypted at rest and never shown again — only a masked version is kept. Test the
          connection before saving.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="grid gap-5">
        <FormRootError />
        <TextField
          control={form.control}
          name="name"
          label="Profile name"
          placeholder="e.g. Agency main token"
          required
          autoComplete="off"
        />
        <FormField
          control={form.control}
          name="accessToken"
          label={mode === 'create' ? 'Access token' : 'Replace access token'}
          required={mode === 'create'}
          description={
            mode === 'edit'
              ? `Current token ${profile!.tokenMask}. Leave empty to keep it.`
              : 'A user or system-user token with ads_management and ads_read (business_management and pages_show_list recommended).'
          }
          render={({ field, controlProps }) => (
            <PasswordInput
              {...controlProps}
              name={field.name}
              ref={field.ref}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              placeholder={mode === 'create' ? 'EAAB…' : 'Paste a new token to replace the current one'}
              autoComplete="off"
              className="font-mono text-[13px]"
            />
          )}
        />
        <FormField
          control={form.control}
          name="notes"
          label="Notes"
          render={({ field, controlProps }) => (
            <Textarea
              {...controlProps}
              {...field}
              rows={2}
              placeholder="Optional — who owns the token, which clients it covers…"
            />
          )}
        />

        <Separator />
        <div className="grid gap-4">
          <FormField
            control={form.control}
            name="useProxy"
            orientation="horizontal"
            label="Connect through a proxy"
            description="All Meta API calls of this profile use the proxy (HTTP, HTTPS or SOCKS5). Leave off for a direct connection."
            render={({ field, controlProps }) => (
              <Switch {...controlProps} checked={field.value} onCheckedChange={field.onChange} />
            )}
          />
          {values.useProxy ? (
            <div className="grid gap-4 rounded-lg border bg-surface-subtle p-4">
              <FormField
                control={form.control}
                name="proxy.type"
                label="Type"
                render={({ field }) => (
                  <SegmentedControl<ProxyType>
                    aria-label="Proxy type"
                    value={field.value}
                    onValueChange={field.onChange}
                    options={PROXY_TYPES.map((t) => ({ value: t, label: t }))}
                    className="w-fit"
                  />
                )}
              />
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
                <TextField
                  control={form.control}
                  name="proxy.host"
                  label="Host"
                  placeholder="proxy.example.com or 10.0.0.5"
                  autoComplete="off"
                  required
                />
                <TextField
                  control={form.control}
                  name="proxy.port"
                  label="Port"
                  placeholder="8080"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  control={form.control}
                  name="proxy.username"
                  label="Username"
                  placeholder="Optional"
                  autoComplete="off"
                />
                <FormField
                  control={form.control}
                  name="proxy.password"
                  label="Password"
                  description={
                    hasStoredPassword && !values.proxy.password
                      ? values.proxy.removePassword
                        ? 'The saved password will be removed.'
                        : 'A password is saved. Type to replace it.'
                      : undefined
                  }
                  render={({ field, controlProps }) => (
                    <PasswordInput
                      {...controlProps}
                      name={field.name}
                      ref={field.ref}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      placeholder={hasStoredPassword ? '•••••••• (saved)' : 'Optional'}
                      autoComplete="new-password"
                    />
                  )}
                />
              </div>
              {hasStoredPassword ? (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={values.proxy.removePassword}
                    onCheckedChange={(v) =>
                      form.setValue('proxy.removePassword', v === true, { shouldDirty: true })
                    }
                    disabled={!!values.proxy.password}
                  />
                  Remove the saved proxy password
                </label>
              ) : null}
            </div>
          ) : null}
        </div>

        <Collapsible open={appOpen} onOpenChange={setAppOpen}>
          <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md py-1 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <span>
              App credentials <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid gap-4 pt-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                The App ID and secret of the app that issued the token enable{' '}
                <span className="font-mono">appsecret_proof</span> and exact expiry information.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  control={form.control}
                  name="appId"
                  label="App ID"
                  placeholder="1234567890"
                  inputMode="numeric"
                  autoComplete="off"
                />
                <FormField
                  control={form.control}
                  name="appSecret"
                  label="App secret"
                  description={
                    profile?.hasAppSecret && !values.appSecret
                      ? values.removeAppSecret
                        ? 'The saved secret will be removed.'
                        : 'A secret is saved. Type to replace it.'
                      : undefined
                  }
                  render={({ field, controlProps }) => (
                    <PasswordInput
                      {...controlProps}
                      name={field.name}
                      ref={field.ref}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      placeholder={profile?.hasAppSecret ? '•••••••• (saved)' : '32 hex characters'}
                      autoComplete="off"
                      className="font-mono text-[13px]"
                    />
                  )}
                />
              </div>
              {profile?.hasAppSecret ? (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={values.removeAppSecret}
                    onCheckedChange={(v) =>
                      form.setValue('removeAppSecret', v === true, { shouldDirty: true })
                    }
                    disabled={!!values.appSecret}
                  />
                  Remove the saved app secret
                </label>
              ) : null}
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Label className="mr-auto">Connection check</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => runTest('token')}
              loading={pending === 'token'}
              disabled={testMutation.isPending}
            >
              <KeyRound />
              {tokenLabel}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => runTest('proxy')}
              loading={pending === 'proxy'}
              disabled={testMutation.isPending || !values.useProxy}
            >
              <Globe />
              Test proxy
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => runTest('connection')}
              loading={pending === 'connection'}
              disabled={testMutation.isPending}
            >
              <PlugZap />
              Test connection
            </Button>
          </div>
          {testMutation.isError && !(isApiError(testMutation.error, 'PROXY_ERROR') && values.useProxy) ? (
            <ErrorAlert error={testMutation.error} title="The test could not run" />
          ) : null}
          {test ? (
            <div className={cn('grid gap-3', stale && 'opacity-60')} aria-live="polite">
              {stale ? (
                <Alert icon={<FlaskConical />}>
                  <AlertDescription>
                    The settings changed since this test. Run it again to check the new values.
                  </AlertDescription>
                </Alert>
              ) : null}
              {test.result.proxy ? <ProxyTestResultView result={test.result.proxy} /> : null}
              {test.result.token ? <TokenInspectionResult inspection={test.result.token} /> : null}
              {test.kind !== 'token' && test.result.proxy && !test.result.proxy.ok && !test.result.token ? (
                <p className="text-xs text-muted-foreground">
                  The token was not tested because the proxy is not reachable.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nothing is saved while testing. The token is only held in memory for the check.
            </p>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {mode === 'create' ? 'Add profile' : 'Save changes'}
        </Button>
      </DialogFooter>
    </Form>
  );
}
