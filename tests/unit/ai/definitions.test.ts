import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  companionToolDefinitions,
  getToolDefinition,
  isToolName,
  TOOL_NAMES,
  toolArgumentSchemas,
  type ToolName,
} from "@/lib/ai/tools/definitions";

interface ObjectSchema {
  type: string;
  properties: Record<string, { type?: string; enum?: string[]; description?: string }>;
  required?: string[];
  additionalProperties?: boolean;
}

describe("companionToolDefinitions", () => {
  it("returns every tool with search_web only when enabled", () => {
    const withSearch = companionToolDefinitions({ searchEnabled: true }).map((t) => t.name);
    const withoutSearch = companionToolDefinitions({ searchEnabled: false }).map((t) => t.name);
    expect(withSearch).toEqual([...TOOL_NAMES]);
    expect(withoutSearch).toEqual(TOOL_NAMES.filter((n) => n !== "search_web"));
  });

  it("produces GA function-tool shapes: type function, name, description, top-level JSON Schema", () => {
    for (const tool of companionToolDefinitions({ searchEnabled: true })) {
      expect(tool.type).toBe("function");
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(20);
      const params = tool.parameters as unknown as ObjectSchema;
      expect(params.type).toBe("object");
      expect(params.properties).toBeTypeOf("object");
      expect(Array.isArray(params.required)).toBe(true);
      expect(params.additionalProperties).toBe(false);
      for (const name of params.required ?? []) expect(Object.keys(params.properties)).toContain(name);
      // Realtime GA: no nested { function: {...} } wrapper and no "strict" beta key.
      expect((tool as unknown as Record<string, unknown>).function).toBeUndefined();
      expect((tool as unknown as Record<string, unknown>).strict).toBeUndefined();
    }
  });

  it("JSON Schema and zod schemas agree on properties, required keys and enums", () => {
    for (const name of TOOL_NAMES) {
      const json = getToolDefinition(name).parameters as unknown as ObjectSchema;
      const fromZod = z.toJSONSchema(toolArgumentSchemas[name]) as ObjectSchema;
      expect(Object.keys(json.properties).sort(), name).toEqual(Object.keys(fromZod.properties ?? {}).sort());
      expect([...(json.required ?? [])].sort(), name).toEqual([...(fromZod.required ?? [])].sort());
      for (const [prop, def] of Object.entries(json.properties)) {
        const zDef = fromZod.properties[prop];
        expect(zDef, `${name}.${prop}`).toBeDefined();
        expect(def.type, `${name}.${prop} type`).toBe(zDef.type);
        if (def.enum) expect([...def.enum].sort(), `${name}.${prop} enum`).toEqual([...(zDef.enum ?? [])].sort());
      }
    }
  });

  it("validates realistic arguments and rejects extras", () => {
    expect(
      toolArgumentSchemas.remember.safeParse({
        content: "Her daughter Anne lives in Ohio.",
        kind: "relationship",
        category: "family",
        sensitivity: "normal",
        user_confirmed: true,
        user_words: "Yes, remember that.",
      }).success,
    ).toBe(true);
    expect(toolArgumentSchemas.remember.safeParse({ content: "x", kind: "summary", category: "family", sensitivity: "normal", user_confirmed: true }).success).toBe(false);
    expect(toolArgumentSchemas.record_consent.safeParse({ scope: "memory", granted: true }).success).toBe(false);
    expect(toolArgumentSchemas.record_consent.safeParse({ scope: "transcripts", granted: true, user_words: "ok" }).success).toBe(false);
    expect(toolArgumentSchemas.set_humor_level.safeParse({ level: "loud" }).success).toBe(false);
    expect(toolArgumentSchemas.search_web.safeParse({ query: "a".repeat(301) }).success).toBe(false);
    expect(toolArgumentSchemas.end_conversation.safeParse({}).success).toBe(true);
    expect(toolArgumentSchemas.end_conversation.safeParse({ bogus: 1 }).success).toBe(false);
  });

  it("isToolName narrows correctly", () => {
    expect(isToolName("remember")).toBe(true);
    expect(isToolName("rm_rf")).toBe(false);
    const names: ToolName[] = TOOL_NAMES.filter(isToolName);
    expect(names).toHaveLength(TOOL_NAMES.length);
  });
});
