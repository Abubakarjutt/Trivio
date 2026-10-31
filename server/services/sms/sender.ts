// Messages shows the same sender in different shapes ("+92 300-1234567",
// "+923001234567", "HBL"/"hbl"); compare on a normalised form.
export function normalizeSender(id: string): string {
  return id.toLowerCase().replace(/[\s+\-()]/g, "");
}

export function makeSenderMatcher(senderIds: string[]): (sender: string) => boolean {
  const wanted = new Set(senderIds.map(normalizeSender).filter(Boolean));
  return (sender) => wanted.has(normalizeSender(sender));
}

export function isPhoneNumber(id: string): boolean {
  return /^\d{7,}$/.test(normalizeSender(id));
}
