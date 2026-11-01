"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface PendingCategoryChange {
  id: string;
  category: string;
  label: string;
}

export function RememberRuleDialog({
  change,
  onConfirm,
  onCancel,
  busy,
}: {
  change: PendingCategoryChange | null;
  onConfirm: (remember: boolean) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [remember, setRemember] = useState(true);
  useEffect(() => {
    if (change) setRemember(true);
  }, [change]);
  return (
    <Dialog
      open={change !== null}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change to {change?.category}</DialogTitle>
        </DialogHeader>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>
            Always use <strong>{change?.category}</strong> for {change?.label}
          </span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(remember)} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
