import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-xl border border-input bg-white px-3 py-2 text-sm",
          "shadow-[0_1px_2px_0_rgb(0,0,0,0.05),0_0_0_1px_rgb(0,0,0,0.02)]",
          "placeholder:text-muted-foreground/50",
          "transition-all duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-0 focus-visible:border-primary/60",
          "hover:border-border",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted/50",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
