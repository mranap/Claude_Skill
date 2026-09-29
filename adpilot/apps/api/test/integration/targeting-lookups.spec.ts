import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestStack, type TestUser } from '../support/harness';
import { ApiClient, expectStatus } from '../support/http-client';

describe('campaign builder look-ups (interests, languages, Instant Forms)', () => {
  const stack = new TestStack();
  let admin: ApiClient;
  let user: TestUser;
  let accountId: string;
  let world: ReturnType<TestStack['meta']['seed']>;

  beforeAll(async () => {
    await stack.start({ worker: true });
    await stack.setSettings('security', { loginRateLimitPerMinute: 200 });
    admin = await stack.loginSuperAdmin();
    user = await stack.createUser(admin);
    world = stack.meta.seed();
    const profileId = expectStatus(
      await user.client.post('/api/meta-profiles', { name: 'Look-ups BM', accessToken: world.token }),
      201,
    ).body.profile.id as string;
    await stack.waitFor(
      async () =>
        (await stack.prisma.metaProfile.findUniqueOrThrow({ where: { id: profileId } })).lastSyncAt !== null,
    );
    accountId = (
      await stack.prisma.adAccount.findFirstOrThrow({
        where: { profileId, metaAccountId: world.accountIds[0] },
      })
    ).id;
  });
  afterAll(() => stack.stop());

  it('searches interests and languages through the profile connection and caches the answers', async () => {
    const interests = expectStatus(
      await user.client.get(`/api/ad-accounts/${accountId}/targeting/interests?q=yoga`),
      200,
    ).body.items;
    expect(interests).toEqual([
      {
        id: '6003020834693',
        name: 'Yoga',
        path: ['Interests', 'Fitness and wellness', 'Yoga'],
        audienceSizeLower: 180_000_000,
        audienceSizeUpper: 220_000_000,
      },
    ]);
    const searches = () => stack.meta.requests.filter((r) => r.path === '/search').length;
    const before = searches();
    expectStatus(await user.client.get(`/api/ad-accounts/${accountId}/targeting/interests?q=YOGA`), 200); // served from the cache
    expect(searches()).toBe(before);

    // An empty query lists every language (Meta: q= with a large limit).
    const locales = expectStatus(
      await user.client.get(`/api/ad-accounts/${accountId}/targeting/locales`),
      200,
    ).body.items;
    expect(locales).toContainEqual({ key: 6, name: 'English (US)' });
    expect(
      stack.meta.requests.find((r) => r.path === '/search' && r.params.type === 'adlocale')?.params.limit,
    ).toBe('1000');
    expect((await user.client.get(`/api/ad-accounts/${accountId}/targeting/interests?q=y`)).status).toBe(400);
  });

  it('lists Instant Forms with a Page token; a missing Page permission never affects the profile', async () => {
    const url = `/api/ad-accounts/${accountId}/pages/${world.pageId}/lead-forms`;
    const denied = await user.client.get(url);
    expect(denied.status).toBe(422);
    expect(denied.body.error.code).toBe('META_PERMISSION_ERROR');
    expect(denied.body.error.message).toMatch(/pages_manage_ads/);
    expect((await stack.prisma.metaProfile.findFirstOrThrow({ where: { userId: user.id } })).status).toBe(
      'ACTIVE',
    );

    stack.meta.tokens.get(world.token)!.scopes.push('pages_manage_ads');
    const forms = expectStatus(await user.client.get(url), 200).body.items as {
      name: string;
      status: string;
    }[];
    expect(forms.map((f) => [f.name, f.status])).toEqual([
      ['Free consultation', 'ACTIVE'],
      ['Spring offer 2025', 'ARCHIVED'],
    ]);
    // The forms were read with a Page token issued for this request, never with the profile's own token.
    const formRequest = stack.meta.requests.filter((r) => r.path === `/${world.pageId}/leadgen_forms`).at(-1);
    expect(formRequest).toBeDefined();
    expect(await stack.prisma.metaProfile.count({ where: { tokenMask: { contains: 'EAAP' } } })).toBe(0);

    expect((await user.client.get(`/api/ad-accounts/${accountId}/pages/123456789/lead-forms`)).status).toBe(
      404,
    );
  });

  it('never serves another tenant, even for cached answers', async () => {
    const other = await stack.createUser(admin);
    expect((await other.client.get(`/api/ad-accounts/${accountId}/targeting/interests?q=yoga`)).status).toBe(
      404,
    );
    expect(
      (await other.client.get(`/api/ad-accounts/${accountId}/pages/${world.pageId}/lead-forms`)).status,
    ).toBe(404);
  });
});
