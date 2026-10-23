"use client";
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { IconButton } from "./IconButton";
import { CloseIcon } from "./icons";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Footer actions (buttons). */
  actions?: ReactNode;
  /** "danger" tints the title for destructive confirmations. */
  tone?: "default" | "danger";
  size?: "md" | "lg";
  /** Prevent closing via Escape/backdrop (e.g. while a request is in flight). */
  locked?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  "data-testid"?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const noopSubscribe = () => () => {};

/**
 * Modal dialog: portal to <body>, focus trapped, Escape closes, focus restored
 * to the opener on close, background scroll locked, aria-modal semantics.
 */
export function Dialog({ open, onClose, title, description, children, actions, tone = "default", size = "md", locked, initialFocusRef, className, ...rest }: DialogProps) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => !el.hidden && el.getAttribute("aria-hidden") !== "true" && !el.closest("[hidden]"),
      );

    const raf = requestAnimationFrame(() => {
      const preferred = initialFocusRef?.current;
      if (preferred) preferred.focus();
      else {
        const list = focusables();
        // Prefer the first non-close control so Escape/close isn't the default target.
        const first = list.find((el) => el.dataset.dialogClose !== "true") ?? list[0];
        (first ?? panel)?.focus();
      }
    });

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (locked) return;
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, locked, initialFocusRef]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center sm:p-8" role="presentation">
      <div
        className="absolute inset-0 bg-[#03060c]/75 backdrop-blur-sm animate-fade-in"
        aria-hidden="true"
        onClick={() => {
          if (!locked) onCloseRef.current();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        tabIndex={-1}
        data-testid={rest["data-testid"]}
        className={cn(
          "relative w-full rounded-[var(--radius-xl)] border border-line-strong bg-surface-solid p-6 shadow-2xl outline-none animate-rise-in sm:p-8",
          size === "md" ? "max-w-lg" : "max-w-2xl",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${id}-title`} className={cn("text-[1.5rem] font-semibold leading-tight", tone === "danger" ? "text-danger" : "text-foreground")}>
            {title}
          </h2>
          <IconButton label="Close dialog" icon={<CloseIcon />} onClick={() => onCloseRef.current()} disabled={locked} data-dialog-close="true" className="-mr-2 -mt-2" />
        </div>
        {description ? (
          <p id={`${id}-desc`} className="mt-3 text-[1.0625rem] leading-relaxed text-muted">
            {description}
          </p>
        ) : null}
        {children ? <div className="mt-5">{children}</div> : null}
        {actions ? <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
