import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  GoogleAuth, buildAuthUrl, emailFromIdToken, pkcePair, waitForAuthCode, SCOPES,
} from "../../../desktop/backup/google-auth";
import { MemorySecretStore } from "../../../desktop/backup/secret-store";

const client = { clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret" };
const idToken = (email: string) =>
  `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;

function tokenEndpoint(responses: Array<{ status: number; body: unknown }>) {
  const calls: URLSearchParams[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/revoke")) return new Response("", { status: 200 });
    calls.push(new URLSearchParams(String(init?.body)));
    const r = responses.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("google-auth helpers", () => {
  it("PKCE challenge is base64url(sha256(verifier))", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("auth URL asks for drive.file + email only, offline access, S256", () => {
    const u = new URL(buildAuthUrl({ clientId: "cid", redirectUri: "http://127.0.0.1:5000", challenge: "ch", state: "st" }));
    expect(u.searchParams.get("scope")).toBe(SCOPES.join(" "));
    expect(SCOPES).toEqual(["https://www.googleapis.com/auth/drive.file", "openid", "email"]);
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBe("st");
  });

  it("reads the email from an id_token", () => {
    expect(emailFromIdToken(idToken("me@example.com"))).toBe("me@example.com");
  });

  it("loopback listener ignores a wrong state and resolves on the right one", async () => {
    const w = await waitForAuthCode("good", 5000);
    expect((await fetch(`${w.redirectUri}?state=bad&code=x`)).status).toBe(400);
    const ok = await fetch(`${w.redirectUri}?state=good&code=the-code`);
    expect(await ok.text()).toContain("Connected");
    await expect(w.code).resolves.toBe("the-code");
  });

  it("loopback listener reports a denied consent and a timeout", async () => {
    const denied = await waitForAuthCode("s", 5000);
    await fetch(`${denied.redirectUri}?state=s&error=access_denied`);
    await expect(denied.code).rejects.toMatchObject({ code: "AUTH_CANCELLED" });
    const slow = await waitForAuthCode("s", 30);
    await expect(slow.code).rejects.toMatchObject({ code: "AUTH_TIMEOUT" });
  });
});

describe("GoogleAuth", () => {
  it("connect: opens the browser, exchanges the code, stores the refresh token", async () => {
    const store = new MemorySecretStore();
    const { fetchImpl, calls } = tokenEndpoint([
      { status: 200, body: { access_token: "at1", expires_in: 3600, refresh_token: "rt1", id_token: idToken("me@x.com") } },
    ]);
    const openExternal = async (url: string) => {
      const u = new URL(url);
      await fetch(`${u.searchParams.get("redirect_uri")}?state=${u.searchParams.get("state")}&code=c1`);
    };
    const auth = new GoogleAuth(client, store, { fetch: fetchImpl, openExternal });
    await expect(auth.connect()).resolves.toEqual({ email: "me@x.com" });
    expect(await store.load("google-token")).toBe("rt1");
    expect(calls[0].get("code")).toBe("c1");
    expect(calls[0].get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await auth.accessToken()).toBe("at1"); // cached, no second call
    expect(calls).toHaveLength(1);
  });

  it("accessToken refreshes when expired and maps invalid_grant to AUTH_REVOKED", async () => {
    const store = new MemorySecretStore();
    await store.save("google-token", "rt1");
    let now = 1_000_000;
    const { fetchImpl } = tokenEndpoint([
      { status: 200, body: { access_token: "at2", expires_in: 3600 } },
      { status: 400, body: { error: "invalid_grant" } },
    ]);
    const auth = new GoogleAuth(client, store, { fetch: fetchImpl, openExternal: async () => {}, now: () => now });
    expect(await auth.accessToken()).toBe("at2");
    now += 3600_000;
    await expect(auth.accessToken()).rejects.toMatchObject({ code: "AUTH_REVOKED" });
  });

  it("accessToken without a stored token is NOT_CONNECTED; disconnect clears it", async () => {
    const store = new MemorySecretStore();
    const { fetchImpl } = tokenEndpoint([]);
    const auth = new GoogleAuth(client, store, { fetch: fetchImpl, openExternal: async () => {} });
    await expect(auth.accessToken()).rejects.toMatchObject({ code: "NOT_CONNECTED" });
    await store.save("google-token", "rt");
    await auth.disconnect();
    expect(await store.load("google-token")).toBeNull();
  });

  it("disconnect still clears the token, and skips the revoke, when the store can't be read", async () => {
    const clear = vi.fn(async () => {});
    const store = { load: async () => { throw new Error("decrypt failed"); }, save: async () => {}, clear };
    const { fetchImpl } = tokenEndpoint([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const auth = new GoogleAuth(client, store, { fetch: fetchImpl, openExternal: async () => {} });
    await expect(auth.disconnect()).resolves.toBeUndefined();
    expect(clear).toHaveBeenCalledWith("google-token");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
