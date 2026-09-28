import { expect, type Page } from '@playwright/test';
import { api, errorMessage } from './app';

/** Name prefix of the Meta profiles created by the suite. */
export const PROFILE_PREFIX = 'E2E emulator';

export interface Profile {
  id: string;
  name: string;
  status: string;
  syncStatus: string;
  counts: { adAccounts: number; connectedAdAccounts: number };
}

export interface AdAccount {
  id: string;
  profileId: string;
  metaAccountId: string;
  name: string;
  currency: string;
  isConnected: boolean;
}

export async function listProfiles(page: Page): Promise<Profile[]> {
  const res = await api<Profile[]>(page, 'GET', '/meta-profiles');
  expect(res.status, errorMessage(res.body)).toBe(200);
  return res.body;
}

export async function deleteProfile(page: Page, id: string): Promise<void> {
  const res = await api(page, 'DELETE', `/meta-profiles/${id}`);
  expect([200, 204, 404], errorMessage(res.body)).toContain(res.status);
}

/** Deletes the profiles earlier runs of the suite created, except `keepId`. */
export async function removeSuiteProfiles(page: Page, keepId?: string): Promise<void> {
  for (const p of await listProfiles(page)) {
    if (p.name.startsWith(PROFILE_PREFIX) && p.id !== keepId) await deleteProfile(page, p.id);
  }
}

/** A token can be in one profile only: the API refuses it with 409 and names the profile that holds it. */
export function tokenHolder(message: string): string | undefined {
  return /already connected in the profile "(.*)"/.exec(message)?.[1];
}

export async function deleteProfileNamed(page: Page, name: string): Promise<void> {
  const profile = (await listProfiles(page)).find((p) => p.name === name);
  if (profile) await deleteProfile(page, profile.id);
}

export async function listAccounts(page: Page, profileId: string): Promise<AdAccount[]> {
  const res = await api<{ items: AdAccount[] }>(
    page,
    'GET',
    `/ad-accounts?profileId=${profileId}&connected=all&pageSize=200`,
  );
  expect(res.status, errorMessage(res.body)).toBe(200);
  return res.body.items;
}

/**
 * The profile that holds the emulator token, discovered and with all its ad accounts connected. Reuses the
 * profile that already holds the token (the full-flow spec creates one through the UI); otherwise creates
 * "E2E emulator <stamp>". Profiles of earlier runs are removed so their ad accounts do not show up twice.
 */
export async function ensureEmulatorProfile(
  page: Page,
  token: string,
  stamp: string,
): Promise<{ profile: Profile; accounts: AdAccount[] }> {
  const created = await api<{ profile: Profile }>(page, 'POST', '/meta-profiles', {
    name: `${PROFILE_PREFIX} ${stamp}`,
    accessToken: token,
  });
  let profileId: string | undefined;
  if (created.status === 200 || created.status === 201) profileId = created.body.profile.id;
  else if (created.status === 409) {
    const holder = tokenHolder(errorMessage(created.body));
    profileId = (await listProfiles(page)).find((p) => p.name === holder)?.id;
  }
  if (!profileId) {
    throw new Error(`The emulator token was refused (${created.status}): ${errorMessage(created.body)}`);
  }
  await removeSuiteProfiles(page, profileId);

  let profile: Profile | undefined;
  await expect
    .poll(
      async () => {
        const res = await api<Profile>(page, 'GET', `/meta-profiles/${profileId}`);
        profile = res.body;
        return res.status === 200 && !['QUEUED', 'RUNNING'].includes(profile.syncStatus)
          ? `${profile.syncStatus}, ${profile.counts.adAccounts} ad accounts`
          : 'discovering';
      },
      { message: 'discovery of the emulator profile', timeout: 60_000 },
    )
    .toMatch(/^(SUCCESS|IDLE), [1-9]\d* ad accounts$/);

  let accounts = await listAccounts(page, profileId);
  const unconnected = accounts.filter((a) => !a.isConnected).map((a) => a.metaAccountId);
  if (unconnected.length) {
    const res = await api(page, 'POST', '/ad-accounts/connect', { profileId, connect: unconnected });
    expect(res.status, errorMessage(res.body)).toBe(200);
    accounts = await listAccounts(page, profileId);
  }
  return { profile: profile as Profile, accounts };
}

/** The emulator's USD ad account (the launch and rule flows use it). */
export function usdAccount(accounts: AdAccount[]): AdAccount {
  const account = accounts.find((a) => a.currency === 'USD');
  if (!account) throw new Error(`No USD ad account among ${accounts.map((a) => a.name).join(', ')}`);
  return account;
}
