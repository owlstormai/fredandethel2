# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: isolation.spec.ts >> users cannot read, edit or delete each other's memories or conversations
- Location: tests/e2e/isolation.spec.ts:4:5

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected value: 500
Received array: [403, 404]
```

# Test source

```ts
  1  | import { test, expect, request as pwRequest } from "@playwright/test";
  2  | import { signup, uniqueEmail } from "./helpers";
  3  | 
  4  | test("users cannot read, edit or delete each other's memories or conversations", async ({ baseURL }) => {
  5  |   const a = await pwRequest.newContext({ baseURL });
  6  |   const b = await pwRequest.newContext({ baseURL });
  7  |   await signup(a, uniqueEmail("alice"));
  8  |   await signup(b, uniqueEmail("bob"));
  9  | 
  10 |   // Alice turns memory on and saves a fact.
  11 |   expect((await a.post("/api/consent", { data: { scope: "memory", granted: true, source: "ui" } })).ok()).toBeTruthy();
  12 |   const created = await a.post("/api/memories", { data: { content: "Alice secret: likes opera", kind: "interest", category: "interest" } });
  13 |   expect(created.ok(), await created.text()).toBeTruthy();
  14 |   const memoryId = (await created.json()).memory?.id ?? (await created.json()).id;
  15 |   expect(memoryId).toBeTruthy();
  16 | 
  17 |   const conv = await a.post("/api/conversations", { data: { mode: "demo", modelKey: "full" } });
  18 |   expect(conv.ok()).toBeTruthy();
  19 |   const convId = (await conv.json()).id;
  20 | 
  21 |   // Bob tries everything.
  22 |   expect((await b.get(`/api/memories`)).ok()).toBeTruthy();
  23 |   expect(JSON.stringify(await (await b.get(`/api/memories`)).json())).not.toContain("opera");
  24 |   expect([403, 404]).toContain((await b.patch(`/api/memories/${memoryId}`, { data: { content: "hacked" } })).status());
  25 |   expect([403, 404]).toContain((await b.delete(`/api/memories/${memoryId}`)).status());
> 26 |   expect([403, 404]).toContain((await b.get(`/api/conversations/${convId}`)).status());
     |                      ^ Error: expect(received).toContain(expected) // indexOf
  27 |   expect([403, 404]).toContain((await b.post(`/api/conversations/${convId}/end`, { data: {} })).status());
  28 |   expect([403, 404]).toContain((await b.post(`/api/demo/turn`, { data: { conversationId: convId, text: "hi" } })).status());
  29 | 
  30 |   // Alice still has it, untouched.
  31 |   const mine = await (await a.get("/api/memories")).json();
  32 |   expect(JSON.stringify(mine)).toContain("opera");
  33 |   expect(JSON.stringify(mine)).not.toContain("hacked");
  34 | 
  35 |   // Signed-out access is rejected.
  36 |   const anon = await pwRequest.newContext({ baseURL });
  37 |   expect((await anon.get("/api/memories")).status()).toBe(401);
  38 |   expect((await anon.get("/api/me")).status()).toBe(401);
  39 | });
  40 | 
```