import { describe, expect, it } from "vitest";
import { anonymize } from "@/server/services/outreach/voice";

describe("anonymize", () => {
  it("hides the full name and each part, whatever the case", () => {
    expect(anonymize("Hi Jane, saw JANE DOE's post on evals. How do you grade?", "Jane Doe")).toBe(
      "Hi X, saw X's post on evals. How do you grade?"
    );
  });

  it("handles accented names (Review Focus #2)", () => {
    expect(anonymize("Hola José, gracias. NÚÑEZ here?", "José Núñez")).toBe(
      "Hola X, gracias. X here?"
    );
  });

  it("does not replace inside other words", () => {
    expect(anonymize("Janet asked about Al's plan", "Jan Al")).toBe("Janet asked about X's plan");
  });

  it("splits hyphenated names and drops punctuation stuck to parts", () => {
    expect(anonymize("Hi Mary, Mary-Jane here. Smith", "Mary-Jane Smith")).toBe("Hi X, X here. X");
    expect(anonymize("Doe said hi", "Jane Doe, MBA")).toBe("X said hi");
  });

  it("matches NFD text against an NFC name", () => {
    expect(anonymize("Hola Jose\u0301!", "Jos\u00e9 N\u00fa\u00f1ez")).toBe("Hola X!");
  });

  it("ignores one-letter name parts", () => {
    expect(anonymize("A plan for J", "J Smith")).toBe("A plan for J");
  });
});
