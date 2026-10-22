"use client";
import { useState, type FormEvent } from "react";
import type { CompanionVoice, HumorLevel, Profile } from "@/lib/types";
import { VoiceChoice, type VoiceOption } from "@/components/landing/VoiceChoice";
import { usePreferences } from "@/components/providers/PreferencesProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Label } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useToast } from "@/components/ui/Toast";
import { useSavePreference } from "./useSavePreference";

const HUMOR_OPTIONS: Array<{ value: HumorLevel; label: string; description: string }> = [
  { value: "off", label: "Off", description: "No jokes. Warm, but straight to the point." },
  { value: "gentle", label: "Gentle", description: "A light touch now and then, never forced." },
  { value: "playful", label: "Playful", description: "More wordplay, teasing and callbacks." },
];

export function CompanionSection({ voices, profile }: { voices: readonly VoiceOption[]; profile: Profile }) {
  const { preferences, updateProfile } = usePreferences();
  const { toast } = useToast();
  const { save } = useSavePreference();
  const [name, setName] = useState(profile.preferredName ?? "");
  const [savingName, setSavingName] = useState(false);
  const [savingVoice, setSavingVoice] = useState(false);

  async function changeVoice(voice: CompanionVoice) {
    if (voice === profile.companionVoice) return;
    setSavingVoice(true);
    try {
      await updateProfile({ companionVoice: voice });
      const label = voices.find((v) => v.value === voice)?.label ?? voice;
      toast({ title: "Saved", description: `You'll talk with ${label} from your next conversation.`, variant: "success", duration: 3000 });
    } catch (err) {
      toast({ title: "Couldn't change voice", description: err instanceof Error ? err.message : "Please try again.", variant: "error" });
    } finally {
      setSavingVoice(false);
    }
  }

  async function saveName(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length > 60) {
      toast({ title: "That name is a bit long", description: "Please keep it under 60 characters.", variant: "error" });
      return;
    }
    setSavingName(true);
    try {
      await updateProfile({ preferredName: trimmed ? trimmed : null });
      toast({ title: "Saved", description: trimmed ? `We'll call you ${trimmed}.` : "Name cleared.", variant: "success", duration: 2500 });
    } catch (err) {
      toast({ title: "Couldn't save your name", description: err instanceof Error ? err.message : "Please try again.", variant: "error" });
    } finally {
      setSavingName(false);
    }
  }

  return (
    <Card title="Companion" description="Who you talk with, and how much they joke around." id="companion">
      <div className="flex flex-col gap-8">
        <VoiceChoice voices={voices} value={profile.companionVoice} onChange={changeVoice} label="Voice" disabled={savingVoice} testIdPrefix="pref-voice" />

        <form onSubmit={saveName} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field className="flex-1" hint="Your companion uses this name. Leave it blank and they'll ask.">
            <Label optional>What should we call you?</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="given-name" data-testid="pref-name" />
          </Field>
          <Button type="submit" loading={savingName} disabled={name.trim() === (profile.preferredName ?? "")} className="sm:mb-[1.95rem]" data-testid="pref-name-save">
            Save name
          </Button>
        </form>

        <SegmentedControl
          label="Humor"
          description={
            <>
              Humor is a feature, not a filler. You can also just say <em>&ldquo;less joking&rdquo;</em> while talking.
            </>
          }
          value={preferences.humorLevel}
          options={HUMOR_OPTIONS}
          optionTestId={(v) => `pref-humor-${v}`}
          onChange={(v) => {
            if (v !== preferences.humorLevel) void save({ humorLevel: v }, `Humor set to ${HUMOR_OPTIONS.find((o) => o.value === v)?.label.toLowerCase()}.`);
          }}
        />
      </div>
    </Card>
  );
}
