"use client";
import { createContext, forwardRef, useContext, useId, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

interface FieldContextValue {
  id: string;
  hintId?: string;
  errorId?: string;
  invalid: boolean;
}
const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldProps {
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  id?: string;
}

/** Wires label, control, hint and error together with ids and aria attributes. */
export function Field({ children, hint, error, className, id }: FieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  return (
    <FieldContext.Provider value={{ id: fieldId, hintId, errorId, invalid: Boolean(error) }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        {children}
        {hint ? (
          <p id={hintId} className="text-[0.95rem] text-muted">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} role="alert" className="flex items-start gap-2 text-[0.95rem] font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export function Label({ className, children, optional, ...rest }: LabelHTMLAttributes<HTMLLabelElement> & { optional?: boolean }) {
  const ctx = useContext(FieldContext);
  return (
    <label htmlFor={ctx?.id} className={cn("text-[1.0625rem] font-medium text-foreground", className)} {...rest}>
      {children}
      {optional ? <span className="ml-2 text-[0.9rem] font-normal text-subtle">(optional)</span> : null}
    </label>
  );
}

const controlClass =
  "w-full min-h-14 rounded-[var(--radius-md)] border bg-surface-2 px-4 py-3 text-[1.125rem] text-foreground placeholder:text-subtle transition-colors duration-150 hover:border-white/30 disabled:opacity-50 aria-invalid:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  const ctx = useContext(FieldContext);
  return (
    <input
      ref={ref}
      id={ctx?.id}
      aria-describedby={[ctx?.hintId, ctx?.errorId].filter(Boolean).join(" ") || undefined}
      aria-invalid={ctx?.invalid || undefined}
      className={cn(controlClass, ctx?.invalid ? "border-danger" : "border-line-strong", className)}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  const ctx = useContext(FieldContext);
  return (
    <textarea
      ref={ref}
      id={ctx?.id}
      aria-describedby={[ctx?.hintId, ctx?.errorId].filter(Boolean).join(" ") || undefined}
      aria-invalid={ctx?.invalid || undefined}
      className={cn(controlClass, "min-h-[7rem] resize-y leading-relaxed", ctx?.invalid ? "border-danger" : "border-line-strong", className)}
      {...rest}
    />
  );
});
