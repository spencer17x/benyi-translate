import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  createSelectionUi,
  MAX_SELECTION_CHARACTERS,
  positionPopover,
  validateSelectionText,
} from "./selection";

describe("selection translation", () => {
  it("accepts and normalizes readable English text", () => {
    expect(validateSelectionText("  Hello\n  world  ")).toEqual({
      ok: true,
      text: "Hello world",
    });
  });

  it("rejects empty, Chinese, and oversized selections", () => {
    expect(validateSelectionText("  …  ")).toMatchObject({ ok: false, issue: "empty" });
    expect(validateSelectionText("这是一段中文")).toMatchObject({
      ok: false,
      issue: "already-chinese",
    });
    expect(validateSelectionText("a".repeat(MAX_SELECTION_CHARACTERS + 1))).toMatchObject({
      ok: false,
      issue: "too-long",
    });
  });

  it("keeps the popover inside the viewport and flips it above when needed", () => {
    expect(
      positionPopover(
        { left: 290, right: 310, top: 170, bottom: 190, width: 20 },
        120,
        80,
        320,
        220,
      ),
    ).toEqual({ left: 192, top: 80 });
  });

  it("renders selected text and translated output without parsing HTML", () => {
    const dom = new JSDOM("<!doctype html><body><p>Source</p></body>");
    const document = dom.window.document;
    const ui = createSelectionUi(document, dom.window as unknown as Window, "open");
    const maliciousText = '<img src=x onerror="alert(1)">译文';

    ui.showLoading("Selected source", new dom.window.DOMRect(20, 20, 100, 24), "翻译中");
    ui.showResult(maliciousText);

    expect(ui.host.shadowRoot?.querySelector(".source")?.textContent).toBe("Selected source");
    expect(ui.host.shadowRoot?.querySelector(".result")?.textContent).toBe(maliciousText);
    expect(ui.host.shadowRoot?.querySelector("img")).toBeNull();
  });
});
