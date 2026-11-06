import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Radix tracks open layers (dialogs, sheets, popovers, menus) in module-level
// state. If two copies of these packages are installed, a popover opened inside
// a Sheet registers in a different stack than the Sheet: the Sheet keeps
// `pointer-events: none` on everything outside itself and steals focus, so the
// popover renders but cannot be clicked (the SMS review "Where did this money
// go?" category picker). package.json `overrides` pins them; this keeps it so.
const LAYER_PACKAGES = [
  "react-dismissable-layer",
  "react-focus-scope",
  "react-focus-guards",
  "react-portal",
  "react-presence",
];

describe("radix layer packages", () => {
  const lock = JSON.parse(readFileSync(join(process.cwd(), "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string }>;
  };

  it.each(LAYER_PACKAGES)("installs exactly one copy of @radix-ui/%s", (name) => {
    const copies = Object.keys(lock.packages).filter((path) =>
      path.endsWith(`node_modules/@radix-ui/${name}`)
    );
    expect(copies).toEqual([`node_modules/@radix-ui/${name}`]);
  });
});
