// Small secrets (the Google refresh token, the backup key) kept on disk only
// in encrypted form, using the OS keychain via Electron's safeStorage (passed
// in as `codec` so this file stays testable without Electron).

import { promises as fsp } from "node:fs";
import { join } from "node:path";

export type SecretName = "google-token" | "key";

export interface SecretStoreLike {
  load(name: SecretName): Promise<string | null>;
  save(name: SecretName, value: string): Promise<void>;
  clear(name: SecretName): Promise<void>;
}

export interface SecretCodec {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class FileSecretStore implements SecretStoreLike {
  constructor(private readonly dir: string, private readonly codec: SecretCodec) {}

  private file(name: SecretName): string {
    return join(this.dir, `${name}.bin`);
  }

  async load(name: SecretName): Promise<string | null> {
    try {
      return this.codec.decryptString(await fsp.readFile(this.file(name)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async save(name: SecretName, value: string): Promise<void> {
    if (!this.codec.isEncryptionAvailable()) {
      throw new Error("The system keychain isn't available, so Trivio can't store the backup key safely.");
    }
    await fsp.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file(name)}.tmp`;
    await fsp.writeFile(tmp, this.codec.encryptString(value));
    await fsp.rename(tmp, this.file(name));
  }

  async clear(name: SecretName): Promise<void> {
    await fsp.rm(this.file(name), { force: true });
  }
}

export class MemorySecretStore implements SecretStoreLike {
  readonly values = new Map<SecretName, string>();
  async load(name: SecretName) {
    return this.values.get(name) ?? null;
  }
  async save(name: SecretName, value: string) {
    this.values.set(name, value);
  }
  async clear(name: SecretName) {
    this.values.delete(name);
  }
}
