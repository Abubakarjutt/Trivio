// Guarded fetch of a prospect's company website. Port of linkedin-outreach/outreach/netguard.py,
// plus address pinning: the socket connects to the address that was checked.
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export class RefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefusedError";
  }
}

export type Resolved = { address: string; family: 4 | 6 };
export type RawResponse = { status: number; location: string | null; body: string };
export type Page = { status: number; url: string; body: string };
export type ResolveFn = (host: string) => Promise<Resolved[]>;
export type RequestFn = (url: URL, to: Resolved, signal: AbortSignal) => Promise<RawResponse>;
export type FetchPage = (url: string) => Promise<Page>;

const MAX_REDIRECTS = 3;
const MAX_BODY = 1_000_000;
const TEXT_TYPES = /^(text\/html|text\/plain|application\/xhtml\+xml)\b/i;

const blocked = new net.BlockList();
for (const [net4, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(net4, prefix, "ipv4");
// No ::ffff:0:0/96 entry: BlockList treats IPv4 addresses as v4-mapped, so it would block every IPv4 address.
for (const [net6, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["64:ff9b::", 96],
  ["100::", 64],
] as const)
  blocked.addSubnet(net6, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  const a = address.split("%")[0];
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = net.isIP(a);
  if (family === 4) return !blocked.check(a, "ipv4");
  if (family === 6) return !blocked.check(a, "ipv6");
  return false;
}

export function isLinkedInHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return (
    h === "linkedin.com" || h.endsWith(".linkedin.com") || h === "lnkd.in" || h.endsWith(".lnkd.in")
  );
}

export const resolveHost: ResolveFn = async (host) =>
  (await dns.lookup(host, { all: true, verbatim: true })).map((r) => ({
    address: r.address,
    family: r.family as 4 | 6,
  }));

export const nodeRequest: RequestFn = (url, to, signal) =>
  new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        signal,
        headers: { "user-agent": "Trivio company check", accept: "text/html,text/plain;q=0.9" },
        // Pin the socket to the address that passed the check.
        lookup: (_host: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) =>
          opts?.all
            ? cb(null, [{ address: to.address, family: to.family }])
            : cb(null, to.address, to.family),
      } as http.RequestOptions,
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        if (!TEXT_TYPES.test(res.headers["content-type"] ?? "")) {
          res.resume();
          return resolve({ status, location, body: "" });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          if (size >= MAX_BODY) {
            res.destroy();
            resolve({
              status,
              location,
              body: Buffer.concat(chunks).subarray(0, MAX_BODY).toString("utf8"),
            });
          }
        });
        res.on("end", () =>
          resolve({ status, location, body: Buffer.concat(chunks).toString("utf8") })
        );
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end();
  });

async function checkedTarget(url: URL, resolve: ResolveFn): Promise<Resolved> {
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new RefusedError("Only http and https websites can be checked.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isLinkedInHost(host)) throw new RefusedError("Trivio never contacts LinkedIn.");
  const literal = net.isIP(host);
  const addresses: Resolved[] = literal
    ? [{ address: host, family: literal as 4 | 6 }]
    : await resolve(host);
  if (addresses.length === 0) throw new Error(`Can't resolve ${host}`);
  if (addresses.some((a) => !isPublicAddress(a.address)))
    throw new RefusedError(`Refusing a non-public address for ${host}.`);
  return addresses[0];
}

export function createPageFetcher(
  deps: { resolve?: ResolveFn; request?: RequestFn; timeoutMs?: number } = {}
): FetchPage {
  const resolve = deps.resolve ?? resolveHost;
  const request = deps.request ?? nodeRequest;
  const timeoutMs = deps.timeoutMs ?? 8000;
  return async (raw) => {
    const signal = AbortSignal.timeout(timeoutMs);
    let url = new URL(raw);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const to = await checkedTarget(url, resolve);
      const res = await request(url, to, signal);
      if (res.status >= 300 && res.status < 400 && res.location) {
        url = new URL(res.location, url);
        continue;
      }
      return { status: res.status, url: url.toString(), body: res.body };
    }
    throw new Error("Too many redirects");
  };
}
