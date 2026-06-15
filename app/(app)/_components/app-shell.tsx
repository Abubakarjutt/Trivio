"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Sidebar } from "./sidebar";
import { MobileHeader } from "./mobile-header";
import { ChatPanel } from "./chat-panel";
import { trpc } from "@/lib/trpc/client";

interface Props {
  orgName: string;
  children: React.ReactNode;
}

export function AppShell({ orgName, children }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { data: org } = trpc.org.get.useQuery(undefined, { staleTime: 60_000 });
  const hasSampleData = org?.hasSampleData ?? false;

  return (
    <div className="flex h-screen overflow-hidden paper-grain" style={{ background: "#F4F3EF" }}>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:shrink-0" style={{ boxShadow: "4px 0 24px -8px rgba(8,27,18,0.35)" }}>
        <Sidebar orgName={orgName} hasSampleData={hasSampleData} />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="p-0 w-56">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar orgName={orgName} hasSampleData={hasSampleData} onNavigate={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="flex flex-1 flex-col overflow-hidden">
        <MobileHeader orgName={orgName} onMenuClick={() => setDrawerOpen(true)} />
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
      <ChatPanel />
    </div>
  );
}
