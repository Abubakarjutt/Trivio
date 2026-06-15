"use client";

import { Menu } from "lucide-react";

interface Props {
  orgName: string;
  onMenuClick: () => void;
}

export function MobileHeader({ orgName, onMenuClick }: Props) {
  return (
    <header
      className="sticky top-0 z-40 flex md:hidden items-center justify-between px-4 py-3 backdrop-blur-sm"
      style={{ background: "rgba(244,243,239,0.97)", borderBottom: "1px solid rgba(228,225,216,0.8)" }}
    >
      <button
        aria-label="Open menu"
        onClick={onMenuClick}
        className="flex items-center justify-center rounded-lg p-1.5 transition-colors"
        style={{ color: "#1A6644" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(26,102,68,0.07)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <Menu className="h-5 w-5" />
      </button>
      <span className="font-serif text-sm font-medium text-foreground truncate max-w-[180px]">{orgName}</span>
      <div className="w-8" aria-hidden />
    </header>
  );
}
