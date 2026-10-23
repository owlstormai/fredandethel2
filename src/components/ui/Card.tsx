import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "section" | "div" | "article";
  padding?: "md" | "lg";
  headingLevel?: 2 | 3;
}

export function Card({ title, description, actions, as: Tag = "section", padding = "lg", headingLevel = 2, className, children, ...rest }: CardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <Tag className={cn("panel", padding === "lg" ? "p-6 sm:p-8" : "p-4 sm:p-5", className)} {...rest}>
      {title || actions ? (
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <Heading className="text-[1.35rem] font-semibold leading-tight text-foreground">{title}</Heading> : null}
            {description ? <p className="mt-1.5 text-[1rem] leading-relaxed text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </Tag>
  );
}
