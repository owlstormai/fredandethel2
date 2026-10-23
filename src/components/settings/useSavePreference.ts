"use client";
import { useCallback, useState } from "react";
import type { Preferences } from "@/lib/types";
import { usePreferences } from "@/components/providers/PreferencesProvider";
import { useToast } from "@/components/ui/Toast";

/** Wraps usePreferences().update with toast feedback and a pending flag. */
export function useSavePreference() {
  const { update } = usePreferences();
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);

  const save = useCallback(
    async (patch: Partial<Preferences>, description: string, key = Object.keys(patch).join(",")) => {
      setPending(key);
      try {
        await update(patch);
        toast({ title: "Saved", description, variant: "success", duration: 2500 });
        return true;
      } catch (err) {
        toast({
          title: "Couldn't save that",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "error",
        });
        return false;
      } finally {
        setPending(null);
      }
    },
    [update, toast],
  );

  return { save, pending };
}
