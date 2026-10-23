/**
 * Keyword classifier for the shape (kind/category) and sensitivity of a
 * statement. Pure, no I/O. Shared by the demo brain (shaping "remember that…"
 * requests) and the summary pipeline (labelling summaries and dropping
 * sensitive statements when the user has not consented to sensitive memory).
 * Sensitive = health, finances, grief, family conflict (AGENTS.md consent scopes).
 */
import type { MemoryCategory, MemoryKind, MemorySensitivity } from "@/lib/types";

export interface MemoryShape {
  kind: Exclude<MemoryKind, "summary">;
  category: MemoryCategory;
  sensitivity: MemorySensitivity;
}

export const SENSITIVE_CATEGORIES: ReadonlySet<MemoryCategory> = new Set(["health", "finances", "grief"]);

const SHAPE_RULES: Array<{ re: RegExp; category: MemoryCategory }> = [
  { re: /\b(died|passed away|funeral|late (wife|husband)|widow|grie|mourn|lost my)\b/i, category: "grief" },
  { re: /\b(doctor|nurse|hospital|pain|medication|pills?|prescription|surgery|blood pressure|diabet|arthritis|knee|hip|heart|cancer|diagnos|appointment with|dentist|hearing aid|cane|walker)\b/i, category: "health" },
  { re: /\b(money|bank|pension|bills?|rent|mortgage|savings|debt|afford|budget|social security|insurance|taxes)\b/i, category: "finances" },
  { re: /\b(granddaughter|grandson|grandchild|grandkids?|daughter|son|wife|husband|sister|brother|mother|father|mom|dad|niece|nephew|cousin|kids?|children|grandma|grandpa|family)\b/i, category: "family" },
  { re: /\b(friend|neighbou?r|buddy|pal|church group|club|bridge group)\b/i, category: "friends" },
  { re: /\b(every (morning|day|evening|night|week|sunday|saturday)|each morning|usually|always|routine|breakfast|lunch|dinner at|bedtime|wake up at|walk every)\b/i, category: "routine" },
  { re: /\b(prefer|favou?rite|favorite|rather|instead of|can'?t stand|don'?t like|hate|love it when|never call me|call me)\b/i, category: "preference" },
  { re: /\b(love|enjoy|like to|hobby|garden|crossword|puzzle|jazz|music|records?|woodwork|fishing|golf|knitting|quilting|baking|cooking|reading|books?|painting|birds?|walking|dancing|church|choir|chess|cards|bingo|baseball|football|browns|guardians)\b/i, category: "interest" },
];

/** Family conflict has no category of its own but is sensitive all the same. */
const FAMILY_CONFLICT_RE =
  /\b(estranged|not (?:been )?speaking|haven'?t spoken|stopped speaking|fell out|falling out|fall(?:ing)? out with|argument with|argued with|fight(?:ing)? with|divorc\w*|custody|won'?t (?:talk|speak) to|cut (?:me|him|her|us) off|disowned|restraining order|family (?:feud|dispute|conflict|trouble))\b/i;

export function inferMemoryShape(content: string): MemoryShape {
  const category = SHAPE_RULES.find((r) => r.re.test(content))?.category ?? "other";
  const sensitivity: MemorySensitivity = SENSITIVE_CATEGORIES.has(category) || FAMILY_CONFLICT_RE.test(content) ? "sensitive" : "normal";
  let kind: MemoryShape["kind"] = "fact";
  if (category === "interest") kind = "interest";
  else if (category === "family" || category === "friends") kind = "relationship";
  else if (category === "preference") kind = "preference";
  else if (content.length > 120) kind = "story";
  return { kind, category, sensitivity };
}

/** "sensitive" when the text carries health, finances, grief or family-conflict signals. */
export function classifySensitivity(text: string): MemorySensitivity {
  return inferMemoryShape(text).sensitivity;
}
