"use client";
import { useState, type InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/Field";
import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";

export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className="pr-16" {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute right-1.5 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-foreground"
      >
        {visible ? <EyeOffIcon className="size-6" /> : <EyeIcon className="size-6" />}
      </button>
    </div>
  );
}
