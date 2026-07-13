import { describe, expect, it, vi } from "vitest";
import { translateText, type TranslationAdapter } from "./translate";

describe("translateText", () => {
  it("translates long input sequentially in bounded chunks", async () => {
    const translate = vi.fn(async (input: string) => `[${input}]`);
    const source = "First sentence. Second sentence. Third sentence.";

    const result = await translateText({ translate }, source, new AbortController().signal, 24);

    expect(translate.mock.calls.length).toBeGreaterThan(1);
    expect(translate.mock.calls.every(([input]) => input.length <= 24)).toBe(true);
    expect(result).toContain("[First sentence.");
  });

  it("splits and retries a chunk rejected for quota", async () => {
    const calls: string[] = [];
    const translator: TranslationAdapter = {
      async translate(input) {
        calls.push(input);
        if (input.length > 20) throw new DOMException("Too large", "QuotaExceededError");
        return input.toUpperCase();
      },
    };
    const source = "word ".repeat(16).trim();

    const result = await translateText(translator, source, new AbortController().signal, 100);

    expect(calls.some((input) => input.length > 20)).toBe(true);
    expect(calls.some((input) => input.length <= 20)).toBe(true);
    expect(result).not.toBe("");
  });

  it("propagates cancellation without retrying", async () => {
    const translate = vi.fn(async () => {
      throw new DOMException("Cancelled", "AbortError");
    });

    await expect(
      translateText({ translate }, "Some source text", new AbortController().signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(translate).toHaveBeenCalledTimes(1);
  });
});
