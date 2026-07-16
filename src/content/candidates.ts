export const SEMANTIC_TEXT_SELECTOR = "h1, h2, h3, h4, h5, h6, p, li, blockquote";

const X_POST_SELECTOR = '[data-testid="tweetText"]';
const X_ARTICLE_BLOCK_SELECTOR =
  '[data-testid="longformRichTextComponent"] .public-DraftStyleDefault-block:not(li *)';

export function candidateSelector(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  const isX =
    normalized === "x.com" ||
    normalized.endsWith(".x.com") ||
    normalized === "twitter.com" ||
    normalized.endsWith(".twitter.com");
  return isX
    ? `${SEMANTIC_TEXT_SELECTOR}, ${X_POST_SELECTOR}, ${X_ARTICLE_BLOCK_SELECTOR}`
    : SEMANTIC_TEXT_SELECTOR;
}

export function preferredDeclaredLanguage(
  elements: readonly HTMLElement[],
  fallback: string | undefined,
): string | undefined {
  for (const element of elements) {
    let current: HTMLElement | null = element;
    while (current && current !== element.ownerDocument.documentElement) {
      const language = current.getAttribute("lang")?.trim();
      if (language) return language;
      current = current.parentElement;
    }
  }
  return fallback?.trim() || undefined;
}
