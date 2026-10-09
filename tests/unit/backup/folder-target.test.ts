import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FolderAuth,
  FolderDrive,
  findGoogleDriveFolders,
} from "../../../desktop/backup/folder-target";

let tmp: string;
beforeEach(async () => {
  tmp = await fsp.mkdtemp(join(tmpdir(), "trivio-folder-"));
});
afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

const code = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e) => (e as { code?: string }).code
  );

describe("findGoogleDriveFolders", () => {
  it("finds the Google Drive app's My Drive folders on macOS, labelled by account", async () => {
    const cloud = join(tmp, "Library", "CloudStorage");
    await fsp.mkdir(join(cloud, "GoogleDrive-b@example.com", "My Drive"), { recursive: true });
    await fsp.mkdir(join(cloud, "GoogleDrive-a@example.com", "My Drive"), { recursive: true });
    await fsp.mkdir(join(cloud, "GoogleDrive-signedout@example.com"), { recursive: true }); // no My Drive yet
    await fsp.mkdir(join(cloud, "Dropbox"), { recursive: true });
    const found = findGoogleDriveFolders({ platform: "darwin", home: tmp });
    expect(found.filter((f) => f.path.startsWith(tmp))).toEqual([
      { label: "a@example.com", path: join(cloud, "GoogleDrive-a@example.com", "My Drive") },
      { label: "b@example.com", path: join(cloud, "GoogleDrive-b@example.com", "My Drive") },
    ]);
  });

  it("finds nothing when the Drive app isn't installed", () => {
    expect(
      findGoogleDriveFolders({ platform: "darwin", home: tmp }).filter((f) =>
        f.path.startsWith(tmp)
      )
    ).toEqual([]);
  });
});

describe("FolderAuth", () => {
  const drive = (p: string) => ({ label: "me@example.com", path: p });

  it("uses the only detected Google Drive folder without asking, and remembers it", async () => {
    const pick = vi.fn();
    const file = join(tmp, "backup", "folder.json");
    const auth = new FolderAuth({ file, detect: () => [drive("/gd")], pick });
    expect(await auth.connect()).toEqual({ email: "me@example.com" });
    expect(pick).not.toHaveBeenCalled();
    // A fresh instance (next launch) reads the saved choice.
    const again = new FolderAuth({ file, detect: () => [], pick });
    expect(await again.root()).toBe("/gd");
  });

  it("asks with the folder picker when choosing, or when nothing (or several) is detected", async () => {
    const file = join(tmp, "folder.json");
    const pick = vi.fn(async () => join(tmp, "Dropbox"));
    const auth = new FolderAuth({ file, detect: () => [drive("/gd")], pick });
    expect(await auth.connect({ choose: true })).toEqual({ email: join(tmp, "Dropbox") });
    expect(pick).toHaveBeenCalledWith("/gd");

    const none = new FolderAuth({ file, detect: () => [], pick });
    await none.connect();
    expect(pick).toHaveBeenCalledTimes(2);

    // Picking a detected Drive folder keeps its account label.
    const two = new FolderAuth({
      file,
      detect: () => [drive("/gd"), { label: "x@example.com", path: "/gd2" }],
      pick: async () => "/gd2",
    });
    expect(await two.connect()).toEqual({ email: "x@example.com" });
  });

  it("a cancelled picker changes nothing", async () => {
    const file = join(tmp, "folder.json");
    const auth = new FolderAuth({ file, detect: () => [], pick: async () => null });
    expect(await code(auth.connect())).toBe("FOLDER_NOT_CHOSEN");
    expect(await code(auth.root())).toBe("NOT_CONNECTED");
  });

  it("disconnect forgets the folder", async () => {
    const file = join(tmp, "folder.json");
    const auth = new FolderAuth({ file, detect: () => [drive("/gd")], pick: async () => null });
    await auth.connect();
    await auth.disconnect();
    expect(await code(auth.root())).toBe("NOT_CONNECTED");
    expect(
      await code(new FolderAuth({ file, detect: () => [], pick: async () => null }).root())
    ).toBe("NOT_CONNECTED");
  });
});

describe("FolderDrive", () => {
  async function setup() {
    const root = join(tmp, "My Drive");
    await fsp.mkdir(root);
    const src = join(tmp, "out.trivio-backup");
    await fsp.writeFile(src, "encrypted bytes");
    return { root, src, drive: new FolderDrive(async () => root) };
  }

  it("uploads into 'Trivio Backups', lists newest first, downloads and deletes", async () => {
    const { root, src, drive } = await setup();
    const folder = await drive.ensureFolder();
    expect(folder).toBe(join(root, "Trivio Backups"));
    const older = "trivio-2026-10-01T09-00-00Z.trivio-backup";
    const newer = "trivio-2026-10-03T09-00-00Z.trivio-backup";
    const up = await drive.upload(folder, older, src, "0.1.25");
    expect(up).toMatchObject({
      id: older,
      size: 15,
      createdTime: "2026-10-01T09:00:00Z",
      appVersion: "0.1.25",
    });
    await drive.upload(folder, newer, src, "0.1.25");
    await fsp.writeFile(join(folder, `${newer}.partial`), "half"); // an interrupted copy
    await fsp.writeFile(join(folder, "notes.txt"), "not a backup");

    const list = await drive.list();
    expect(list.map((f) => f.id)).toEqual([newer, older]);

    const dest = join(tmp, "dl.trivio-backup");
    await drive.download(older, dest);
    expect(await fsp.readFile(dest, "utf8")).toBe("encrypted bytes");

    await drive.delete(older);
    expect((await drive.list()).map((f) => f.id)).toEqual([newer]);
  });

  it("an empty folder lists nothing", async () => {
    const { drive } = await setup();
    expect(await drive.list()).toEqual([]);
  });

  it("never recreates a missing folder (the Drive app quit or signed out)", async () => {
    const gone = join(tmp, "GoogleDrive-me", "My Drive");
    const drive = new FolderDrive(async () => gone);
    expect(await code(drive.ensureFolder())).toBe("FOLDER_MISSING");
    expect(await code(drive.list())).toBe("FOLDER_MISSING");
    await expect(fsp.stat(gone)).rejects.toThrow();
  });

  it("refuses ids that aren't a bare backup file name", async () => {
    const { drive } = await setup();
    await drive.ensureFolder();
    for (const id of [
      "../secret.trivio-backup",
      "/etc/passwd",
      "a/b.trivio-backup",
      "notes.txt",
      "..\\x.trivio-backup",
    ]) {
      expect(await code(drive.download(id, join(tmp, "x")))).toBe("BAD_FORMAT");
      expect(await code(drive.delete(id))).toBe("BAD_FORMAT");
    }
  });
});
