// "Connect Google Drive": the installed-app OAuth flow. We open Google's
// consent page in the user's normal browser and catch the redirect on a
// one-time loopback listener (127.0.0.1:<random port>). PKCE protects the code
// exchange; a Desktop-type client secret is not confidential by Google's
// definition. Only the drive.file scope is requested: Trivio sees only the
// files it created.

import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { BackupError } from "./errors";
import type { SecretStoreLike } from "./secret-store";

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export const SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthUrl(o: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    code_challenge: o.challenge,
    code_challenge_method: "S256",
    state: o.state,
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return u.toString();
}

export function emailFromIdToken(idToken: string): string {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : "";
  } catch {
    return "";
  }
}

const page = (title: string) =>
  `<!doctype html><meta charset="utf-8"><title>Trivio</title>` +
  `<body style="font-family:system-ui;padding:4rem;text-align:center"><h1>${title}</h1><p>You can return to Trivio.</p></body>`;

export function waitForAuthCode(
  state: string,
  timeoutMs: number,
): Promise<{ redirectUri: string; code: Promise<string>; close: () => void }> {
  return new Promise((resolveStart, rejectStart) => {
    let settle!: { resolve: (c: string) => void; reject: (e: Error) => void };
    const code = new Promise<string>((resolve, reject) => (settle = { resolve, reject }));
    code.catch(() => {}); // the caller may stop waiting; don't crash on an unobserved rejection
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/") {
        res.writeHead(404).end();
        return;
      }
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400).end("state mismatch");
        return;
      }
      const got = url.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page(got ? "Connected — you can close this tab" : "Sign-in was cancelled"));
      if (got) settle.resolve(got);
      else settle.reject(new BackupError("AUTH_CANCELLED", url.searchParams.get("error") ?? undefined));
      close();
    });
    const timer = setTimeout(() => {
      settle.reject(new BackupError("AUTH_TIMEOUT"));
      close();
    }, timeoutMs);
    function close() {
      clearTimeout(timer);
      server.close();
    }
    server.on("error", rejectStart);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolveStart({ redirectUri: `http://127.0.0.1:${port}`, code, close });
    });
  });
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
}

async function postToken(fetchImpl: typeof fetch, body: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  } catch (err) {
    throw new BackupError("OFFLINE", err instanceof Error ? err.message : String(err));
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (json.error === "invalid_grant") throw new BackupError("AUTH_REVOKED");
    if (res.status >= 500) throw new BackupError("OFFLINE", `token endpoint ${res.status}`);
    throw new Error(`Google token error ${res.status}: ${String(json.error ?? "")} ${String(json.error_description ?? "")}`.trim());
  }
  return json as unknown as TokenResponse;
}

export class GoogleAuth {
  private cached: { token: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly client: OAuthClient,
    private readonly store: SecretStoreLike,
    private readonly deps: {
      openExternal: (url: string) => Promise<void> | void;
      fetch?: typeof fetch;
      now?: () => number;
      timeoutMs?: number;
    },
  ) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
  }

  async connect(): Promise<{ email: string }> {
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(16).toString("base64url");
    const wait = await waitForAuthCode(state, this.deps.timeoutMs ?? 5 * 60_000);
    try {
      await this.deps.openExternal(
        buildAuthUrl({ clientId: this.client.clientId, redirectUri: wait.redirectUri, challenge, state }),
      );
      const code = await wait.code;
      const t = await postToken(this.fetchImpl, {
        client_id: this.client.clientId,
        client_secret: this.client.clientSecret,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: wait.redirectUri,
      });
      if (!t.refresh_token) throw new Error("Google did not return a refresh token");
      await this.store.save("google-token", t.refresh_token);
      this.cached = { token: t.access_token, expiresAt: this.now() + t.expires_in * 1000 };
      return { email: emailFromIdToken(t.id_token ?? "") };
    } finally {
      wait.close();
    }
  }

  async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt - 60_000 > this.now()) return this.cached.token;
    const refreshToken = await this.store.load("google-token");
    if (!refreshToken) throw new BackupError("NOT_CONNECTED");
    const t = await postToken(this.fetchImpl, {
      client_id: this.client.clientId,
      client_secret: this.client.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    this.cached = { token: t.access_token, expiresAt: this.now() + t.expires_in * 1000 };
    return t.access_token;
  }

  // Drive answered 401: drop the cached token so the next call refreshes.
  forgetAccessToken(): void {
    this.cached = null;
  }

  async disconnect(): Promise<void> {
    let refreshToken: string | null = null;
    try {
      refreshToken = await this.store.load("google-token");
    } catch (err) {
      // Unreadable token: nothing to revoke, but still forget it locally.
      console.warn("[backup] could not read the Google token; skipping revoke:", err instanceof Error ? err.message : err);
    }
    this.cached = null;
    await this.store.clear("google-token");
    if (refreshToken) {
      await this.fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method: "POST" }).catch(() => {});
    }
  }
}
