// URLs the renderer may ask the main process to open. Besides web links, only
// the Full Disk Access pane (needed for SMS import) — never arbitrary schemes.
export const PRIVACY_FULL_DISK_ACCESS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

export function isAllowedExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url === PRIVACY_FULL_DISK_ACCESS_URL;
}
