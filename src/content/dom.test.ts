import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  applyDisplayMode,
  applyTranslationColor,
  clearTranslationUi,
  MODE_ATTRIBUTE,
  renderTaskNotice,
  renderTranslationNode,
  SOURCE_ATTRIBUTE,
  STYLE_ID,
  taskNoticeText,
  TASK_NOTICE_ID,
} from "./dom";

describe("safe translation rendering", () => {
  it("writes translated output as text and never parses its HTML", () => {
    const dom = new JSDOM("<!doctype html><p id='source'>Original</p>");
    const source = dom.window.document.getElementById("source") as HTMLElement;
    const maliciousText = '<img src=x onerror="alert(1)">译文';

    const translation = renderTranslationNode(dom.window.document, source, "segment-1", maliciousText);

    expect(translation.textContent).toBe(maliciousText);
    expect(translation.querySelector("img")).toBeNull();
    expect(source.textContent).toBe("Original");
    expect(source.getAttribute(SOURCE_ATTRIBUTE)).toBe("segment-1");
  });

  it("uses a valid list-item companion for list content", () => {
    const dom = new JSDOM("<!doctype html><ol><li id='source'>First</li></ol>");
    const source = dom.window.document.getElementById("source") as HTMLElement;

    const translation = renderTranslationNode(dom.window.document, source, "segment-1", "第一");

    expect(translation.tagName).toBe("LI");
    expect(translation.previousElementSibling).toBe(source);
  });

  it("switches display mode and fully removes extension UI", () => {
    const dom = new JSDOM("<!doctype html><p id='source'>Original</p>");
    const source = dom.window.document.getElementById("source") as HTMLElement;
    renderTranslationNode(dom.window.document, source, "segment-1", "译文");

    applyDisplayMode(dom.window.document, "translation");
    expect(dom.window.document.documentElement.getAttribute(MODE_ATTRIBUTE)).toBe("translation");
    expect(dom.window.document.getElementById(STYLE_ID)).not.toBeNull();

    clearTranslationUi(dom.window.document);
    expect(dom.window.document.querySelector("[data-benyi-translation]")).toBeNull();
    expect(source.hasAttribute(SOURCE_ATTRIBUTE)).toBe(false);
    expect(dom.window.document.documentElement.hasAttribute(MODE_ATTRIBUTE)).toBe(false);
    expect(dom.window.document.getElementById(STYLE_ID)).toBeNull();
  });

  it("applies a validated custom translation color", () => {
    const dom = new JSDOM("<!doctype html><p>Original</p>");

    applyTranslationColor(dom.window.document, "#3A7BC8");

    expect(dom.window.document.getElementById(STYLE_ID)?.textContent).toContain(
      "color: #3a7bc8 !important",
    );
  });

  it("renders a non-layout-blocking task notice and removes it when idle", () => {
    const dom = new JSDOM("<!doctype html><body></body>");
    const progress = { total: 5, completed: 2, failed: 1, skipped: 0 };

    const host = renderTaskNotice(dom.window.document, "translating", progress);

    expect(host?.id).toBe(TASK_NOTICE_ID);
    expect(host?.dataset.benyiRoot).toBe("task-notice");
    expect(taskNoticeText("translating", progress)).toBe("本译正在翻译 3 / 5");
    renderTaskNotice(dom.window.document, "idle", progress);
    expect(dom.window.document.getElementById(TASK_NOTICE_ID)).toBeNull();
  });
});
