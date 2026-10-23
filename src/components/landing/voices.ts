/** Server-side helper: voice cards data from the model registry (no env leaks to the client). */
import { COMPANION_VOICES } from "@/lib/ai/models";
import type { CompanionVoice } from "@/lib/types";
import type { VoiceOption } from "./VoiceChoice";

export function voiceOptions(): VoiceOption[] {
  return (Object.keys(COMPANION_VOICES) as CompanionVoice[]).map((value) => ({
    value,
    label: COMPANION_VOICES[value].label,
    description: COMPANION_VOICES[value].description,
  }));
}
