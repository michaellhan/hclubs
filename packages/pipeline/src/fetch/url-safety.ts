import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * The crawler follows links found on pages anyone can edit, so a URL is untrusted input.
 * It must never reach this machine, the local network or a cloud metadata address (SSRF;
 * ADR 0039): the dev database listens on 127.0.0.1 and a home router on 192.168.x.x.
 */

/** Why a URL must not be fetched, judged from the URL alone; null when it may be. PURE. */
export function unsafeUrlReason(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "not a valid URL";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return `scheme ${u.protocol} is not http(s)`;
  if (u.username || u.password) return "URL carries credentials";
  const host = u.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!host) return "no host";
  if (host === "localhost" || /\.(localhost|local|internal|home|lan)$/.test(host)) return `local host name ${host}`;
  if (isIP(host)) return privateAddressReason(host);
  if (!host.includes(".")) return `single-label host ${host}`;
  return null;
}

/** Why an IP address is private, loopback, link-local or otherwise not public; null if public. PURE. */
export function privateAddressReason(ip: string): string | null {
  const v = isIP(ip);
  if (v === 4) {
    const [a = -1, b = -1] = ip.split(".").map(Number);
    if (a === 0) return "address in 0.0.0.0/8";
    if (a === 10) return "private address (10/8)";
    if (a === 127) return "loopback address";
    if (a === 169 && b === 254) return "link-local or cloud metadata address";
    if (a === 172 && b >= 16 && b <= 31) return "private address (172.16/12)";
    if (a === 192 && b === 168) return "private address (192.168/16)";
    if (a === 100 && b >= 64 && b <= 127) return "carrier-grade NAT address";
    if (a === 198 && (b === 18 || b === 19)) return "benchmarking address";
    if (a >= 224) return "multicast or reserved address";
    return null;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return "loopback or unspecified address";
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x)?.[1];
    if (mapped) return privateAddressReason(mapped);
    // The URL parser writes a mapped IPv4 address in hex: [::ffff:192.168.1.1] → ::ffff:c0a8:101.
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(x);
    if (hex) {
      const [hi, lo] = [parseInt(hex[1] ?? "0", 16), parseInt(hex[2] ?? "0", 16)];
      return privateAddressReason(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (/^f[cd]/.test(x)) return "unique-local address (fc00::/7)";
    if (/^fe[89ab]/.test(x)) return "link-local address (fe80::/10)";
    if (/^ff/.test(x)) return "multicast address";
    return null;
  }
  return "not an IP address";
}

export type HostResolver = (host: string) => Promise<string[]>;

export const systemResolver: HostResolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * The URL check plus where its host resolves: a public-looking name that points at a
 * private address is refused too. A name that doesn't resolve is left to the fetch, which
 * reports it as unreachable.
 */
export async function unsafeTargetReason(raw: string, resolve: HostResolver | null): Promise<string | null> {
  const direct = unsafeUrlReason(raw);
  if (direct || !resolve) return direct;
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return null;
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return null;
  }
  for (const a of addresses) {
    const why = privateAddressReason(a);
    if (why) return `${host} resolves to a ${why}`;
  }
  return null;
}
