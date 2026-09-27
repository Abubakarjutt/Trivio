// Fonts ship with the app (latin subset, as Google Fonts serves them) instead
// of next/font/google, which downloads them on every build — a bad response
// from Google failed release builds.
import localFont from "next/font/local";

export const fraunces = localFont({
  src: [
    { path: "./fraunces.woff2", weight: "300 700", style: "normal" },
    { path: "./fraunces-italic.woff2", weight: "300 700", style: "italic" },
  ],
  variable: "--font-serif",
  display: "swap",
});

/** Same Fraunces, under the name the sign-in pages use. */
export const frauncesDisplay = localFont({
  src: [
    { path: "./fraunces.woff2", weight: "300 700", style: "normal" },
    { path: "./fraunces-italic.woff2", weight: "300 700", style: "italic" },
  ],
  variable: "--font-display",
});

export const dmSans = localFont({
  src: [{ path: "./dm-sans.woff2", weight: "300 700", style: "normal" }],
  variable: "--font-sans",
  display: "swap",
});

export const dmMono = localFont({
  src: [
    { path: "./dm-mono-300.woff2", weight: "300", style: "normal" },
    { path: "./dm-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./dm-mono-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
});

export const outfit = localFont({
  src: [{ path: "./outfit.woff2", weight: "300 700", style: "normal" }],
  variable: "--font-sans",
});
