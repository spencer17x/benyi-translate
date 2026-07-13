import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  applyDisplayMode,
  clearTranslationUi,
  MODE_ATTRIBUTE,
  renderTranslationNode,
  SOURCE_ATTRIBUTE,
  STYLE_ID,
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
});
