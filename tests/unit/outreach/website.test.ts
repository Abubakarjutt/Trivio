import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createPageFetcher,
  isLinkedInHost,
  isPublicAddress,
  nodeRequest,
  RefusedError,
  type RawResponse,
  type Resolved,
} from "@/server/services/outreach/website";

describe("isPublicAddress", () => {
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("allows %s", (a) =>
    expect(isPublicAddress(a)).toBe(true)
  );
  it.each([
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.5.4",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12::1",
    "::ffff:10.0.0.1",
    "::ffff:7f00:1",
  ])("refuses %s", (a) => expect(isPublicAddress(a)).toBe(false));
});

describe("isLinkedInHost", () => {
  it.each([
    "linkedin.com",
    "www.LinkedIn.com",
    "pk.linkedin.com.",
    "linkedin.com..",
    "www.linkedin.com...",
    "lnkd.in",
  ])("matches %s", (h) => expect(isLinkedInHost(h)).toBe(true));
  it.each(["notlinkedin.com", "linkedin.com.evil.io", "acme.ai"])("doesn't match %s", (h) =>
    expect(isLinkedInHost(h)).toBe(false)
  );
});

describe("isLinkedInHost performance", () => {
  it("handles a long run of dots in linear time", () => {
    const t0 = Date.now();
    expect(isLinkedInHost("a" + ".".repeat(200_000) + "b")).toBe(false);
    expect(Date.now() - t0).toBeLessThan(500);
  }, 20_000);
});

const ok = (body = "<html>hi</html>"): RawResponse => ({ status: 200, location: null, body });
const PUBLIC: Resolved[] = [{ address: "93.184.216.34", family: 4 }];

describe("createPageFetcher", () => {
  it("refuses a private IP literal without a DNS lookup (Review Focus #5)", async () => {
    const resolve = vi.fn();
    const fetchPage = createPageFetcher({ resolve, request: vi.fn() });
    await expect(fetchPage("http://10.0.0.1/")).rejects.toBeInstanceOf(RefusedError);
    await expect(fetchPage("http://[::1]/")).rejects.toBeInstanceOf(RefusedError);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refuses a name that resolves to any private address", async () => {
    const resolve = vi.fn().mockResolvedValue([...PUBLIC, { address: "127.0.0.1", family: 4 }]);
    const request = vi.fn();
    await expect(createPageFetcher({ resolve, request })("https://acme.ai")).rejects.toBeInstanceOf(
      RefusedError
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses LinkedIn and non-http schemes", async () => {
    const fetchPage = createPageFetcher({
      resolve: vi.fn().mockResolvedValue(PUBLIC),
      request: vi.fn(),
    });
    await expect(fetchPage("https://me@www.linkedin.com:443/company/acme")).rejects.toBeInstanceOf(
      RefusedError
    );
    await expect(fetchPage("file:///etc/passwd")).rejects.toBeInstanceOf(RefusedError);
  });

  it("connects to the address it checked", async () => {
    const request = vi.fn().mockResolvedValue(ok());
    const page = await createPageFetcher({ resolve: vi.fn().mockResolvedValue(PUBLIC), request })(
      "https://acme.ai/"
    );
    expect(page).toEqual({ status: 200, url: "https://acme.ai/", body: "<html>hi</html>" });
    expect(request.mock.calls[0][1]).toEqual(PUBLIC[0]);
  });

  it("checks every redirect hop", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      status: 302,
      location: "http://169.254.169.254/latest/meta-data",
      body: "",
    });
    await expect(
      createPageFetcher({ resolve: vi.fn().mockResolvedValue(PUBLIC), request })("https://acme.ai")
    ).rejects.toBeInstanceOf(RefusedError);
    const toLinkedIn = vi.fn().mockResolvedValueOnce({
      status: 301,
      location: "https://www.linkedin.com/company/acme",
      body: "",
    });
    await expect(
      createPageFetcher({ resolve: vi.fn().mockResolvedValue(PUBLIC), request: toLinkedIn })(
        "https://acme.ai"
      )
    ).rejects.toBeInstanceOf(RefusedError);
  });

  it("follows relative redirects and stops after 3", async () => {
    const hop = { status: 302, location: "/next", body: "" };
    const request = vi.fn().mockResolvedValue(hop);
    await expect(
      createPageFetcher({ resolve: vi.fn().mockResolvedValue(PUBLIC), request })("https://acme.ai")
    ).rejects.toThrow("Too many redirects");
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[1][0].toString()).toBe("https://acme.ai/next");
  });
});

describe("nodeRequest", () => {
  let server: http.Server;
  let port: number;
  const seen: { host?: string } = {};
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.host = req.headers.host;
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("x".repeat(1_500_000));
      } else if (req.url === "/image") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end("PNGDATA");
      } else {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<html>Hello</html>");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const to: Resolved = { address: "127.0.0.1", family: 4 };
  const signal = () => AbortSignal.timeout(5000);

  it("connects to the pinned address but sends the real Host header", async () => {
    const res = await nodeRequest(new URL(`http://acme.test:${port}/`), to, signal());
    expect(res.body).toBe("<html>Hello</html>");
    expect(seen.host).toBe(`acme.test:${port}`);
  });

  it("cuts bodies off at 1 MB", async () => {
    const res = await nodeRequest(new URL(`http://acme.test:${port}/big`), to, signal());
    expect(res.body.length).toBe(1_000_000);
  });

  it("doesn't read non-text bodies", async () => {
    expect((await nodeRequest(new URL(`http://acme.test:${port}/image`), to, signal())).body).toBe(
      ""
    );
  });
});
