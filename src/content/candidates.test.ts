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

  it("includes X article body blocks without duplicating list items", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <main data-testid="twitterArticleRichTextView">
        <div data-testid="longformRichTextComponent">
          <div class="longform-unstyled">
            <div id="body" class="public-DraftStyleDefault-block">Article paragraph</div>
          </div>
          <ul>
            <li id="list-item" class="longform-unordered-list-item">
              <div id="list-block" class="public-DraftStyleDefault-block">Article list item</div>
            </li>
          </ul>
        </div>
      </main>
    `);
    const selector = candidateSelector("x.com");
    const body = dom.window.document.getElementById("body");
    const listItem = dom.window.document.getElementById("list-item");
    const listBlock = dom.window.document.getElementById("list-block");

    expect(body?.matches(selector)).toBe(true);
    expect(listItem?.matches(selector)).toBe(true);
    expect(listBlock?.matches(selector)).toBe(false);
    expect(body?.matches(candidateSelector("example.com"))).toBe(false);
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
