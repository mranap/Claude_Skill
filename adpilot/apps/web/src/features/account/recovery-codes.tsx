'use client';

import { Download, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { downloadTextFile } from '@/lib/utils/download';

/** One-time display of 2FA recovery codes with copy and download. */
export function RecoveryCodes({ codes, email }: { codes: string[]; email: string }) {
  const text = codes.join('\n');
  const download = () =>
    downloadTextFile(
      'adpilot-recovery-codes.txt',
      [
        'AdPilot two-factor recovery codes',
        `Account: ${email}`,
        `Generated: ${new Date().toISOString()}`,
        '',
        'Each code can be used once to sign in without your authenticator app.',
        '',
        ...codes,
        '',
      ].join('\n'),
    );

  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-[13px] leading-relaxed">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-fg" />
        <span>
          Save these codes now — <span className="font-medium">they will not be shown again</span>. Each code
          works once if you lose access to your authenticator app.
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border bg-muted/40 p-4 font-mono text-sm tracking-wide tabular-nums dark:bg-black/20">
        {codes.map((code) => (
          <li key={code} className="text-center">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton
          value={text}
          label="Copy codes"
          variant="outline"
          size="sm"
          successMessage="Recovery codes copied"
        />
        <Button variant="outline" size="sm" onClick={download}>
          <Download />
          Download .txt
        </Button>
      </div>
    </div>
  );
}
