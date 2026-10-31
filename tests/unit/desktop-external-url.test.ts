import { describe, expect, it } from "vitest";
import { PRIVACY_FULL_DISK_ACCESS_URL, isAllowedExternalUrl } from "../../desktop/external-url";

describe("isAllowedExternalUrl", () => {
  it("allows http(s) and exactly the Full Disk Access settings page", () => {
    expect(isAllowedExternalUrl("https://trivio-ai.com")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com")).toBe(true);
    expect(isAllowedExternalUrl(PRIVACY_FULL_DISK_ACCESS_URL)).toBe(true);
  });
  it("refuses every other scheme or settings pane", () => {
    expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternalUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_Camera")).toBe(false);
    expect(isAllowedExternalUrl(`${PRIVACY_FULL_DISK_ACCESS_URL}&x`)).toBe(false);
  });
});
