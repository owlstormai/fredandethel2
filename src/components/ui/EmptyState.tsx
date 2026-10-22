import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-line-strong px-6 py-10 text-center", className)}>
      {icon ? <div className="mb-1 flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent [&>svg]:size-7">{icon}</div> : null}
      <p className="text-[1.15rem] font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-md text-[1rem] leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
