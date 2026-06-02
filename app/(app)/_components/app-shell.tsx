"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Sidebar } from "./sidebar";
import { MobileHeader } from "./mobile-header";
import { ChatPanel } from "./chat-panel";

interface Props {
  orgName: string;
  children: React.ReactNode;
}

export function AppShell({ orgName, children }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:shrink-0 shadow-[1px_0_0_0_hsl(220_16%_88%)]">
        <Sidebar orgName={orgName} />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="p-0 w-56">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar orgName={orgName} onNavigate={() => setDrawerOpen(false)} />
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
