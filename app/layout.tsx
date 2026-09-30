import type { Metadata } from "next";
import { fraunces, dmSans, dmMono } from "./fonts";
import "./globals.css";
import { TRPCReactProvider } from "@/lib/trpc/provider";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";

export const metadata: Metadata = {
  title: "Trivio — Accounting made simple",
  description: "Smart accounting for freelancers and small businesses",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${dmSans.variable} ${dmMono.variable}`}>
      <body>
        {/* Hidden everywhere except the macOS desktop app, whose shell shows it
            as the window's drag handle (desktop/main.ts). First in the body so
            the controls after it can opt out of dragging. */}
        <div className="desktop-drag-strip" aria-hidden="true" />
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <TRPCReactProvider>
          {children}
          <Toaster />
          {/* Many pages report success/errors via sonner's toast() — it needs this. */}
          <SonnerToaster richColors position="bottom-right" />
        </TRPCReactProvider>
      </body>
    </html>
  );
}
