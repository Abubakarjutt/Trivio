// Newer macOS often leaves message.text empty and stores the body only in
// attributedBody, an NSArchiver "typedstream". The plain string follows the
// NSString class name: a few bookkeeping bytes, then '+' (0x2B), then a length
// (one byte, or 0x81 + uint16 LE, or 0x82 + uint32 LE), then UTF-8 bytes.
const MARKER = Buffer.from("NSString", "latin1");
const PLUS = 0x2b;
const SEARCH_WINDOW = 16;

export function decodeAttributedBody(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const buf = Buffer.from(hex, "hex");
  const at = buf.indexOf(MARKER);
  if (at < 0) return null;

  let i = at + MARKER.length;
  const windowEnd = Math.min(buf.length, i + SEARCH_WINDOW);
  while (i < windowEnd && buf[i] !== PLUS) i++;
  if (i >= windowEnd) return null;
  i++;
  if (i >= buf.length) return null;

  let len: number;
  const lead = buf[i]!;
  if (lead === 0x81) {
    if (i + 3 > buf.length) return null;
    len = buf.readUInt16LE(i + 1);
    i += 3;
  } else if (lead === 0x82) {
    if (i + 5 > buf.length) return null;
    len = buf.readUInt32LE(i + 1);
    i += 5;
  } else {
    len = lead;
    i += 1;
  }
  if (i + len > buf.length) return null;
  return buf.subarray(i, i + len).toString("utf8");
}
