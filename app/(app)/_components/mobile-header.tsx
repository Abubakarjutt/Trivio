"use client";

import { Menu } from "lucide-react";

interface Props {
  orgName: string;
  onMenuClick: () => void;
}

export function MobileHeader({ orgName, onMenuClick }: Props) {
  return (
    <header className="sticky top-0 z-40 flex md:hidden items-center justify-between border-b bg-white px-4 py-3">
      <button
        aria-label="Open menu"
        onClick={onMenuClick}
        className="flex items-center justify-center rounded-md p-1.5 text-gray-500 hover:bg-gray-100 transition-colors"
      >
        <Menu className="h-5 w-5" />
      </button>
      <span className="text-sm font-semibold text-gray-900 truncate max-w-[180px]">{orgName}</span>
      <div className="w-8" aria-hidden />
    </header>
  );
}
