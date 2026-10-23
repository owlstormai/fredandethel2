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
    expect(memoryToSecondPerson("Widower; his wife June passed away three years ago", "Walter")).toBe(
      "you're a widower; your wife June passed away three years ago",
    );
    expect(memoryToSecondPerson("Takes his coffee black and strong", "Walter")).toBe("you take your coffee black and strong");
    expect(memoryToSecondPerson("Does woodworking in the garage", null)).toBe("you do woodworking in the garage");
  });

  it("converts the user's own first-person words", () => {
    expect(memoryToSecondPerson("I take my coffee with two sugars.", "Paul")).toBe("you take your coffee with two sugars");
  });

  it("returns null when it cannot address the user", () => {
    expect(memoryToSecondPerson("Lifelong Cleveland sports fan, especially the Guardians", "Walter")).toBeNull();
    expect(memoryToSecondPerson("", "Walter")).toBeNull();
  });
});
