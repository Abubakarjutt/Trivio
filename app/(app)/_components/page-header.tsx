import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, action, className }: PageHeaderProps) {
  return (
    <div className={cn(
      "sticky top-0 z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
      "border-b border-border/40 px-8 py-4 backdrop-blur-sm bg-background/95",
      className
    )}>
      <div>
        <h1 className="font-serif text-2xl font-medium text-foreground leading-tight">{title}</h1>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5 tracking-wide">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
