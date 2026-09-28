import { describe, expect, it } from 'vitest';
import {
  AD_CREATION_LIMIT_SUBCODE,
  BUDGET_CHANGE_LIMIT_SUBCODE,
  authStatusFromError,
  classifyGraphError,
  isBudgetChangeLimit,
  MetaApiError,
} from '../../src/modules/meta/graph/meta-errors';

describe('Meta error classification', () => {
  it('expired token → AUTH, not retryable, friendly message', () => {
    const d = classifyGraphError({ code: 190, error_subcode: 463, message: 'Session has expired', type: 'OAuthException' }, 400);
    expect(d.category).toBe('AUTH');
    expect(d.retryable).toBe(false);
    expect(d.friendlyMessage).toMatch(/expired/i);
    expect(authStatusFromError(new MetaApiError(d))).toBe('EXPIRED');
  });

  it('revoked / invalid token → INVALID', () => {
    const d = classifyGraphError({ code: 190, error_subcode: 460, message: 'password changed' }, 400);
    expect(authStatusFromError(new MetaApiError(d))).toBe('INVALID');
  });

  it.each([4, 17, 32, 613, 80000, 80004])('code %i → RATE_LIMIT and retryable', (code) => {
    const d = classifyGraphError({ code, message: 'limit' }, 400, 120_000);
    expect(d.category).toBe('RATE_LIMIT');
    expect(d.retryable).toBe(true);
    expect(d.friendlyMessage).toMatch(/retry automatically in about 2 min/);
  });

  it('ad account throttling subcode 2446079 → RATE_LIMIT', () => {
    expect(classifyGraphError({ code: 17, error_subcode: 2446079 }, 400).category).toBe('RATE_LIMIT');
  });

  it('permission errors are not retried', () => {
    const d = classifyGraphError({ code: 200, message: '(#200) Requires ads_management permission' }, 403);
    expect(d.category).toBe('PERMISSION');
    expect(d.retryable).toBe(false);
    expect(d.friendlyMessage).toMatch(/ads_management/);
  });

  it('invalid parameter → VALIDATION with explanation for promoted_object', () => {
    const d = classifyGraphError({ code: 100, message: 'Invalid parameter: promoted_object is required', error_user_msg: 'Select a pixel' }, 400);
    expect(d.category).toBe('VALIDATION');
    expect(d.retryable).toBe(false);
    expect(d.friendlyMessage).toMatch(/promoted object/i);
  });

  it("uses Meta's user message when available", () => {
    const d = classifyGraphError({ code: 100, message: 'Invalid parameter', error_user_msg: 'Your budget is too low.' }, 400);
    expect(d.friendlyMessage).toBe('Your budget is too low.');
  });

  it('transient errors (1, 2, is_transient) are retried', () => {
    expect(classifyGraphError({ code: 1, message: 'unknown' }, 500).category).toBe('TRANSIENT');
    expect(classifyGraphError({ code: 2 }, 503).retryable).toBe(true);
    // Meta's is_transient flag wins: Meta explicitly says a retry may succeed.
    expect(classifyGraphError({ code: 100, is_transient: true }, 400).category).toBe('TRANSIENT');
    expect(classifyGraphError({ code: 12345, is_transient: true }, 400).category).toBe('TRANSIENT');
  });

  it('policy block (368) is not retried', () => {
    const d = classifyGraphError({ code: 368, message: 'blocked' }, 400);
    expect(d.category).toBe('POLICY');
    expect(d.retryable).toBe(false);
  });

  it('only an invalid or expired token changes the profile status; permission errors may concern one object', () => {
    // 200/1870034 "Custom Audience Terms Not Accepted" is about one audience, not about the token.
    for (const err of [
      { code: 200, error_subcode: 1870034, message: 'Custom Audience Terms Not Accepted' },
      { code: 10, message: '(#10) Application does not have permission for this action' },
      { code: 294, message: 'Managing advertisements requires the extended permission ads_management' },
    ]) {
      const d = classifyGraphError(err, 400);
      expect(d.category, String(err.code)).toBe('PERMISSION');
      expect(authStatusFromError(new MetaApiError(d)), String(err.code)).toBeNull();
    }
    expect(authStatusFromError(new MetaApiError(classifyGraphError({ code: 102, message: 'Session key invalid' }, 400)))).toBe('INVALID');
  });

  it('613/1487225 (ad creation limit) fails with a clear message instead of throttling the account', () => {
    const d = classifyGraphError({ code: 613, error_subcode: AD_CREATION_LIMIT_SUBCODE, message: 'User request limit reached' }, 400);
    expect(d.category).toBe('VALIDATION');
    expect(d.retryable).toBe(false);
    expect(d.friendlyMessage).toMatch(/how many ads this ad account can create.*daily spending limit/);
  });

  it('613/1487632 (ad set budget changes) is a rate limit of that object only', () => {
    const d = classifyGraphError({ code: 613, error_subcode: BUDGET_CHANGE_LIMIT_SUBCODE, message: 'You can only change your ad set budget 4 times per hour.' }, 400, 3_600_000);
    expect(d.category).toBe('RATE_LIMIT');
    expect(isBudgetChangeLimit(d)).toBe(true);
    expect(d.friendlyMessage).toMatch(/4 budget changes per hour.*about 60 min/);
    // Other 613 subcodes stay ad account throttles.
    expect(isBudgetChangeLimit(classifyGraphError({ code: 613, error_subcode: 1487742 }, 400))).toBe(false);
  });

  it('100/33 is ambiguous (deleted or no access), so it is not NOT_FOUND', () => {
    const d = classifyGraphError({ code: 100, error_subcode: 33, message: 'Unsupported post request.' }, 400);
    expect(d.category).toBe('VALIDATION');
    expect(d.friendlyMessage).toMatch(/does not exist in Meta anymore, or .* has no access/);
    expect(classifyGraphError({ code: 803, message: 'Some of the aliases you requested do not exist' }, 404).category).toBe('NOT_FOUND');
  });

  it('3910001 ("please try again later") is retried', () => {
    for (const err of [{ code: 3910001 }, { code: 100, error_subcode: 3910001 }]) {
      const d = classifyGraphError({ ...err, message: "We're facing some trouble with your account. Please try again later." }, 400);
      expect(d.category).toBe('TRANSIENT');
      expect(d.retryable).toBe(true);
    }
  });
});
