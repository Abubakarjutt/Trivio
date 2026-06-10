import { Fraunces, Outfit } from "next/font/google";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  style: ["normal", "italic"],
  weight: ["300", "400", "500", "600", "700"],
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["300", "400", "500", "600", "700"],
});

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${fraunces.variable} ${outfit.variable} min-h-screen`} style={{ fontFamily: "var(--font-sans)" }}>
      {children}
    </div>
  );
}
