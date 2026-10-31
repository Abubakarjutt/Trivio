import { describe, expect, it } from "vitest";
import { APPLE_EPOCH_MS, appleToDate, dateToAppleNs } from "@/server/services/sms/apple-time";
import { isPhoneNumber, makeSenderMatcher, normalizeSender } from "@/server/services/sms/sender";
import { decodeAttributedBody } from "@/server/services/sms/attributed-body";

// Builds an attributedBody blob shaped like the ones Messages writes:
// typedstream header, class chain, "NSString", bookkeeping bytes, '+', length, UTF-8.
function blob(text: string): string {
  const body = Buffer.from(text, "utf8");
  const n = body.length;
  const len =
    n < 0x80 ? Buffer.from([n])
    : n <= 0xffff ? Buffer.from([0x81, n & 0xff, n >> 8])
    : Buffer.from([0x82, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
  const head = Buffer.from(
    "\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01+",
    "latin1",
  );
  return Buffer.concat([head, len, body, Buffer.from([0x86, 0x84])]).toString("hex");
}

describe("apple time", () => {
  it("converts nanoseconds since 2001 to a Date", () => {
    const d = new Date("2026-10-30T09:15:00Z");
    const ns = Number(dateToAppleNs(d)); // sqlite3 -json hands us a lossy JS number
    expect(appleToDate(ns).toISOString()).toBe("2026-10-30T09:15:00.000Z");
  });
  it("still reads the old seconds-based format", () => {
    expect(appleToDate(0).getTime()).toBe(APPLE_EPOCH_MS);
    expect(appleToDate(86_400).toISOString()).toBe("2001-01-02T00:00:00.000Z");
  });
  it("dateToAppleNs is exact for whole milliseconds", () => {
    expect(dateToAppleNs(new Date(APPLE_EPOCH_MS + 1))).toBe(1_000_000n);
  });
});

describe("sender matching", () => {
  it("normalises case, spaces, plus, dashes and brackets", () => {
    expect(normalizeSender(" +92 (300) 123-4567 ")).toBe("923001234567");
    expect(normalizeSender("HBL")).toBe("hbl");
  });
  it("matches differently written forms of the same sender", () => {
    const m = makeSenderMatcher(["HBL", "+92 300-1234567"]);
    expect(m("hbl")).toBe(true);
    expect(m("+923001234567")).toBe(true);
    expect(m("MCB")).toBe(false);
  });
  it("ignores empty sender ids", () => {
    expect(makeSenderMatcher(["", "  "])("")).toBe(false);
  });
  it("detects phone numbers", () => {
    expect(isPhoneNumber("+923001234567")).toBe(true);
    expect(isPhoneNumber("8250")).toBe(false);
    expect(isPhoneNumber("HBL")).toBe(false);
  });
});

describe("decodeAttributedBody", () => {
  it("reads a short string (1-byte length)", () => {
    expect(decodeAttributedBody(blob("PKR 2,450 spent at FOODPANDA"))).toBe("PKR 2,450 spent at FOODPANDA");
  });
  it("reads a 2-byte length (0x81)", () => {
    const text = "x".repeat(300);
    expect(decodeAttributedBody(blob(text))).toBe(text);
  });
  it("reads a 4-byte length (0x82)", () => {
    const text = "y".repeat(70_000);
    expect(decodeAttributedBody(blob(text))).toBe(text);
  });
  it("uses byte length for non-ASCII text", () => {
    expect(decodeAttributedBody(blob("₨ 1,200 at Café Ñ"))).toBe("₨ 1,200 at Café Ñ");
  });
  it("returns null for missing, foreign or truncated blobs", () => {
    expect(decodeAttributedBody(null)).toBeNull();
    expect(decodeAttributedBody("")).toBeNull();
    expect(decodeAttributedBody(Buffer.from("no marker here").toString("hex"))).toBeNull();
    const full = blob("hello world");
    expect(decodeAttributedBody(full.slice(0, full.length - 12))).toBeNull();
  });
});
