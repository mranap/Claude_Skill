import { Agent as HttpsAgent } from 'node:https';
import { createHash } from 'node:crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { publicOnlyLookup } from '../../../common/net/public-address';

export interface ProxyConfig {
  type: 'HTTP' | 'HTTPS' | 'SOCKS5';
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  /** Administrator setting: proxies on private networks are allowed (no connect-time address check). */
  allowPrivateAddress?: boolean;
}

const MAX_CACHED = 500;
const cache = new Map<string, HttpsAgent>();
const direct = new HttpsAgent({ keepAlive: true, maxSockets: 50 });

export function proxyUrl(p: ProxyConfig, redactPassword = false): string {
  const scheme = p.type === 'SOCKS5' ? 'socks5h' : p.type === 'HTTPS' ? 'https' : 'http';
  const auth = p.username
    ? `${encodeURIComponent(p.username)}${p.password ? `:${redactPassword ? '***' : encodeURIComponent(p.password)}` : ''}@`
    : '';
  const host = p.host.includes(':') && !p.host.startsWith('[') ? `[${p.host}]` : p.host;
  return `${scheme}://${auth}${host}:${p.port}`;
}

/**
 * Axios agent options for a connection: with a proxy, the tunnelling agent is used for both https:// (Graph
 * API) and http:// targets, so traffic can never bypass the configured proxy.
 */
export function agentOptions(proxy?: ProxyConfig | null): { httpsAgent: HttpsAgent; httpAgent?: HttpsAgent } {
  const agent = agentFor(proxy);
  return proxy ? { httpsAgent: agent, httpAgent: agent } : { httpsAgent: agent };
}

/**
 * Returns an HTTPS agent that tunnels through the profile's proxy (HTTP CONNECT, HTTPS CONNECT or SOCKS5
 * with remote DNS). Agents are cached per proxy configuration so keep-alive connections are reused.
 * Unless private proxies are allowed, the proxy host is resolved through `publicOnlyLookup` on every
 * connection, so it can never be (re)pointed at an internal address.
 */
export function agentFor(proxy?: ProxyConfig | null): HttpsAgent {
  if (!proxy) return direct;
  const allowPrivate = proxy.allowPrivateAddress === true;
  const key = createHash('sha256')
    .update(`${proxy.type}|${proxy.host}|${proxy.port}|${proxy.username ?? ''}|${proxy.password ?? ''}|${allowPrivate}`)
    .digest('hex');
  let agent = cache.get(key);
  if (agent) return agent;
  const url = proxyUrl(proxy);
  const lookup = allowPrivate ? undefined : publicOnlyLookup;
  agent =
    proxy.type === 'SOCKS5'
      ? new SocksProxyAgent(url, { keepAlive: true, ...(lookup ? { socketOptions: { lookup } } : {}) })
      : new HttpsProxyAgent(url, { keepAlive: true, ...(lookup ? { lookup } : {}) });
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest) {
      retire(cache.get(oldest));
      cache.delete(oldest);
    }
  }
  cache.set(key, agent);
  return agent;
}

/**
 * Drops an evicted agent without breaking requests still running on it: idle keep-alive sockets are closed
 * now, busy ones when their request finishes.
 */
function retire(agent: HttpsAgent | undefined): void {
  if (!agent) return;
  agent.keepSocketAlive = () => false;
  for (const sockets of Object.values(agent.freeSockets)) for (const socket of sockets ?? []) socket.destroy();
}
