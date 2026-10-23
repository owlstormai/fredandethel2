import { describe, expect, it } from "vitest";
import { memoryToSecondPerson } from "@/lib/ai/adapters/demoBrain";

describe("memoryToSecondPerson", () => {
  it("converts seeded third-person notes", () => {
    expect(memoryToSecondPerson("Tends a vegetable and flower garden; the tomatoes are her pride", "Margaret")).toBe(
      "you tend a vegetable and flower garden; the tomatoes are your pride",
    );
    expect(memoryToSecondPerson("Margaret is 78 and a retired schoolteacher who taught fourth grade in Ohio for 31 years", "Margaret")).toBe(
      "you're 78 and a retired schoolteacher who taught fourth grade in Ohio for 31 years",
    );
    expect(memoryToSecondPerson("Granddaughter Lily plays the violin and has a recital coming up", "Margaret")).toBe(
      "your granddaughter Lily plays the violin and has a recital coming up",
    );
    expect(memoryToSecondPerson("Widower; his wife June passed away three years ago", "Walter", "family")).toBe(
      "you're a widower; your wife June passed away three years ago",
    );
    expect(memoryToSecondPerson("Takes his coffee black and strong", "Walter")).toBe("you take your coffee black and strong");
    expect(memoryToSecondPerson("Does woodworking in the garage", null)).toBe("you do woodworking in the garage");
  });

  it("converts the user's own first-person words", () => {
    expect(memoryToSecondPerson("I take my coffee with two sugars.", "Paul")).toBe("you take your coffee with two sugars");
  });

  it("leaves subject pronouns alone in memories about other people", () => {
    expect(memoryToSecondPerson("My neighbour's dog is called Biscuit and he is a beagle", "Walter", "friends")).toBe(
      "your neighbour's dog is called Biscuit and he is a beagle",
    );
    expect(memoryToSecondPerson("Granddaughter Lily plays the violin; she has a recital soon", "Margaret", "family")).toBe(
      "your granddaughter Lily plays the violin; she has a recital soon",
    );
  });

  it("returns null when it cannot address the user", () => {
    expect(memoryToSecondPerson("Lifelong Cleveland sports fan, especially the Guardians", "Walter")).toBeNull();
    expect(memoryToSecondPerson("", "Walter")).toBeNull();
  });
});

describe("maybeQuip never repeats within a conversation", () => {
  it("skips quips already used and runs dry rather than repeating", async () => {
    const { maybeQuip } = await import("@/lib/ai/adapters/demoBrain");
    const first = maybeQuip("my garden and tomatoes", "playful", 3);
    expect(first).not.toBe("");
    const second = maybeQuip("my garden and tomatoes", "playful", 3, [first]);
    expect(second).not.toBe(first);
    const third = maybeQuip("my garden and tomatoes", "playful", 3, [first, second].filter(Boolean));
    expect(third === "" || (third !== first && third !== second)).toBe(true);
  });
});
