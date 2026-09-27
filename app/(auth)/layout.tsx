import { frauncesDisplay, outfit } from "../fonts";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${frauncesDisplay.variable} ${outfit.variable} min-h-screen`} style={{ fontFamily: "var(--font-sans)" }}>
      {children}
    </div>
  );
}
