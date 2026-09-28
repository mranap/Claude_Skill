'use client';

import { Rocket } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorAlert } from '@/components/shared/error-alert';
import { PageHeader } from '@/components/shared/page-header';
import { draftsApi } from './api';
import type { LaunchDraftDto } from './types';

let visits = 0;
const pending = new Map<number, Promise<LaunchDraftDto>>();

/** Creates a draft (blank or from `?template=`) and opens the wizard for it. */
export function NewLaunchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const template = searchParams.get('template');
  const [visit, setVisit] = useState(() => ++visits);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let promise = pending.get(visit);
    if (!promise) {
      promise = template ? draftsApi.fromTemplate(template) : draftsApi.create({ name: 'Untitled launch', config: { version: 1 } });
      pending.set(visit, promise);
    }
    let active = true;
    promise.then(
      (draft) => {
        pending.delete(visit);
        if (active) router.replace(`/launch/${draft.id}`);
      },
      (e: unknown) => {
        pending.delete(visit);
        if (active) setError(e);
      },
    );
    return () => {
      active = false;
    };
  }, [visit, template, router]);

  return (
    <>
      <PageHeader title="New launch" breadcrumbs={[{ label: 'Launch', href: '/launch' }, { label: 'New launch' }]} />
      {error ? (
        <div className="grid gap-4">
          <ErrorAlert error={error} title="The draft could not be created" />
          <Button
            className="w-fit"
            onClick={() => {
              setError(null);
              setVisit(++visits);
            }}
          >
            Try again
          </Button>
        </div>
      ) : (
        <EmptyState icon={Rocket} title={template ? 'Preparing the launch from your template…' : 'Preparing a new launch…'} description="A draft is created so your progress is saved as you go.">
          <Spinner className="mt-4" />
        </EmptyState>
      )}
    </>
  );
}
