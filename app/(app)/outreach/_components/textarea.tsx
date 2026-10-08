import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Same look as the CRM notes field (app/(app)/crm/leads/page.tsx).
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "border-input bg-background ring-offset-background w-full rounded-md border px-3 py-2 text-sm",
      "placeholder:text-muted-foreground focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
      "min-h-[80px]",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
