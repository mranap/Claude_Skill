import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateRecoveryCodes, generateTotpSecret, hotp, otpauthUrl, verifyTotp } from '../../src/modules/auth/totp';

describe('TOTP (RFC 6238)', () => {
  const rfcKey = Buffer.from('12345678901234567890');

  it('matches the RFC 6238 SHA1 test vectors', () => {
    // T = 59 s → counter 1; T = 1111111109 → counter 37037036; T = 1234567890 → counter 41152263
    expect(hotp(rfcKey, 1, 8)).toBe('94287082');
    expect(hotp(rfcKey, 37037036, 8)).toBe('07081804');
    expect(hotp(rfcKey, 41152263, 8)).toBe('89005924');
  });

  it('round-trips base32', () => {
    const buf = Buffer.from('hello world, totp!');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('verifies codes within ±1 step and rejects others', () => {
    const secret = generateTotpSecret();
    const key = base32Decode(secret);
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30000);
    expect(verifyTotp(secret, hotp(key, step), now)).toBe(step);
    expect(verifyTotp(secret, hotp(key, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, hotp(key, step + 2), now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
  });

  it('generates unique, well-formed recovery codes', () => {
    const codes = generateRecoveryCodes(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
  });

  it('builds an otpauth URI', () => {
    const url = otpauthUrl({ secret: 'ABC', account: 'a@b.c', issuer: 'AdPilot' });
    expect(url).toContain('otpauth://totp/AdPilot%3Aa%40b.c?');
    expect(url).toContain('secret=ABC');
  });
});
