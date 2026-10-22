"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { usePreferences } from "@/components/providers/PreferencesProvider";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Label } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

export function DeleteAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { setMe } = usePreferences();
  const { toast } = useToast();
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ready = confirmation.trim().toUpperCase() === "DELETE";

  async function confirm() {
    if (!ready) return;
    setDeleting(true);
    try {
      await apiFetch<void>("/api/account", { method: "DELETE" });
      setMe(null);
      toast({ title: "Your account and data were deleted", description: "Thank you for spending time with us.", variant: "success", duration: 8000 });
      router.push("/");
    } catch (err) {
      toast({ title: "Couldn't delete your account", description: err instanceof Error ? err.message : "Please try again.", variant: "error" });
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!deleting) {
          setConfirmation("");
          onClose();
        }
      }}
      locked={deleting}
      tone="danger"
      title="Delete my account and data"
      description="This removes your account, every memory, every conversation summary and your settings. It cannot be undone, and nothing is kept in backups we can restore from."
      initialFocusRef={inputRef}
      data-testid="delete-account-dialog"
      actions={
        <>
          <Button variant="secondary" size="lg" onClick={onClose} disabled={deleting}>
            Keep my account
          </Button>
          <Button variant="danger" size="lg" onClick={confirm} disabled={!ready} loading={deleting} loadingLabel="Deleting" data-testid="delete-account-confirm">
            Delete everything
          </Button>
        </>
      }
    >
      <Field hint="Type the word in capital letters to confirm.">
        <Label>Type DELETE to continue</Label>
        <Input
          ref={inputRef}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          data-testid="delete-account-input"
          onKeyDown={(e) => {
            if (e.key === "Enter" && ready) void confirm();
          }}
        />
      </Field>
    </Dialog>
  );
}
