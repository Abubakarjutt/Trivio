"use client";

// First-run shortcut: set this computer up from a Google Drive backup instead
// of creating a new account. Desktop app only. /register is reachable by a
// logged-out user who already has books here, so the dialog always asks to
// confirm replacing this computer's data.

import { useEffect, useState } from "react";
import { getBackup } from "@/lib/desktop";
import { RestoreDialog } from "./restore-dialog";

export function RestoreFromDriveLink() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const b = getBackup();
    if (b) void b.status().then((s) => setAvailable(s.configured)).catch(() => {});
  }, []);
  if (!available) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full text-center text-sm font-medium text-green-700 hover:underline"
      >
        Restore from Google Drive
      </button>
      <RestoreDialog open={open} onOpenChange={setOpen} confirmReplace />
    </>
  );
}
