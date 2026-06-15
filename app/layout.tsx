import type { Metadata } from "next";
import { Fraunces, DM_Sans, DM_Mono } from "next/font/google";
import "./globals.css";
import { TRPCReactProvider } from "@/lib/trpc/provider";
import { ToastProvider, ToastViewport } from "@/components/ui/toast";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Trivio — Accounting made simple",
  description: "Smart accounting for freelancers and small businesses",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${dmSans.variable} ${dmMono.variable}`}>
      <body>
        <TRPCReactProvider>
          <ToastProvider>
            {children}
            <ToastViewport />
          </ToastProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
