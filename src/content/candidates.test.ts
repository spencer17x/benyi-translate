import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { candidateSelector, preferredDeclaredLanguage } from "./candidates";

describe("page text candidates", () => {
  it("includes X post text without broadening other sites", () => {
    const xDom = new JSDOM(
      '<!doctype html><article><div data-testid="tweetText" lang="en">Tomorrow might be celebration day.</div></article>',
      { url: "https://x.com/example/status/1" },
    );
    const regularDom = new JSDOM(
      '<!doctype html><div data-testid="tweetText">Application UI</div><p>Article paragraph</p>',
      { url: "https://example.com/" },
    );

    expect(xDom.window.document.querySelectorAll(candidateSelector("x.com"))).toHaveLength(1);
    expect(regularDom.window.document.querySelectorAll(candidateSelector("example.com"))).toHaveLength(1);
    expect(regularDom.window.document.querySelector(candidateSelector("example.com"))?.tagName).toBe("P");
  });

  it("prefers a content language over the page interface language", () => {
    const dom = new JSDOM(
      '<!doctype html><html lang="zh-CN"><body><div data-testid="tweetText" lang="en">English post</div></body></html>',
      { url: "https://x.com/example/status/1" },
    );
    const post = dom.window.document.querySelector<HTMLElement>('[data-testid="tweetText"]');

    expect(preferredDeclaredLanguage(post ? [post] : [], dom.window.document.documentElement.lang)).toBe("en");
  });
});
