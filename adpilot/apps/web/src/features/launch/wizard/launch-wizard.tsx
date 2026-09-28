'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CloudCheck, CloudOff, Copy, LoaderCircle, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch, type Path } from 'react-hook-form';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Stepper, type StepperStep } from '@/components/ui/stepper';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ErrorAlert } from '@/components/shared/error-alert';
import { PageHeader } from '@/components/shared/page-header';
import { ApiError, getErrorMessage, getErrorTitle, isApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { useNow } from '@/lib/hooks/use-now';
import { formatRelative } from '@/lib/utils/format';
import { useConnectedAdAccounts } from '../../ad-accounts/api';
import { AudienceSection, PlacementsSection } from '../../campaign-settings/audience-section';
import { BudgetSection, CampaignSection } from '../../campaign-settings/campaign-section';
import { SettingsUiProvider } from '../../campaign-settings/context';
import {
  ActivationSection,
  AttributionSection,
  ConversionSection,
  CreativeOptionsSection,
  DsaSection,
  IdentitySection,
  NamingSection,
  ScheduleSection,
} from '../../campaign-settings/delivery-sections';
import { flattenErrors } from '../../campaign-settings/paths';
import { VariantsEditor } from '../../campaign-settings/variants-editor';
import { draftsApi, launchesApi, useDraft } from '../api';
import type { LaunchDraftDto, ValidationIssue } from '../types';
import { AccountStep } from './account-step';
import { AdsEditor } from './ads-step';
import { LaunchStep } from './launch-step';
import { ReviewStep, type ReviewState } from './review-step';
import {
  LAUNCH_STEP,
  REVIEW_STEP,
  WIZARD_STEPS,
  draftStep,
  stepFields,
  stepOfPath,
  valuesFromDraft,
  wizardSchema,
  type WizardInput,
  type WizardOutput,
  type WizardValues,
} from './steps';
import { TemplateStep } from './template-step';

const memoryKeys = new Map<string, string>();

/** One idempotency key per draft and browser tab: retries and double clicks return the same launch. */
function idempotencyKey(draftId: string): string {
  const storageKey = `adpilot.launch.idempotency.${draftId}`;
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;
  } catch {
    // storage unavailable: fall back to memory
  }
  const key = memoryKeys.get(draftId) ?? crypto.randomUUID();
  memoryKeys.set(draftId, key);
  try {
    window.sessionStorage.setItem(storageKey, key);
  } catch {
    // ignore
  }
  return key;
}

export function LaunchWizardPage({ draftId }: { draftId: string }) {
  const draft = useDraft(draftId);
  if (draft.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }
  if (draft.isError || !draft.data) {
    return (
      <>
        <PageHeader title="Launch" breadcrumbs={[{ label: 'Launch', href: '/launch' }, { label: 'Draft not available' }]} />
        <ErrorAlert error={draft.error} onRetry={() => void draft.refetch()} />
      </>
    );
  }
  return <LaunchWizard draft={draft.data} />;
}

type SaveState = { state: 'idle' | 'saving' | 'saved' | 'error'; at?: number; error?: unknown };

function buildSaveBody(values: WizardValues, step: number) {
  return {
    name: values.name?.trim() || 'Untitled launch',
    templateId: values.templateId || null,
    profileId: values.profileId || null,
    adAccountId: values.adAccountId || null,
    config: { ...values, version: 1, wizard: { step } },
  };
}

