import { describe, expect, it } from "vitest";
import { MAX_BATCH_CHARACTERS, MAX_BATCH_SEGMENTS, type SegmentInput } from "./protocol";
import {
  batchSegments,
  hashText,
  isProbablyChinese,
  normalizeText,
  shouldSkipText,
  splitText,
} from "./text";

describe("normalizeText", () => {
  it("collapses whitespace without changing visible source text elsewhere", () => {
    expect(normalizeText("  Hello\n\tworld  ")).toBe("Hello world");
  });
});

describe("shouldSkipText", () => {
  it.each(["", " ", "!", "https://example.com", "www.example.com"])("skips %j", (value) => {
    expect(shouldSkipText(value)).toBe(true);
  });

  it.each(["Hello", "你好", "Version 2"])("keeps %j", (value) => {
    expect(shouldSkipText(value)).toBe(false);
  });
});

describe("hashText", () => {
  it("is stable across equivalent whitespace", () => {
    expect(hashText("Hello   world")).toBe(hashText(" Hello world "));
  });

  it("changes when the text changes", () => {
    expect(hashText("Hello world")).not.toBe(hashText("Hello world!"));
  });
});

describe("isProbablyChinese", () => {
  it("recognizes Chinese text while retaining English and Japanese sentences", () => {
    expect(isProbablyChinese("这是已经翻译好的中文。 ")).toBe(true);
    expect(isProbablyChinese("English text with 中文 words")).toBe(false);
    expect(isProbablyChinese("これは日本語の文章です")).toBe(false);
  });
});

describe("splitText", () => {
  it("prefers sentence boundaries and preserves all words", () => {
    const input = "First sentence. Second sentence with more words. Third sentence.";
    const chunks = splitText(input, 30);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 30)).toBe(true);
    expect(chunks.join(" ")).toBe(input);
  });

  it("uses a hard boundary for long unbroken input", () => {
    const chunks = splitText("a".repeat(61), 20);
    expect(chunks).toEqual(["a".repeat(20), "a".repeat(20), "a".repeat(20), "a"]);
  });

  it("returns no chunks for blank input", () => {
    expect(splitText("   ")).toEqual([]);
  });
});

describe("batchSegments", () => {
  it("respects segment and character limits", () => {
    const segments = Array.from({ length: MAX_BATCH_SEGMENTS + 1 }, (_, index) =>
      createSegment(String(index), "x".repeat(10)),
    );
    const batches = batchSegments(segments);

    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(MAX_BATCH_SEGMENTS);
    expect(batches[1]).toHaveLength(1);
  });

  it("starts a new batch before crossing the character limit", () => {
    const segments = [
      createSegment("1", "x".repeat(MAX_BATCH_CHARACTERS - 1)),
      createSegment("2", "xx"),
    ];

    expect(batchSegments(segments)).toHaveLength(2);
  });
});

function createSegment(segmentId: string, sourceText: string): SegmentInput {
  return {
    segmentId,
    sourceText,
    contentHash: hashText(sourceText),
    sourceLanguage: "en",
    targetLanguage: "zh",
    priority: 0,
  };
}
