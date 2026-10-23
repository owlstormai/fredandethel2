"use client";
/**
 * Single seam between the voice components and the rest of the app. Everything
 * the voice UI needs from other modules is re-exported here so a path change
 * (or a test mock) touches one file.
 */
export { Orb, type OrbProps } from "@/components/orb/Orb";
export { useAudioLevel, useAudioLevelRef } from "@/components/orb/useAudioLevel";
export { AppShell } from "@/components/layout/AppShell";

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
