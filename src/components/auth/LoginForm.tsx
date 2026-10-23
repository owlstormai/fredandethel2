"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api/client";
import { loginSchema, type AuthResponse } from "@/lib/api/contracts";
import { usePreferences } from "@/components/providers/PreferencesProvider";
import { Button } from "@/components/ui/Button";
import { Field, Input, Label } from "@/components/ui/Field";
import { describeAuthError } from "./authErrors";
import { PasswordInput } from "./PasswordInput";

type FieldErrors = Partial<Record<"email" | "password", string>>;

export function LoginForm({ redirectTo }: { redirectTo?: string } = {}) {
  const router = useRouter();
  const { refresh } = usePreferences();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "email" && !next.email) next.email = "Please enter a valid email address.";
        if (key === "password" && !next.password) next.password = "Please enter your password.";
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await apiFetch<AuthResponse>("/api/auth/login", { method: "POST", json: parsed.data });
      await refresh();
      router.push(redirectTo ?? "/talk");
    } catch (err) {
      setFormError(describeAuthError(err, "login"));
      setSubmitting(false);
    }
  }

  return (
    <div className="panel w-full max-w-lg p-6 sm:p-10">
      <h1 className="text-[2rem] font-semibold leading-tight">Welcome back</h1>
      <p className="mt-2 text-[1.0625rem] text-muted">Sign in to pick up where you left off.</p>

      <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-5">
        <Field error={errors.email}>
          <Label>Email</Label>
          <Input
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="login-email"
            required
          />
        </Field>
        <Field error={errors.password}>
          <Label>Password</Label>
          <PasswordInput name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password" required />
        </Field>

        {formError ? (
          <p role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger-soft px-4 py-3 text-[1rem] text-danger" data-testid="login-error">
            {formError}
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="xl" fullWidth loading={submitting} loadingLabel="Signing in" data-testid="login-submit">
          Sign in
        </Button>
      </form>

      <div className="mt-8 flex flex-col gap-3 border-t border-line pt-6 text-[1.0625rem] text-muted">
        <p>
          New here?{" "}
          <Link href="/signup" className="font-medium text-accent underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
        <p>
          Just looking?{" "}
          <Link href="/#demo" className="font-medium text-accent underline-offset-4 hover:underline">
            Try a demo profile
          </Link>{" "}
          <span className="text-subtle">(simulated, no account needed)</span>
        </p>
      </div>
    </div>
  );
}
