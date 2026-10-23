import type { ReactNode } from "react";

/** Visually hidden, still read by screen readers. */
export function SrOnly({ children, as: Tag = "span", id }: { children: ReactNode; as?: "span" | "div" | "p"; id?: string }) {
  return (
    <Tag id={id} className="sr-only">
      {children}
    </Tag>
  );
}
