"use client";

import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CATEGORY_DEFINITIONS } from "@/server/services/statement-categorization.service";

const CATEGORIES = CATEGORY_DEFINITIONS.map((c) => c.name);

interface Props {
  value: string;
  onChange: (category: string) => void;
  triggerClassName?: string;
}

export function CategoryPicker({ value, onChange, triggerClassName }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = search.trim()
    ? CATEGORIES.filter((c) => c.toLowerCase().includes(search.toLowerCase()))
    : CATEGORIES;

  useEffect(() => {
    if (open) {
      setSearch("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn("flex items-center gap-0.5", triggerClassName)}>
          {value}
          <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0">
        <div className="flex items-center border-b px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0 mr-1.5" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No category found.</p>
          ) : (
            filtered.map((c) => (
              <button
                key={c}
                onClick={() => { onChange(c); setOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors",
                  value === c && "font-medium"
                )}
              >
                <Check className={cn("h-3.5 w-3.5 shrink-0", value === c ? "opacity-100" : "opacity-0")} />
                {c}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
