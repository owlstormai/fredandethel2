"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";
import { CheckIcon, CloseIcon, InfoIcon, WarningIcon } from "./icons";

export type ToastVariant = "default" | "success" | "error";

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  variant?: ToastVariant;
  /** ms; errors default to 9s, others to 4.5s. 0 = sticky. */
  duration?: number;
}

export interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
  toasts: ToastItem[];
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((list) => list.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      counter.current += 1;
      const id = counter.current;
      const variant = options.variant ?? "default";
      const duration = options.duration ?? (variant === "error" ? 9000 : 4500);
      setToasts((list) => [...list.slice(-3), { ...options, id, variant }]);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss, toasts }), [toast, dismiss, toasts]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): Pick<ToastContextValue, "toast" | "dismiss"> {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return { toast: ctx.toast, dismiss: ctx.dismiss };
}

const ICON: Record<ToastVariant, ReactNode> = {
  default: <InfoIcon />,
  success: <CheckIcon />,
  error: <WarningIcon />,
};

function ToastViewport({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[90] flex flex-col items-center gap-3 px-4 sm:bottom-6"
      aria-label="Notifications"
    >
      {/* Polite region for normal messages; errors are announced assertively. */}
      <div role="status" aria-live="polite" aria-atomic="false" className="contents">
        {toasts
          .filter((t) => t.variant !== "error")
          .map((t) => (
            <ToastCard key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
          ))}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="false" className="contents">
        {toasts
          .filter((t) => t.variant === "error")
          .map((t) => (
            <ToastCard key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
          ))}
      </div>
    </div>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const variant = item.variant ?? "default";
  return (
    <div
      data-testid="toast"
      data-variant={variant}
      className={cn(
        "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-[var(--radius-lg)] border bg-surface-solid/95 p-3 pl-4 shadow-2xl backdrop-blur-md animate-rise-in",
        variant === "success" && "border-success/40",
        variant === "error" && "border-danger/40",
        variant === "default" && "border-line-strong",
      )}
    >
      <span
        className={cn(
          "mt-1 flex size-8 shrink-0 items-center justify-center rounded-full [&>svg]:size-5",
          variant === "success" && "bg-success-soft text-success",
          variant === "error" && "bg-danger-soft text-danger",
          variant === "default" && "bg-accent-soft text-accent",
        )}
      >
        {ICON[variant]}
      </span>
      <div className="min-w-0 flex-1 py-1">
        <p className="text-[1.0625rem] font-medium leading-snug text-foreground">{item.title}</p>
        {item.description ? <p className="mt-0.5 text-[0.95rem] leading-snug text-muted">{item.description}</p> : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="flex size-12 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-foreground"
      >
        <CloseIcon />
      </button>
    </div>
  );
}
