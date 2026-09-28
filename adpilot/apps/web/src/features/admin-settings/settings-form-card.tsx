'use client';

import { PERMISSION_DESCRIPTIONS, type PermissionKey } from '@adpilot/shared';
import { Lock } from 'lucide-react';
import type * as React from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormRootError } from '@/components/shared/form';

/**
 * One settings group = one form with its own Save button and dirty tracking. Read-only when the admin
 * lacks the group's manage permission (fields are disabled through a <fieldset>).
 */
export function SettingsFormCard<TIn extends FieldValues, TOut>({
  title,
  description,
  form,
  onSubmit,
  readOnly,
  permission,
  extraDirty = false,
  onDiscard,
  footerActions,
  children,
  before,
}: {
  title: string;
  description: React.ReactNode;
  form: UseFormReturn<TIn, unknown, TOut>;
  /** Persists the values; resolves when saved (resolve `false` when the save was cancelled). */
  onSubmit: (values: TOut) => Promise<unknown>;
  readOnly: boolean;
  permission: PermissionKey;
  /** Unsaved changes outside react-hook-form (write-only secrets). */
  extraDirty?: boolean;
  onDiscard?: () => void;
  /** Buttons shown on the left of the footer (connection tests). */
  footerActions?: React.ReactNode;
  children: React.ReactNode;
  /** Content above the fields (explanations, environment info). */
  before?: React.ReactNode;
}) {
  const dirty = form.formState.isDirty || extraDirty;

  const submit = async (values: TOut) => {
    const result = await onSubmit(values);
    if (result !== false) toast.success(`${title} settings saved`);
  };

  return (
    <Card>
      <Form form={form} onSubmit={submit}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {readOnly ? (
            <Alert icon={<Lock />}>
              <AlertDescription>
                You can view these settings. Changing them requires the “{PERMISSION_DESCRIPTIONS[permission]?.description ?? permission}”
                permission.
              </AlertDescription>
            </Alert>
          ) : null}
          {before}
          <FormRootError />
          <fieldset disabled={readOnly} className="grid min-w-0 gap-6">
            {children}
          </fieldset>
        </CardContent>
        <CardFooter className="flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">{footerActions}</div>
          {!readOnly ? (
            <div className="flex items-center justify-end gap-2">
              {dirty ? <span className="mr-1 hidden text-xs text-muted-foreground sm:inline">Unsaved changes</span> : null}
              <Button
                type="button"
                variant="ghost"
                disabled={!dirty || form.formState.isSubmitting}
                onClick={() => {
                  form.reset();
                  onDiscard?.();
                }}
              >
                Discard
              </Button>
              <Button type="submit" disabled={!dirty} loading={form.formState.isSubmitting}>
                Save changes
              </Button>
            </div>
          ) : null}
        </CardFooter>
      </Form>
    </Card>
  );
}

/** Two-column responsive grid for settings fields. */
export function FieldGrid({ children, columns = 2 }: { children: React.ReactNode; columns?: 2 | 3 }) {
  return <div className={columns === 3 ? 'grid gap-5 sm:grid-cols-2 xl:grid-cols-3' : 'grid gap-5 sm:grid-cols-2'}>{children}</div>;
}

export function FieldSection({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-4">
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        {description ? <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
