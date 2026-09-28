import { describe, expect, it } from 'vitest';
import {
  assertPublicHost,
  isPublicAddress,
  NonPublicAddressError,
} from '../../src/common/net/public-address';

describe('public address policy (SSRF protection for user-supplied proxies)', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
  ])('%s is not public', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(['8.8.8.8', '157.240.1.35', '172.32.0.1', '2a03:2880:f10c:83:face:b00c:0:25de', '::ffff:8.8.8.8'])(
    '%s is public',
    (ip) => expect(isPublicAddress(ip)).toBe(true),
  );

  it('rejects hostnames that resolve to private addresses', async () => {
    await expect(assertPublicHost('localhost')).rejects.toBeInstanceOf(NonPublicAddressError);
    await expect(assertPublicHost('[::1]')).rejects.toBeInstanceOf(NonPublicAddressError);
    await expect(assertPublicHost('8.8.8.8')).resolves.toBeUndefined();
    expect(isPublicAddress('not-an-ip')).toBe(false);
  });
});
