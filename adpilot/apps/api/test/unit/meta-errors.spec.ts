import { describe, expect, it } from 'vitest';
import { authStatusFromError, classifyGraphError, MetaApiError } from '../../src/modules/meta/graph/meta-errors';

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
});
