import { test, expect, request as pwRequest } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

test("users cannot read, edit or delete each other's memories or conversations", async ({ baseURL }) => {
  const a = await pwRequest.newContext({ baseURL });
  const b = await pwRequest.newContext({ baseURL });
  await signup(a, uniqueEmail("alice"));
  await signup(b, uniqueEmail("bob"));

  // Alice turns memory on and saves a fact.
  expect((await a.post("/api/consent", { data: { scope: "memory", granted: true, source: "ui" } })).ok()).toBeTruthy();
  const created = await a.post("/api/memories", { data: { content: "Alice secret: likes opera", kind: "interest", category: "interest" } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const memoryId = (await created.json()).memory?.id ?? (await created.json()).id;
  expect(memoryId).toBeTruthy();

  const conv = await a.post("/api/conversations", { data: { mode: "demo", modelKey: "full" } });
  expect(conv.ok()).toBeTruthy();
  const convJson = await conv.json();
  const convId = convJson.conversation?.id ?? convJson.id;

  // Bob tries everything.
  expect((await b.get(`/api/memories`)).ok()).toBeTruthy();
  expect(JSON.stringify(await (await b.get(`/api/memories`)).json())).not.toContain("opera");
  expect([403, 404]).toContain((await b.patch(`/api/memories/${memoryId}`, { data: { content: "hacked" } })).status());
  expect([403, 404]).toContain((await b.delete(`/api/memories/${memoryId}`)).status());
  expect([403, 404]).toContain((await b.get(`/api/conversations/${convId}`)).status());
  expect([403, 404]).toContain((await b.post(`/api/conversations/${convId}/end`, { data: {} })).status());
  expect([403, 404]).toContain((await b.post(`/api/demo/turn`, { data: { conversationId: convId, text: "hi" } })).status());

  // Alice still has it, untouched.
  const mine = await (await a.get("/api/memories")).json();
  expect(JSON.stringify(mine)).toContain("opera");
  expect(JSON.stringify(mine)).not.toContain("hacked");

  // Signed-out access is rejected.
  const anon = await pwRequest.newContext({ baseURL });
  expect((await anon.get("/api/memories")).status()).toBe(401);
  expect((await anon.get("/api/me")).status()).toBe(401);
});
