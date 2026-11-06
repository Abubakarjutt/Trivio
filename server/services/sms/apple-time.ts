// Messages stores dates relative to 2001-01-01 UTC (Apple's Cocoa epoch):
// nanoseconds on macOS 10.13+, seconds on older databases.
export const APPLE_EPOCH_MS = 978_307_200_000;

export function appleToDate(value: number): Date {
  // Nanosecond values exceed 2^53, so they arrive slightly rounded; round to
  // whole milliseconds instead of letting Date truncate 0.9999 ms down.
  const ms = value > 1e14 ? Math.round(value / 1e6) : value * 1000;
  return new Date(APPLE_EPOCH_MS + ms);
}

export function dateToAppleNs(date: Date): bigint {
  return BigInt(date.getTime() - APPLE_EPOCH_MS) * 1_000_000n;
}
