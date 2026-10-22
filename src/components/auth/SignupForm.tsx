"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api/client";
import { signupSchema, type AuthResponse } from "@/lib/api/contracts";
import type { CompanionVoice } from "@/lib/types";
import { VoiceChoice, type VoiceOption } from "@/components/landing/VoiceChoice";
import { usePreferences } from "@/components/providers/PreferencesProvider";
import { Button } from "@/components/ui/Button";
import { Field, Input, Label } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { describeAuthError } from "./authErrors";
import { PasswordInput } from "./PasswordInput";

type FieldErrors = Partial<Record<"email" | "password" | "preferredName", string>>;

export interface SignupFormProps {
  voices: readonly VoiceOption[];
  initialVoice?: CompanionVoice;
}

export function SignupForm({ voices, initialVoice }: SignupFormProps) {
  const router = useRouter();
  const { refresh } = usePreferences();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [voice, setVoice] = useState<CompanionVoice>(initialVoice ?? "fred");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = signupSchema.safeParse({
      email,
      password,
      preferredName: preferredName.trim() ? preferredName : undefined,
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "email" && !next.email) next.email = "Please enter a valid email address.";
        if (key === "password" && !next.password) next.password = "Please use at least 10 characters. A short sentence works well.";
        if (key === "preferredName" && !next.preferredName) next.preferredName = "Please keep your name under 60 characters.";
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await apiFetch<AuthResponse>("/api/auth/signup", { method: "POST", json: parsed.data });
      try {
        await apiFetch("/api/profile", { method: "PATCH", json: { companionVoice: voice } });
      } catch {
        toast({ title: "Account created", description: "We couldn't save your voice choice yet — you can set it in Settings.", variant: "default" });
      }
      await refresh();
      router.push("/talk");
    } catch (err) {
      setFormError(describeAuthError(err, "signup"));
      setSubmitting(false);
    }
  }

  return (
    <div className="panel w-full max-w-xl p-6 sm:p-10">
      <h1 className="text-[2rem] font-semibold leading-tight">Create your account</h1>
      <p className="mt-2 text-[1.0625rem] text-muted">A few details, and you can start talking.</p>

      <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-6">
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
            data-testid="signup-email"
            required
          />
        </Field>
        <Field error={errors.password} hint="At least 10 characters. A short sentence you'll remember works well.">
          <Label>Password</Label>
          <PasswordInput name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="signup-password" required />
        </Field>
        <Field error={errors.preferredName} hint="Your companion will use this. You can change it later or just say it out loud.">
          <Label optional>What should we call you?</Label>
          <Input type="text" name="preferredName" autoComplete="given-name" maxLength={60} value={preferredName} onChange={(e) => setPreferredName(e.target.value)} data-testid="signup-name" />
        </Field>

        <VoiceChoice voices={voices} value={voice} onChange={setVoice} label="Who would you like to talk with?" testIdPrefix="signup-voice" />

        {formError ? (
          <p role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger-soft px-4 py-3 text-[1rem] text-danger" data-testid="signup-error">
            {formError}
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="xl" fullWidth loading={submitting} loadingLabel="Creating your account" data-testid="signup-submit">
          Create account
        </Button>
        <p className="text-[0.95rem] leading-relaxed text-subtle">
          Memory is off until you turn it on. Nothing is remembered without your say-so.
        </p>
      </form>

      <div className="mt-8 flex flex-col gap-3 border-t border-line pt-6 text-[1.0625rem] text-muted">
        <p>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent underline-offset-4 hover:underline">
            Sign in
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
