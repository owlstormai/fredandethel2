import type { MemoryCategory, MemoryStatus } from "@/lib/types";

export const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  identity: "About you",
  family: "Family",
  friends: "Friends",
  interest: "Interests",
  routine: "Routine",
  preference: "Preferences",
  story: "Stories",
  health: "Health",
  finances: "Finances",
  grief: "Loss & grief",
  other: "Other",
};

export const CATEGORY_ORDER: MemoryCategory[] = ["identity", "family", "friends", "interest", "routine", "preference", "story", "health", "finances", "grief", "other"];

export const STATUS_ORDER: MemoryStatus[] = ["confirmed", "reported", "summarized", "inferred"];

export const STATUS_HEADING: Record<MemoryStatus, { title: string; description: string; badge: string }> = {
  confirmed: {
    title: "You asked me to remember",
    description: "Things you explicitly agreed to save. Your companion can bring these up.",
    badge: "Confirmed",
  },
  reported: {
    title: "You told me, not yet confirmed",
    description: "Mentioned in conversation but you weren't asked to confirm. Still used, but you can confirm or remove them.",
    badge: "Mentioned",
  },
  summarized: {
    title: "From conversation summaries",
    description: "Short notes written after a conversation ends, so the next one can pick up the thread.",
    badge: "Summary",
  },
  inferred: {
    title: "My guesses — not used until you confirm",
    description: "Things your companion thinks might be true. They are never used in conversation unless you confirm them.",
    badge: "Guess",
  },
};

export function formatMemoryDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
