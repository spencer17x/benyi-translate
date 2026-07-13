import type { DisplayMode } from "../shared/protocol";

export const STYLE_ID = "benyi-translation-style";
export const SOURCE_ATTRIBUTE = "data-benyi-source";
export const MODE_ATTRIBUTE = "data-benyi-mode";

export function renderTranslationNode(
  document: Document,
  sourceElement: HTMLElement,
  segmentId: string,
  translatedText: string,
): HTMLElement {
  ensureTranslationStyle(document);
  const translation =
    sourceElement.tagName === "LI" ? document.createElement("li") : document.createElement("div");
  translation.dataset.benyiTranslation = "true";
  translation.dataset.benyiSegment = segmentId;
  translation.className = "benyi-translation";
  translation.setAttribute("role", "note");
  translation.setAttribute("aria-label", "本译译文");
  translation.textContent = translatedText;
  sourceElement.setAttribute(SOURCE_ATTRIBUTE, segmentId);
  sourceElement.insertAdjacentElement("afterend", translation);
  return translation;
}

export function applyDisplayMode(document: Document, mode: DisplayMode): void {
  ensureTranslationStyle(document);
  document.documentElement.setAttribute(MODE_ATTRIBUTE, mode);
}

export function clearTranslationUi(document: Document): void {
  document.querySelectorAll<HTMLElement>("[data-benyi-translation]").forEach((node) => node.remove());
  document.querySelectorAll<HTMLElement>("[data-benyi-source]").forEach((node) => {
    node.removeAttribute(SOURCE_ATTRIBUTE);
  });
  document.documentElement.removeAttribute(MODE_ATTRIBUTE);
  document.getElementById(STYLE_ID)?.remove();
}

export function ensureTranslationStyle(document: Document): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    [data-benyi-translation] {
      display: block !important;
      margin-block: 0.45em 0.8em !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      color: #24683a !important;
      font: inherit !important;
      font-size: 0.96em !important;
      font-style: normal !important;
      font-weight: 450 !important;
      line-height: 1.65 !important;
      letter-spacing: normal !important;
      text-align: inherit !important;
      white-space: pre-wrap !important;
    }
    li[data-benyi-translation] { list-style: none !important; }
    html[data-benyi-mode="original"] [data-benyi-translation] { display: none !important; }
    html[data-benyi-mode="translation"] [data-benyi-source] { display: none !important; }
    @media (prefers-color-scheme: dark) {
      [data-benyi-translation] { color: #72c68b !important; }
    }
  `;
  (document.head ?? document.documentElement).append(style);
}
