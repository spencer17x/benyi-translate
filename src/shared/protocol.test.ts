import { describe, expect, it } from "vitest";
import {
  isActionReadyMessage,
  isPageToPanelMessage,
  isPanelToPageMessage,
  isSelectionTranslateMessage,
  MAX_SELECTION_CHARACTERS,
  PROTOCOL_VERSION,
} from "./protocol";

describe("protocol validation", () => {
  it("accepts an action-ready notification with a valid tab id", () => {
    expect(isActionReadyMessage({ version: PROTOCOL_VERSION, type: "ACTION_READY", tabId: 7 })).toBe(true);
    expect(isActionReadyMessage({ version: PROTOCOL_VERSION, type: "ACTION_READY", tabId: -1 })).toBe(false);
  });

  it("accepts selection translation requests and rejects malformed text", () => {
    expect(
      isSelectionTranslateMessage({
        version: PROTOCOL_VERSION,
        type: "SELECTION_TRANSLATE",
        sourceText: "Selected text",
      }),
    ).toBe(true);
    expect(
      isSelectionTranslateMessage({
        version: PROTOCOL_VERSION,
        type: "SELECTION_TRANSLATE",
        sourceText: 42,
      }),
    ).toBe(false);
    expect(
      isSelectionTranslateMessage({
        version: PROTOCOL_VERSION,
        type: "SELECTION_TRANSLATE",
        sourceText: "x".repeat(MAX_SELECTION_CHARACTERS + 2),
      }),
    ).toBe(false);
  });

  it("accepts a valid panel hello", () => {
    expect(
      isPanelToPageMessage({ version: PROTOCOL_VERSION, type: "PANEL_HELLO", tabId: 7 }),
    ).toBe(true);
  });

  it("rejects a task message with an invalid tab id", () => {
    expect(
      isPanelToPageMessage({
        version: PROTOCOL_VERSION,
        type: "TRANSLATION_CANCEL",
        tabId: -1,
        pageId: "page",
        taskId: "task",
      }),
    ).toBe(false);
  });

  it("rejects oversized page batches", () => {
    expect(
      isPageToPanelMessage({
        version: PROTOCOL_VERSION,
        type: "PAGE_SEGMENTS",
        tabId: 1,
        pageId: "page",
        taskId: "task",
        batchId: "batch",
        done: true,
        segments: [
          {
            segmentId: "segment",
            sourceText: "x".repeat(32_001),
            contentHash: "hash",
            sourceLanguage: "en",
            targetLanguage: "zh",
            priority: 0,
          },
        ],
      }),
    ).toBe(false);
  });

  it("rejects progress counts that exceed the task total", () => {
    expect(
      isPageToPanelMessage({
        version: PROTOCOL_VERSION,
        type: "PAGE_STATE",
        tabId: 1,
        pageId: "page",
        status: "translating",
        mode: "bilingual",
        progress: { total: 1, completed: 1, failed: 1, skipped: 0 },
      }),
    ).toBe(false);
  });

  it("rejects translated output that exceeds the message limit", () => {
    expect(
      isPanelToPageMessage({
        version: PROTOCOL_VERSION,
        type: "TRANSLATION_RESULT",
        tabId: 1,
        pageId: "page",
        taskId: "task",
        batchId: "batch",
        results: [
          {
            segmentId: "segment",
            contentHash: "hash",
            status: "translated",
            translatedText: "x".repeat(64_001),
          },
        ],
      }),
    ).toBe(false);
  });
});
