/**
 * Configuration of the end-to-end suite. Nothing is hard-coded: credentials, the Meta emulator token and the
 * mail catcher's output come from environment variables, and a spec skips when one it needs is missing.
 */
export const env = {
  baseUrl: process.env.E2E_BASE_URL || 'http://localhost:3000',
  adminEmail: process.env.E2E_ADMIN_EMAIL ?? '',
  adminPassword: process.env.E2E_ADMIN_PASSWORD ?? '',
  /** Access token printed by the Meta API emulator (apps/api/test/support/meta-emulator.ts). */
  metaToken: process.env.E2E_META_TOKEN ?? '',
  /** File that receives the standalone fake-smtp output (one JSON block per captured e-mail). */
  mailLog: process.env.E2E_MAIL_LOG ?? '',
  /** Where the application's SMTP settings must point for the link flows (the fake-smtp catcher). */
  smtpHost: process.env.E2E_SMTP_HOST || '127.0.0.1',
  smtpPort: Number(process.env.E2E_SMTP_PORT || 2525),
};

const REQUIRED = {
  admin: ['E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD'],
  meta: ['E2E_META_TOKEN'],
  mail: ['E2E_MAIL_LOG'],
} as const;

/** Message for `test.skip()` when variables of the given groups are missing, otherwise `undefined`. */
export function missingEnv(...groups: (keyof typeof REQUIRED)[]): string | undefined {
  const absent = groups.flatMap((g) => REQUIRED[g]).filter((name) => !process.env[name]);
  return absent.length ? `Set ${absent.join(', ')} to run this spec (see apps/web/README.md).` : undefined;
}
