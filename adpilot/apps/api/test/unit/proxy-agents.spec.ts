import http from 'node:http';
import type { AddressInfo } from 'node:net';
import axios from 'axios';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publicOnlyLookup } from '../../src/common/net/public-address';
import { agentOptions } from '../../src/modules/meta/graph/proxy-agents';

const lookupAll = (host: string) =>
  new Promise<{ err: NodeJS.ErrnoException | null; addresses: unknown }>((resolve) =>
    publicOnlyLookup(host, { all: true }, (err, addresses) => resolve({ err, addresses })),
  );

describe('proxy agents: address policy at connect time (DNS rebinding)', () => {
  const connects: string[] = [];
  let proxy: http.Server;
  let port = 0;

  beforeAll(async () => {
    proxy = http.createServer();
    proxy.on('connect', (req, socket) => {
      connects.push(req.url ?? '');
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', () => r()));
    port = (proxy.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => proxy.close(() => r())));

  const call = (allowPrivateAddress: boolean) =>
    axios
      .get('https://graph.example.test/v26.0/me', {
        ...agentOptions({ type: 'HTTP', host: 'localhost', port, allowPrivateAddress }),
        proxy: false,
        timeout: 5000,
      })
      .then(
        () => null,
        (err: unknown) => err as Error,
      );

  it('refuses a proxy host name that resolves to a private address, without revealing the address', async () => {
    const err = await call(false);
    expect(err?.message).toMatch(/localhost resolves to a private or reserved network address/);
    expect(err?.message).not.toMatch(/127\.0\.0\.1|::1/);
    expect(connects).toHaveLength(0);
  });

  it('connects when the administrator allows private proxy addresses', async () => {
    await call(true);
    expect(connects).toEqual(['graph.example.test:443']);
  });

  it('passes public answers through and rejects private ones', async () => {
    expect((await lookupAll('8.8.8.8')).addresses).toEqual([{ address: '8.8.8.8', family: 4 }]);
    const res = await lookupAll('localhost');
    expect(res.err?.message).toMatch(/private or reserved/);
  });
});
