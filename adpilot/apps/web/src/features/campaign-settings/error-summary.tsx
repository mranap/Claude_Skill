'use client';

import { CircleAlert } from 'lucide-react';
import { useFormState, type FieldValues } from 'react-hook-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { describePath, flattenErrors } from './paths';

/** Lists every invalid field of the surrounding form (fields can live in collapsed sections or other steps). */
export function FormErrorSummary<T extends FieldValues>({ variantLabels, className, title = 'Some fields need your attention' }: { variantLabels?: string[]; className?: string; title?: string }) {
  const { errors, submitCount } = useFormState<T>();
  const list = flattenErrors(errors).filter((e) => e.path && e.path !== 'root');
  if (!submitCount || !list.length) return null;
  return (
    <Alert variant="destructive" icon={<CircleAlert />} className={className}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 grid gap-1">
          {list.slice(0, 12).map((e) => (
            <li key={`${e.path}:${e.message}`}>
              <span className="font-medium text-foreground">{describePath(e.path, variantLabels)}:</span> {e.message}
            </li>
          ))}
          {list.length > 12 ? <li>…and {list.length - 12} more</li> : null}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
