'use client';

import {
  META_OPTIONAL_PERMISSIONS,
  META_RECOMMENDED_PERMISSIONS,
  META_REQUIRED_PERMISSIONS,
  type ProxyTestResult,
  type TokenInspection,
} from '@adpilot/shared';
import { CircleCheck, CircleX, Globe, KeyRound } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { KeyValueList } from '@/components/shared/key-value';
import { formatDateTime, formatDurationMs, formatRelative } from '@/lib/utils/format';
import { humanize } from '@/lib/utils/strings';

const REQUIRED = new Set<string>(META_REQUIRED_PERMISSIONS);
const RECOMMENDED = new Set<string>(META_RECOMMENDED_PERMISSIONS);
const OPTIONAL = new Set<string>(META_OPTIONAL_PERMISSIONS);

export function expiryText(expiresAt: string | null | undefined, valid = true): string {
  if (!expiresAt) return valid ? 'Never expires' : '—';
  const date = new Date(expiresAt);
  const past = date.getTime() < Date.now();
  return `${formatDateTime(expiresAt)} (${past ? 'expired ' : ''}${formatRelative(expiresAt)})`;
}

/** Scopes as badges; required/recommended scopes are highlighted, missing ones listed explicitly. */
export function ScopeList({ scopes, missingRequired = [], missingRecommended = [] }: { scopes: string[]; missingRequired?: string[]; missingRecommended?: string[] }) {
  const ordered = [...scopes].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return (
    <div className="flex flex-wrap gap-1.5">
      {ordered.map((scope) => (
        <Badge key={scope} variant={REQUIRED.has(scope) ? 'success' : RECOMMENDED.has(scope) || OPTIONAL.has(scope) ? 'info' : 'muted'} size="sm">
          {scope}
        </Badge>
      ))}
      {missingRequired.map((scope) => (
        <Badge key={`missing-${scope}`} variant="danger" size="sm" className="line-through decoration-1">
          {scope}
        </Badge>
      ))}
      {missingRecommended.map((scope) => (
        <Badge key={`rec-${scope}`} variant="warning" size="sm" className="line-through decoration-1">
          {scope}
        </Badge>
      ))}
      {!ordered.length && !missingRequired.length ? <span className="text-sm text-muted-foreground">No permissions reported</span> : null}
    </div>
  );
}

function rank(scope: string): number {
  if (REQUIRED.has(scope)) return 0;
  if (RECOMMENDED.has(scope)) return 1;
  if (OPTIONAL.has(scope)) return 2;
  return 3;
}

/** Result of a token check (POST /meta-profiles/test or /:id/validate). */
export function TokenInspectionResult({ inspection }: { inspection: TokenInspection }) {
  const ok = inspection.valid && !inspection.missingRequired.length;
  const title = ok ? 'Token is valid' : inspection.valid ? 'Token works, but permissions are missing' : `Token check failed: ${humanize(inspection.status)}`;
  const normalise = (text: string) => text.toLowerCase().replace(/[.\s]+$/, '');
  const showMessage = !!inspection.message && normalise(inspection.message) !== normalise(title);
  return (
    <div className="grid gap-3" data-testid="token-inspection">
      <Alert variant={ok ? 'success' : inspection.valid ? 'warning' : 'destructive'} icon={ok ? <CircleCheck /> : <CircleX />}>
        <AlertTitle>{title}</AlertTitle>
        {showMessage ? <AlertDescription>{inspection.message}</AlertDescription> : null}
      </Alert>
      {inspection.missingRequired.length ? (
        <Alert variant="destructive" icon={<KeyRound />}>
          <AlertTitle>Missing required permissions</AlertTitle>
          <AlertDescription>
            {inspection.missingRequired.join(', ')} — without them campaigns cannot be created or read. Generate a new token that includes
            these permissions.
          </AlertDescription>
        </Alert>
      ) : null}
      {inspection.missingRecommended.length ? (
        <Alert variant="warning" icon={<KeyRound />}>
          <AlertTitle>Recommended permissions missing</AlertTitle>
          <AlertDescription>
            {inspection.missingRecommended.join(', ')} — Business Managers or Pages may not be discovered without them.
          </AlertDescription>
        </Alert>
      ) : null}
      <KeyValueList
        items={[
          { label: 'Meta user', value: inspection.metaUserName ? `${inspection.metaUserName}${inspection.metaUserId ? ` (${inspection.metaUserId})` : ''}` : null },
          { label: 'Token type', value: inspection.tokenType ? humanize(inspection.tokenType) : null },
          { label: 'App', value: inspection.appName ? `${inspection.appName}${inspection.appId ? ` (${inspection.appId})` : ''}` : inspection.appId },
          { label: 'Expires', value: inspection.valid || inspection.expiresAt ? expiryText(inspection.expiresAt, inspection.valid) : null },
          { label: 'Data access expires', value: inspection.dataAccessExpiresAt ? expiryText(inspection.dataAccessExpiresAt) : null, hidden: !inspection.dataAccessExpiresAt },
          { label: 'Response time', value: inspection.latencyMs !== undefined ? formatDurationMs(inspection.latencyMs) : null, hidden: inspection.latencyMs === undefined },
          {
            label: 'Permissions',
            value: <ScopeList scopes={inspection.scopes} missingRequired={inspection.missingRequired} missingRecommended={inspection.missingRecommended} />,
            hidden: !inspection.scopes.length && !inspection.missingRequired.length,
          },
        ]}
      />
    </div>
  );
}

export function ProxyTestResultView({ result }: { result: ProxyTestResult }) {
  return (
    <Alert variant={result.ok ? 'success' : 'destructive'} data-testid="proxy-test-result" icon={<Globe />}>
      <AlertTitle>{result.ok ? 'Proxy connection works' : 'Proxy test failed'}</AlertTitle>
      <AlertDescription>
        {result.message}
        {result.ok && (result.latencyMs !== undefined || result.egressIp) ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            {result.latencyMs !== undefined ? `Round trip ${formatDurationMs(result.latencyMs)}` : null}
            {result.latencyMs !== undefined && result.egressIp ? ' · ' : null}
            {result.egressIp ? `Egress IP ${result.egressIp}` : null}
          </span>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
