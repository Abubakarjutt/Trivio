import { describe, it, expect, afterEach } from "vitest";
import path from "path";
import { storageRoot, getAttachmentPath } from "@/lib/storage";

describe("storageRoot", () => {
  const saved = process.env.TRIVIO_STORAGE_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.TRIVIO_STORAGE_DIR;
    else process.env.TRIVIO_STORAGE_DIR = saved;
  });

  it("defaults to <cwd>/storage", () => {
    delete process.env.TRIVIO_STORAGE_DIR;
    expect(storageRoot()).toBe(path.join(process.cwd(), "storage"));
  });

  it("uses TRIVIO_STORAGE_DIR when set (desktop app: userData/storage)", () => {
    process.env.TRIVIO_STORAGE_DIR = "/tmp/trivio-storage";
    expect(storageRoot()).toBe("/tmp/trivio-storage");
    expect(getAttachmentPath("org1", "att1", "pdf")).toBe(
      path.join("/tmp/trivio-storage", "attachments", "org1", "att1.pdf"),
    );
  });
});
