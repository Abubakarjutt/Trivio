"use client";

import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CATEGORY_DEFINITIONS } from "@/server/services/statement-categorization.service";

const CATEGORIES = CATEGORY_DEFINITIONS.map((c) => c.name);

const DOT_COLOR: Record<string, string> = {
  "Food & Dining":     "bg-violet-400",
  "Transport":         "bg-sky-400",
  "Shopping":          "bg-amber-400",
  "Entertainment":     "bg-pink-400",
  "Health & Fitness":  "bg-emerald-400",
  "Utilities":         "bg-yellow-400",
  "Travel":            "bg-cyan-400",
  "Housing":           "bg-orange-400",
  "Education":         "bg-indigo-400",
  "Personal Care":     "bg-fuchsia-400",
  "Business Services": "bg-slate-400",
  "Financial":         "bg-teal-400",
  "Income":            "bg-green-400",
  "Transfer":          "bg-blue-400",
  "Other":             "bg-gray-400",
};

const ACCENT_HOVER: Record<string, string> = {
  "Food & Dining":     "hover:border-l-violet-400",
  "Transport":         "hover:border-l-sky-400",
  "Shopping":          "hover:border-l-amber-400",
  "Entertainment":     "hover:border-l-pink-400",
  "Health & Fitness":  "hover:border-l-emerald-400",
  "Utilities":         "hover:border-l-yellow-400",
  "Travel":            "hover:border-l-cyan-400",
  "Housing":           "hover:border-l-orange-400",
  "Education":         "hover:border-l-indigo-400",
  "Personal Care":     "hover:border-l-fuchsia-400",
  "Business Services": "hover:border-l-slate-400",
  "Financial":         "hover:border-l-teal-400",
  "Income":            "hover:border-l-green-400",
  "Transfer":          "hover:border-l-blue-400",
  "Other":             "hover:border-l-gray-400",
};

const ACCENT_ACTIVE: Record<string, string> = {
  "Food & Dining":     "border-l-violet-400",
  "Transport":         "border-l-sky-400",
  "Shopping":          "border-l-amber-400",
  "Entertainment":     "border-l-pink-400",
  "Health & Fitness":  "border-l-emerald-400",
  "Utilities":         "border-l-yellow-400",
  "Travel":            "border-l-cyan-400",
  "Housing":           "border-l-orange-400",
  "Education":         "border-l-indigo-400",
  "Personal Care":     "border-l-fuchsia-400",
  "Business Services": "border-l-slate-400",
  "Financial":         "border-l-teal-400",
  "Income":            "border-l-green-400",
  "Transfer":          "border-l-blue-400",
  "Other":             "border-l-gray-400",
};

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
          <ChevronDown className={cn("h-3 w-3 opacity-50 shrink-0 transition-transform duration-200", open && "rotate-180")} />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-56 p-0 shadow-lg border-border/60 rounded-xl overflow-hidden">
        {/* Search bar */}
        <div className="p-2">
          <div className={cn(
            "flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-all duration-150",
            "bg-muted/60 border border-transparent",
            "focus-within:bg-background focus-within:border-border focus-within:shadow-sm"
          )}>
            <Search className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0 transition-colors duration-150 group-focus-within:text-foreground" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search categories…"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 min-w-0"
            />
            {search && (
              <button
                onClick={() => { setSearch(""); inputRef.current?.focus(); }}
                className="text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Divider + count */}
        <div className="flex items-center gap-2 px-3 pb-1">
          <div className="flex-1 h-px bg-border/50" />
          <span className="text-[10px] text-muted-foreground/40 tabular-nums shrink-0">
            {filtered.length}/{CATEGORIES.length}
          </span>
        </div>

        {/* Category list */}
        <div className="max-h-52 overflow-y-auto pb-1.5 px-1.5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 gap-1.5">
              <Search className="h-5 w-5 text-muted-foreground/20" />
              <p className="text-xs text-muted-foreground/50">No match for &ldquo;{search}&rdquo;</p>
            </div>
          ) : (
            filtered.map((c) => {
              const isSelected = value === c;
              return (
                <button
                  key={c}
                  onClick={() => { onChange(c); setOpen(false); }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md pl-2 pr-2 py-1.5 text-xs transition-all duration-100",
                    "border-l-2 border-l-transparent",
                    "hover:bg-accent/60",
                    ACCENT_HOVER[c] ?? "hover:border-l-gray-400",
                    isSelected && cn("bg-accent/40 font-medium", ACCENT_ACTIVE[c] ?? "border-l-gray-400"),
                  )}
                >
                  <span className={cn("h-2 w-2 rounded-full shrink-0 transition-transform duration-100", DOT_COLOR[c] ?? "bg-gray-400", isSelected && "scale-110")} />
                  <span className="flex-1 text-left truncate">{c}</span>
                  {isSelected && <Check className="h-3 w-3 shrink-0 opacity-60" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
