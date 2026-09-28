import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * Special-purpose address ranges (IANA IPv4/IPv6 special registries): loopback, private, link-local (incl.
 * cloud metadata 169.254.169.254), CGNAT, documentation, benchmarking, multicast and reserved space.
 * User-supplied network destinations (Meta profile proxies) must not point into these ranges, otherwise the
 * server could be used to probe or reach internal services (SSRF).
 */
const reserved = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  reserved.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  reserved.addSubnet(net, prefix, 'ipv6');
}

/** True when the IP literal is a globally routable unicast address. */
export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return !reserved.check(ip, 'ipv4');
  if (version !== 6) return false;
  const lower = ip.toLowerCase();
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is judged by its IPv4 part.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return !reserved.check(mapped[1]!, 'ipv4');
  return !reserved.check(lower, 'ipv6');
}

export class NonPublicAddressError extends Error {
  constructor(
    readonly host: string,
    readonly address: string,
  ) {
    super(`${host} resolves to a private or reserved network address (${address})`);
    this.name = 'NonPublicAddressError';
  }
}

/** Resolves the host (all A/AAAA records) and throws when any address is not public. */
export async function assertPublicHost(host: string): Promise<void> {
  const clean = host.replace(/^\[|\]$/g, '');
  const addresses = isIP(clean) ? [clean] : (await lookup(clean, { all: true, verbatim: true })).map((a) => a.address);
  const bad = addresses.find((a) => !isPublicAddress(a));
  if (bad) throw new NonPublicAddressError(host, bad);
}
