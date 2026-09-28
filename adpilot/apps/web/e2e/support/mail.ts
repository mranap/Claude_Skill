import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { env } from './env';

/** One e-mail as printed by the standalone fake-smtp (apps/api/test/support/fake-smtp.ts). */
export interface CapturedMail {
  to: string[];
  subject: string;
  links: string[];
}

/** All e-mails in E2E_MAIL_LOG: the catcher prints each one as a pretty-printed JSON object. */
export function readMails(): CapturedMail[] {
  let text: string;
  try {
    text = readFileSync(env.mailLog, 'utf8');
  } catch {
    return [];
  }
  const mails: CapturedMail[] = [];
  for (const [block] of text.matchAll(/^\{\n[\s\S]*?\n\}$/gm)) {
    try {
      const mail = JSON.parse(block) as Partial<CapturedMail>;
      if (Array.isArray(mail.to) && Array.isArray(mail.links)) mails.push(mail as CapturedMail);
    } catch {
      // an entry that is still being written
    }
  }
  return mails;
}

export function mailsTo(address: string): CapturedMail[] {
  const wanted = address.toLowerCase();
  return readMails().filter((m) => m.to.some((to) => to.toLowerCase() === wanted));
}

/**
 * Waits for an e-mail to `address` beyond the `seen` ones already there and returns its first link whose path
 * contains `path`.
 */
export async function waitForLink(address: string, path: string, seen = 0): Promise<URL> {
  let link: string | undefined;
  await expect
    .poll(
      () => {
        const mails = mailsTo(address);
        link = mails.length > seen ? mails[mails.length - 1].links.find((l) => l.includes(path)) : undefined;
        return link;
      },
      {
        message: `e-mail to ${address} with a ${path} link in ${env.mailLog} (is the fake-smtp output redirected there?)`,
        timeout: 30_000,
      },
    )
    .toBeTruthy();
  return new URL(link as string);
}
