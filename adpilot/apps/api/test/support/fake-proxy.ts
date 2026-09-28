/**
 * TEST DOUBLE — HTTP CONNECT proxy with optional Basic authentication. Records every tunnel so tests can
 * prove that Meta traffic of a profile really goes through its configured proxy.
 */
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

export class FakeProxy {
  private server!: http.Server;
  port = 0;
  readonly tunnels: { target: string; authorized: boolean }[] = [];
  /** Local ports of the proxy's upstream connections — the target sees requests coming from these ports. */
  readonly upstreamPorts = new Set<number>();
  credentials: { username: string; password: string } | null = null;

  async start(): Promise<void> {
    this.server = http.createServer((_req, res) => {
      res.writeHead(405);
      res.end();
    });
    this.server.on('connect', (req, client: net.Socket, head: Buffer) => {
      const expected = this.credentials
        ? `Basic ${Buffer.from(`${this.credentials.username}:${this.credentials.password}`).toString('base64')}`
        : null;
      const authorized = !expected || req.headers['proxy-authorization'] === expected;
      this.tunnels.push({ target: req.url ?? '', authorized });
      if (!authorized) {
        client.end(
          'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="test"\r\nContent-Length: 0\r\n\r\n',
        );
        return;
      }
      const [host, port] = (req.url ?? '').split(':');
      const upstream = net.connect(Number(port), host, () => {
        if (upstream.localPort) this.upstreamPorts.add(upstream.localPort);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}