function LaunchWizard({ draft }: { draft: LaunchDraftDto }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const readOnly = draft.status !== 'DRAFT';
  const [initial] = useState(() => valuesFromDraft(draft));
  const [initialStep] = useState(() => (readOnly ? REVIEW_STEP : draftStep(draft)));
  const form = useForm<WizardInput, unknown, WizardOutput>({ resolver: zodResolver(wizardSchema), defaultValues: initial as WizardInput, mode: 'onTouched' });
  const [step, setStep] = useState(initialStep);
  const [maxVisited, setMaxVisited] = useState(initialStep);
  const [review, setReview] = useState<ReviewState>({});
  const [running, setRunning] = useState<'validate' | 'dry-run' | null>(null);
  const [checkError, setCheckError] = useState<unknown>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [launched, setLaunched] = useState(false);
  const values = useWatch({ control: form.control }) as WizardValues;
  const accounts = useConnectedAdAccounts();
  const account = accounts.data?.find((a) => a.id === values.adAccountId);
  const configSnapshot = JSON.stringify(values);
  const stale = !!review.snapshot && review.snapshot !== configSnapshot;
  const now = useNow(15_000);

  // ── Autosave ──
  const [save, setSave] = useState<SaveState>({ state: 'idle' });
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify({ values: initial, step: initialStep }));
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const snapshot = JSON.stringify({ values, step });
  const persist = useEffectEvent((snap: string, body: ReturnType<typeof buildSaveBody>) => {
    saveChain.current = saveChain.current.then(async () => {
      setSave((s) => ({ ...s, state: 'saving' }));
      try {
        await draftsApi.update(draft.id, body);
        setSavedSnapshot(snap);
        setSave({ state: 'saved', at: Date.now() });
      } catch (error) {
        setSave({ state: 'error', error });
      }
    });
  });
  useEffect(() => {
    if (readOnly || launched || snapshot === savedSnapshot) return;
    const timer = window.setTimeout(() => persist(snapshot, buildSaveBody(JSON.parse(snapshot).values as WizardValues, JSON.parse(snapshot).step as number)), 1200);
    return () => window.clearTimeout(timer);
  }, [snapshot, savedSnapshot, readOnly, launched]);

  // ── Step errors (client + last server check) ──
  const clientErrors = flattenErrors(form.formState.errors).filter((e) => e.path);
  const serverIssues: ValidationIssue[] = !stale ? ((review.dryRun ?? review.validation)?.errors ?? []) : [];
  const errorSteps = new Set<number>([...clientErrors.map((e) => stepOfPath(e.path)), ...serverIssues.map((i) => stepOfPath(i.path))]);
  const variantLabels = (values.variants ?? []).map((v) => v?.label ?? '');

  const goTo = (target: number) => {
    const next = Math.max(0, Math.min(LAUNCH_STEP, target));
    setStep(next);
    setMaxVisited((m) => Math.max(m, next));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (next === REVIEW_STEP && (!review.dryRun || stale) && !running && !readOnly) void runCheck('dry-run');
  };

  const next = async () => {
    const fields = stepFields(step, values.variants ?? []) as Path<WizardInput>[];
    let ok = fields.length ? await form.trigger(fields, { shouldFocus: true }) : true;
    if (step === 4 && !(values.variants ?? []).length) {
      form.setError('variants', { type: 'manual', message: 'Add at least one language/geo group' });
      ok = false;
    }
    if (!ok) {
      toast.error('Some fields need your attention', { description: 'The problems are highlighted on this step.' });
      return;
    }
    goTo(step + 1);
  };

  const applyIssues = (issues: ValidationIssue[]) => {
    for (const issue of issues) {
      if (!issue.path || issue.path === 'variants') continue;
      form.setError(issue.path as Path<WizardInput>, { type: 'server', message: issue.message });
    }
  };

  const runCheck = async (kind: 'validate' | 'dry-run') => {
    setRunning(kind);
    setCheckError(null);
    const config = form.getValues();
    const snap = JSON.stringify(values);
    try {
      if (kind === 'validate') {
        const validation = await launchesApi.validate(config, readOnly ? undefined : draft.id);
        setReview({ validation, snapshot: snap });
        applyIssues(validation.errors);
      } else {
        const dryRun = await launchesApi.dryRun(config);
        setReview({ dryRun, snapshot: snap });
        applyIssues(dryRun.errors);
      }
    } catch (error) {
      setCheckError(error);
    } finally {
      setRunning(null);
    }
  };

  const launch = useMutation({
    mutationFn: async () => {
      setLaunched(true);
      await saveChain.current;
      return launchesApi.launch({ idempotencyKey: idempotencyKey(draft.id), draftId: draft.id, config: form.getValues() });
    },
    onSuccess: async ({ job, duplicate }) => {
      toast.success(duplicate ? 'This launch was already started' : 'Launch started', { description: `${job.name} · ${job.code}` });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.drafts.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.launches.all }),
      ]);
      router.push(`/launches/${job.id}`);
    },
    onError: (error) => {
      setLaunched(false);
      const details = error instanceof ApiError && error.details && typeof error.details === 'object' && !Array.isArray(error.details) ? (error.details as { errors?: ValidationIssue[]; warnings?: ValidationIssue[] }) : null;
      if (isApiError(error, 'VALIDATION_ERROR') && details?.errors) {
        setReview({ validation: { ok: false, errors: details.errors, warnings: details.warnings ?? [] }, snapshot: configSnapshot });
        applyIssues(details.errors);
        goTo(REVIEW_STEP);
        toast.error('The launch configuration has errors', { description: 'Fix the listed problems and launch again.' });
      }
    },
  });

  const clone = useMutation({
    mutationFn: () => draftsApi.clone(draft.id),
    onSuccess: async (copy) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.drafts.all });
      router.push(`/launch/${copy.id}`);
    },
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });

  const stepperSteps: StepperStep[] = WIZARD_STEPS.map((s, i) => ({
    id: s.id,
    title: s.title,
    description: i === step ? undefined : errorSteps.has(i) && i <= maxVisited ? 'Needs attention' : undefined,
    state: i === step ? 'current' : errorSteps.has(i) && i <= maxVisited ? 'error' : i < step || i <= maxVisited ? 'complete' : 'upcoming',
  }));

  const ui = {
    mode: 'launch' as const,
    advanced: true,
    currency: account?.currency,
    minDailyBudget: account?.minDailyBudget,
    assetsAccountId: values.adAccountId || null,
    disabled: readOnly,
  };
  const result = review.dryRun ?? review.validation;

  return (
    <FormProvider {...form}>
      <form noValidate onSubmit={(e) => e.preventDefault()} className="grid gap-4">
        <PageHeader
          className="mb-2"
          breadcrumbs={[{ label: 'Launch', href: '/launch' }, { label: values.name || 'Untitled launch' }]}
          title={values.name || 'New launch'}
          description={WIZARD_STEPS[step]!.description}
          actions={
            <>
              {!readOnly ? <SaveIndicator save={save} dirty={snapshot !== savedSnapshot} now={now} /> : null}
              {!readOnly ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setDiscardOpen(true)}>
                  <Trash2 />
                  Discard draft
                </Button>
              ) : null}
            </>
          }
        />
        {readOnly ? (
          <Alert variant="info">
            <AlertTitle>{draft.status === 'LAUNCHED' ? 'This draft was launched' : 'This draft is archived'}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              It can no longer be changed. Clone it to launch the same configuration again.
              <Button type="button" size="xs" variant="outline" onClick={() => clone.mutate()} loading={clone.isPending}>
                <Copy />
                Clone draft
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <Card>
          <CardContent className="py-4">
            <Stepper steps={stepperSteps} current={step} onStepClick={(index) => goTo(index)} />
          </CardContent>
        </Card>

        <SettingsUiProvider value={ui}>
          {step === 0 ? <AccountStep disabled={readOnly} /> : null}
          {step === 1 ? <TemplateStep disabled={readOnly} /> : null}
          {step === 2 ? (
            <>
              <CampaignSection />
              <BudgetSection />
            </>
          ) : null}
          {step === 3 ? (
            <>
              <AudienceSection />
              <PlacementsSection />
              <IdentitySection />
              <ConversionSection />
              <ScheduleSection timezone={account?.timezoneName} />
              <AttributionSection />
            </>
          ) : null}
          {step === 4 ? <VariantsEditor /> : null}
          {step === 5 ? (
            <>
              <CreativeOptionsSection />
              <AdsEditor disabled={readOnly} />
            </>
          ) : null}
          {step === 6 ? (
            <>
              <NamingSection sampleName={values.name} />
              <DsaSection defaults={account ? { beneficiary: account.defaultDsaBeneficiary, payor: account.defaultDsaPayor } : undefined} />
              <ActivationSection />
            </>
          ) : null}
          {step === REVIEW_STEP ? (
            <ReviewStep review={review} stale={stale} running={running} error={checkError} variantLabels={variantLabels} onRun={(k) => void runCheck(k)} onGoTo={goTo} />
          ) : null}
          {step === LAUNCH_STEP ? (
            readOnly ? (
              <Alert>
                <AlertDescription>This draft cannot be launched again. Clone it to start a new launch.</AlertDescription>
              </Alert>
            ) : (
              <LaunchStep
                account={account}
                summary={review.dryRun?.summary}
                checked={!!result?.ok}
                stale={stale}
                blocked={!!result && !result.ok && !stale}
                launching={launch.isPending}
                error={launch.isError && !isApiError(launch.error, 'VALIDATION_ERROR') ? launch.error : null}
                onLaunch={() => launch.mutate()}
                onReview={() => goTo(REVIEW_STEP)}
              />
            )
          ) : null}
        </SettingsUiProvider>

        {step < LAUNCH_STEP ? (
          <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-2 border-t bg-background/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
            <Button type="button" variant="outline" onClick={() => goTo(step - 1)} disabled={step === 0}>
              <ArrowLeft />
              Back
            </Button>
            <p className="mx-auto hidden text-xs text-muted-foreground sm:block">
              Step {step + 1} of {WIZARD_STEPS.length} · {WIZARD_STEPS[step]!.title}
            </p>
            {step === REVIEW_STEP ? (
              <Button type="button" className="ml-auto sm:ml-0" onClick={() => goTo(LAUNCH_STEP)} disabled={readOnly}>
                Continue to launch
                <ArrowRight />
              </Button>
            ) : (
              <Button type="button" className="ml-auto sm:ml-0" onClick={() => (readOnly ? goTo(step + 1) : void next())}>
                Next
                <ArrowRight />
              </Button>
            )}
          </div>
        ) : null}
      </form>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        destructive
        title="Discard this draft?"
        description="The draft is archived and disappears from your drafts. Nothing was created at Meta."
        confirmLabel="Discard draft"
        onConfirm={async () => {
          setLaunched(true);
          await draftsApi.archive(draft.id);
          await queryClient.invalidateQueries({ queryKey: queryKeys.drafts.all });
          toast.success('Draft discarded');
          router.push('/launch');
        }}
      />
    </FormProvider>
  );
}

function SaveIndicator({ save, dirty, now }: { save: SaveState; dirty: boolean; now: number }) {
  if (save.state === 'error') {
    return (
      <SimpleTooltip content={getErrorMessage(save.error)}>
        <span className="flex items-center gap-1.5 text-xs text-destructive-fg" role="status">
          <CloudOff className="size-4" aria-hidden />
          Not saved
        </span>
      </SimpleTooltip>
    );
  }
  if (save.state === 'saving' || dirty) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        Saving…
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" data-testid="draft-saved">
      <CloudCheck className="size-4" aria-hidden />
      {save.at ? `Draft saved ${formatRelative(save.at, now)}` : 'Draft saved'}
    </span>
  );
}
