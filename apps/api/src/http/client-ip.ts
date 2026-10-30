import { BlockList, isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

/**
 * Which proxies in front of the server are trusted to report the client's address.
 * - none: X-Forwarded-For is ignored; the client is the TCP peer.
 * - list: only these addresses or CIDR ranges are proxies (127.0.0.1 for Nginx/Caddy on the same
 *   machine, the private network of a load balancer, or Cloudflare's ranges).
 * There is no "trust everything", which lets any client choose its address in X-Forwarded-For
 * and walk around every per-address limit; and no hop count, which cannot tell a proxy from a
 * client reaching the server directly (Fastify itself ignores hop counts for that reason).
 */
export type ProxyTrust = { kind: 'none' } | { kind: 'list'; entries: string[] };

export function parseProxyTrust(value: string): ProxyTrust | string {
  const raw = value.trim().toLowerCase();
  if (raw === '' || raw === 'false' || raw === '0') return { kind: 'none' };
  if (raw === 'true') {
    return 'TRUST_PROXY=true would trust any X-Forwarded-For, so clients could pick their own address. List the proxy addresses or ranges instead (e.g. 127.0.0.1).';
  }
  if (/^\d+$/.test(raw)) {
    return 'TRUST_PROXY: a hop count cannot tell a proxy from a direct client. List the proxy addresses or ranges instead (e.g. 127.0.0.1).';
  }
  const entries = raw.split(',').map((e) => e.trim());
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split('/');
    const family = isIP(address ?? '');
    const bits = family === 4 ? 32 : 128;
    const prefixOk = prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) <= bits);
    if (family === 0 || !prefixOk || extra !== undefined) {
      return `TRUST_PROXY: "${entry}" is not an IP address or CIDR range`;
    }
  }
  return { kind: 'list', entries };
}

/** Plain IPv4 for IPv4-mapped IPv6 addresses (::ffff:127.0.0.1), so one rule covers both. */
function normalize(address: string): string {
  return address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
}

function blockListOf(entries: string[]): BlockList {
  const list = new BlockList();
  for (const entry of entries) {
    const [address, prefix] = entry.split('/') as [string, string | undefined];
    const type = isIP(address) === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) list.addAddress(address, type);
    else list.addSubnet(address, Number(prefix), type);
  }
  return list;
}

export interface ClientAddressing {
  /** Value for Fastify's trustProxy option */
  trustProxy: false | ((address: string, hop: number) => boolean);
  /** Is the TCP peer one of our proxies? */
  isTrustedPeer: (address: string | undefined) => boolean;
}

export function clientAddressing(trust: ProxyTrust): ClientAddressing {
  if (trust.kind === 'none') return { trustProxy: false, isTrustedPeer: () => false };
  const list = blockListOf(trust.entries);
  const trusted = (address: string | undefined) => {
    if (!address) return false;
    const ip = normalize(address);
    const family = isIP(ip);
    return family !== 0 && list.check(ip, family === 4 ? 'ipv4' : 'ipv6');
  };
  return { trustProxy: (address) => trusted(address), isTrustedPeer: trusted };
}

/**
 * The client's address for limits and audit. A header such as CF-Connecting-IP is believed only
 * when the request comes straight from a trusted proxy, so a client reaching the server directly
 * cannot set it.
 */
export function clientIp(request: FastifyRequest): string {
  const header = request.server.env.CLIENT_IP_HEADER;
  if (header && request.server.addressing.isTrustedPeer(request.socket.remoteAddress)) {
    const value = request.headers[header];
    const ip = typeof value === 'string' ? value.trim() : '';
    if (isIP(ip) !== 0) return normalize(ip);
  }
  return normalize(request.ip);
}
