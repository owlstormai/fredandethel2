"use client";
/**
 * Single seam between the voice components and the rest of the app.
 *
 * TODO(integration): the three lines marked STUB point at temporary stubs in
 * src/components/_stubs/. When Agent A's modules land, change ONLY these
 * import paths (the prop/hook signatures are identical):
 *   Orb                         -> "@/components/orb/Orb"
 *   useAudioLevel/useAudioLevelRef -> "@/components/orb/useAudioLevel"
 *   AppShell                    -> "@/components/layout/AppShell"
 */
export { Orb, type OrbProps } from "@/components/_stubs/Orb"; // STUB
export { useAudioLevel, useAudioLevelRef } from "@/components/_stubs/useAudioLevel"; // STUB
export { AppShell } from "@/components/_stubs/AppShell"; // STUB

export { usePreferences, useReducedMotion } from "@/components/providers";
export {
  Badge,
  Button,
  Card,
  Select,
  Spinner,
  SrOnly,
  cn,
  useToast,
  CheckIcon,
  CloseIcon,
  MicIcon,
  MicOffIcon,
  PauseIcon,
} from "@/components/ui";
