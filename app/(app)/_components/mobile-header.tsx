"use client";

import { Menu } from "lucide-react";

interface Props {
  orgName: string;
  onMenuClick: () => void;
}

export function MobileHeader({ orgName, onMenuClick }: Props) {
  return (
    <header
      className="sticky top-0 z-40 flex md:hidden items-center justify-between px-4 py-3 backdrop-blur-sm bg-background/95 border-b border-border/60"
    >
      <button
        aria-label="Open menu"
        onClick={onMenuClick}
        className="flex items-center justify-center rounded-lg p-1.5 text-primary transition-colors hover:bg-primary/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <Menu className="h-5 w-5" />
      </button>
      <span className="font-serif text-sm font-medium text-foreground truncate max-w-[180px]">{orgName}</span>
      <div className="w-8" aria-hidden />
    </header>
  );
}
