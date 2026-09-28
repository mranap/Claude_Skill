import { describe, expect, it } from 'vitest';
import { maxUtilisation, parseUsageHeaders } from '../../src/modules/meta/graph/usage-headers';
import { REDACTED, maskSecret, sanitize, sanitizeString } from '../../src/infra/logger/sanitize';

describe('usage headers', () => {
  it('parses app, ad account, business use case and insights headers', () => {
    const u = parseUsageHeaders({
      'x-app-usage': '{"call_count":28,"total_time":25,"total_cputime":25}',
      'x-ad-account-usage':
        '{"acc_id_util_pct":9.67,"reset_time_duration":0,"ads_api_access_tier":"standard_access"}',
      'x-business-use-case-usage':
        '{"1234":[{"type":"ads_management","call_count":95,"total_cputime":20,"total_time":20,"estimated_time_to_regain_access":3,"ads_api_access_tier":"development_access"}]}',
      'x-fb-ads-insights-throttle':
        '{"app_id_util_pct":100,"acc_id_util_pct":10,"ads_api_access_tier":"standard_access"}',
    });
    expect(u.app?.callCount).toBe(28);
    expect(u.adAccount?.utilPct).toBeCloseTo(9.67);
    expect(u.business[0]).toMatchObject({
      businessId: '1234',
      type: 'ads_management',
      callCount: 95,
      regainMinutes: 3,
    });
    expect(u.insights?.appPct).toBe(100);
    expect(maxUtilisation(u)).toBe(100);
  });

  it('ignores malformed headers', () => {
    const u = parseUsageHeaders({ 'x-app-usage': 'not json' });
    expect(u.app).toBeUndefined();
    expect(u.business).toEqual([]);
  });
});

describe('secret sanitisation', () => {
  it('redacts Meta tokens, bearer tokens and credentials in URLs', () => {
    const s = sanitizeString(
      'token EAABsbCW1234567890abcdefghijklmn and Bearer abcdefghijklmnop http://user:pass@proxy:8080 access_token=EAA123',
    );
    expect(s).not.toContain('1234567890abcdefghijklmn');
    expect(s).not.toContain('abcdefghijklmnop');
    expect(s).not.toContain('user:pass');
    expect(s).toContain(`access_token=${REDACTED}`);
  });

  it('masks secret-looking keys recursively but keeps token metadata', () => {
    const out = sanitize({
      password: 'x',
      nested: { appSecret: 'y', tokenMask: 'EAAB****7ds', list: [{ accessToken: 'z' }] },
    }) as Record<string, any>;
    expect(out.password).toBe(REDACTED);
    expect(out.nested.appSecret).toBe(REDACTED);
    expect(out.nested.tokenMask).toBe('EAAB****7ds');
    expect(out.nested.list[0].accessToken).toBe(REDACTED);
  });

  it('masks tokens for display', () => {
    expect(maskSecret('EAABsbCW1234567890abc7ds')).toBe('EAAB************7ds');
  });
});
