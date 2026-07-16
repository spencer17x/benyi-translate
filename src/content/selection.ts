import { isProbablyChinese, normalizeText } from "../shared/text";
import { MAX_SELECTION_CHARACTERS } from "../shared/protocol";
import { translateText } from "../translation/translate";

export { MAX_SELECTION_CHARACTERS };

const SOURCE_LANGUAGE = "en";
const TARGET_LANGUAGE = "zh";
const POPOVER_GAP = 10;
const VIEWPORT_MARGIN = 8;

type SelectionIssue = "empty" | "already-chinese" | "too-long";

export type SelectionTextResult =
  | { ok: true; text: string }
  | { ok: false; issue: SelectionIssue; text: string };

export type SelectionTranslationController = {
  translate(sourceText?: string): Promise<void>;
  dispose(): void;
};

export type SelectionUi = {
  host: HTMLElement;
  translateButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  copyButton: HTMLButtonElement;
  retryButton: HTMLButtonElement;
  showButton(rect: DOMRect): void;
  showLoading(sourceText: string, rect: DOMRect, message: string): void;
  showProgress(value: number, message: string): void;
  showResult(translatedText: string): void;
  showError(message: string, retry?: boolean): void;
  setCopyLabel(label: string): void;
  hide(): void;
  destroy(): void;
};

export function validateSelectionText(value: string): SelectionTextResult {
  const text = normalizeText(value);
  if (!text || !/[\p{L}\p{N}]/u.test(text)) return { ok: false, issue: "empty", text };
  if (isProbablyChinese(text)) return { ok: false, issue: "already-chinese", text };
  if (text.length > MAX_SELECTION_CHARACTERS) return { ok: false, issue: "too-long", text };
  return { ok: true, text };
}

export function positionPopover(
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width">,
  popoverWidth: number,
  popoverHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number } {
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - popoverWidth - VIEWPORT_MARGIN);
  const left = clamp(
    rect.left + rect.width / 2 - popoverWidth / 2,
    VIEWPORT_MARGIN,
    maxLeft,
  );
  const below = rect.bottom + POPOVER_GAP;
  const above = rect.top - popoverHeight - POPOVER_GAP;
  const top =
    below + popoverHeight <= viewportHeight - VIEWPORT_MARGIN
      ? below
      : Math.max(VIEWPORT_MARGIN, above);
  return { left, top };
}

export function initializeSelectionTranslation(
  document: Document = globalThis.document,
  view: Window = globalThis.window,
): SelectionTranslationController {
  const ui = createSelectionUi(document, view);
  let currentText = "";
  let currentRect = fallbackRect(view);
  let translator: Translator | undefined;
  let activeController: AbortController | undefined;
  let copyResetTimer: number | undefined;

  const handlePointerUp = (event: PointerEvent): void => {
    if (event.composedPath().includes(ui.host)) return;
    view.setTimeout(showButtonForCurrentSelection, 0);
  };

  const handleKeyUp = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      closePopover();
      return;
    }
    if (event.shiftKey || event.key.startsWith("Arrow")) showButtonForCurrentSelection();
  };

  const handlePointerDown = (event: PointerEvent): void => {
    if (event.composedPath().includes(ui.host)) return;
    closePopover();
  };

  const closeOnViewportChange = (): void => {
    closePopover();
  };

  ui.translateButton.addEventListener("pointerdown", preserveSelection);
  ui.translateButton.addEventListener("click", () => {
    void translateCurrentSelection();
  });
  ui.closeButton.addEventListener("click", closePopover);
  ui.copyButton.addEventListener("click", () => {
    void copyTranslation();
  });
  ui.retryButton.addEventListener("click", () => {
    void translateCurrentSelection();
  });
  document.addEventListener("pointerup", handlePointerUp, true);
  document.addEventListener("pointerdown", handlePointerDown, true);
  document.addEventListener("keyup", handleKeyUp, true);
  view.addEventListener("scroll", closeOnViewportChange, true);
  view.addEventListener("resize", closeOnViewportChange);
  view.addEventListener("pagehide", dispose, { once: true });

  function preserveSelection(event: PointerEvent): void {
    event.preventDefault();
  }

  function showButtonForCurrentSelection(): void {
    const selection = document.getSelection();
    const validation = validateSelectionText(selection?.toString() ?? "");
    if (!validation.ok) {
      ui.hide();
      return;
    }

    currentText = validation.text;
    currentRect = selectionRect(selection, view);
    ui.showButton(currentRect);
  }

  async function translate(sourceText?: string): Promise<void> {
    const selection = document.getSelection();
    const validation = validateSelectionText(sourceText ?? selection?.toString() ?? "");
    currentRect = selectionRect(selection, view);

    if (!validation.ok) {
      currentText = validation.text;
      ui.showLoading(currentText || "未选中文本", currentRect, "无法翻译当前选区");
      ui.showError(selectionIssueMessage(validation.issue), false);
      return;
    }

    currentText = validation.text;
    await translateCurrentSelection();
  }

  async function translateCurrentSelection(): Promise<void> {
    if (!currentText) return;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    ui.showLoading(currentText, currentRect, "正在准备本地翻译…");

    try {
      const localTranslator = await prepareTranslator(controller.signal);
      ui.showProgress(1, "正在翻译选中文本…");
      const translatedText = await translateText(localTranslator, currentText, controller.signal);
      if (activeController !== controller) return;
      ui.showResult(translatedText);
    } catch (error) {
      if (isAbortError(error) || activeController !== controller) return;
      ui.showError(selectionErrorMessage(error));
    }
  }

  async function prepareTranslator(signal: AbortSignal): Promise<Translator> {
    if (translator) return translator;
    if (!("Translator" in globalThis)) throw new SelectionTranslationError("API_UNSUPPORTED");

    const availability = await Translator.availability({
      sourceLanguage: SOURCE_LANGUAGE,
      targetLanguage: TARGET_LANGUAGE,
    });
    if (availability === "unavailable") {
      throw new SelectionTranslationError("PAIR_UNAVAILABLE");
    }
    if (availability === "downloadable" || availability === "downloading") {
      ui.showProgress(0, "正在下载本地语言资源…");
    }

    const created = await Translator.create({
      sourceLanguage: SOURCE_LANGUAGE,
      targetLanguage: TARGET_LANGUAGE,
      signal,
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          ui.showProgress(event.loaded, "正在下载本地语言资源…");
        });
      },
    });
    if (signal.aborted) {
      created.destroy();
      throw new DOMException("Cancelled", "AbortError");
    }
    translator = created;
    return created;
  }

  async function copyTranslation(): Promise<void> {
    const translatedText = ui.copyButton.dataset.translation;
    if (!translatedText) return;

    try {
      await copyText(view.navigator, document, translatedText);
      ui.setCopyLabel("已复制");
      view.clearTimeout(copyResetTimer);
      copyResetTimer = view.setTimeout(() => ui.setCopyLabel("复制译文"), 1_500);
    } catch {
      ui.setCopyLabel("复制失败");
    }
  }

  function closePopover(): void {
    activeController?.abort();
    activeController = undefined;
    ui.hide();
  }

  function dispose(): void {
    closePopover();
    view.clearTimeout(copyResetTimer);
    translator?.destroy();
    translator = undefined;
    document.removeEventListener("pointerup", handlePointerUp, true);
    document.removeEventListener("pointerdown", handlePointerDown, true);
    document.removeEventListener("keyup", handleKeyUp, true);
    view.removeEventListener("scroll", closeOnViewportChange, true);
    view.removeEventListener("resize", closeOnViewportChange);
    ui.destroy();
  }

  return { translate, dispose };
}

export function createSelectionUi(
  document: Document,
  view: Window,
  shadowMode: ShadowRootMode = "closed",
): SelectionUi {
  const host = document.createElement("div");
  host.dataset.benyiRoot = "selection";
  host.hidden = true;
  const shadow = host.attachShadow({ mode: shadowMode });
  let anchorRect = fallbackRect(view);
  const style = document.createElement("style");
  style.textContent = selectionStyles;

  const translateButton = element(document, "button", "trigger", "译");
  translateButton.type = "button";
  translateButton.setAttribute("aria-label", "翻译选中文本");

  const card = element(document, "section", "card");
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "本译划词翻译");

  const header = element(document, "header", "header");
  const brand = element(document, "div", "brand");
  const brandMark = element(document, "span", "brand-mark", "本");
  const brandName = element(document, "strong", "brand-name", "本译");
  brand.append(brandMark, brandName);
  const closeButton = element(document, "button", "close", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "关闭划词翻译");
  header.append(brand, closeButton);

  const source = element(document, "p", "source");
  const status = element(document, "p", "status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const progress = document.createElement("progress");
  progress.className = "progress";
  progress.max = 1;
  progress.hidden = true;
  const result = element(document, "p", "result");
  result.hidden = true;

  const actions = element(document, "div", "actions");
  const copyButton = element(document, "button", "action primary", "复制译文");
  copyButton.type = "button";
  copyButton.hidden = true;
  const retryButton = element(document, "button", "action", "重新翻译");
  retryButton.type = "button";
  retryButton.hidden = true;
  actions.append(copyButton, retryButton);
  card.append(header, source, status, progress, result, actions);
  shadow.append(style, translateButton, card);
  (document.body ?? document.documentElement).append(host);

  function place(node: HTMLElement, rect: DOMRect): void {
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const position = positionPopover(rect, width, height, view.innerWidth, view.innerHeight);
    node.style.left = `${position.left}px`;
    node.style.top = `${position.top}px`;
  }

  function showButton(rect: DOMRect): void {
    anchorRect = rect;
    host.hidden = false;
    card.hidden = true;
    translateButton.hidden = false;
    place(translateButton, rect);
  }

  function showLoading(sourceText: string, rect: DOMRect, message: string): void {
    anchorRect = rect;
    host.hidden = false;
    translateButton.hidden = true;
    card.hidden = false;
    source.textContent = sourceText;
    status.textContent = message;
    status.dataset.tone = "active";
    progress.hidden = false;
    progress.removeAttribute("value");
    result.hidden = true;
    result.textContent = "";
    copyButton.hidden = true;
    copyButton.textContent = "复制译文";
    copyButton.dataset.translation = "";
    retryButton.hidden = true;
    place(card, rect);
  }

  function showProgress(value: number, message: string): void {
    status.textContent = message;
    progress.hidden = false;
    progress.value = clamp(value, 0, 1);
  }

  function showResult(translatedText: string): void {
    status.textContent = "英语 → 简体中文 · 本地完成";
    status.dataset.tone = "success";
    progress.hidden = true;
    result.textContent = translatedText;
    result.hidden = false;
    copyButton.dataset.translation = translatedText;
    copyButton.hidden = false;
    retryButton.hidden = false;
    place(card, anchorRect);
  }

  function showError(message: string, retry = true): void {
    status.textContent = "翻译未完成";
    status.dataset.tone = "error";
    progress.hidden = true;
    result.textContent = message;
    result.hidden = false;
    copyButton.hidden = true;
    retryButton.hidden = !retry;
    place(card, anchorRect);
  }

  function setCopyLabel(label: string): void {
    copyButton.textContent = label;
  }

  function hide(): void {
    host.hidden = true;
    translateButton.hidden = true;
    card.hidden = true;
  }

  function destroy(): void {
    host.remove();
  }

  return {
    host,
    translateButton,
    closeButton,
    copyButton,
    retryButton,
    showButton,
    showLoading,
    showProgress,
    showResult,
    showError,
    setCopyLabel,
    hide,
    destroy,
  };
}

function selectionRect(selection: Selection | null, view: Window): DOMRect {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return fallbackRect(view);
  const range = selection.getRangeAt(0);
  const rects = range.getClientRects();
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return rect;
  return rects.item(rects.length - 1) ?? fallbackRect(view);
}

function fallbackRect(view: Window): DOMRect {
  const x = view.innerWidth / 2;
  const y = Math.min(180, view.innerHeight / 3);
  const DOMRectConstructor = (view as unknown as { DOMRect: typeof DOMRect }).DOMRect;
  return new DOMRectConstructor(x, y, 0, 0);
}

function selectionIssueMessage(issue: SelectionIssue): string {
  switch (issue) {
    case "already-chinese":
      return "选中的内容已经是中文，无需翻译。";
    case "too-long":
      return `单次划词最多支持 ${MAX_SELECTION_CHARACTERS.toLocaleString()} 个字符。`;
    case "empty":
      return "请先选中需要翻译的英文文本。";
  }
}

function selectionErrorMessage(error: unknown): string {
  if (error instanceof SelectionTranslationError) {
    if (error.code === "API_UNSUPPORTED") return "当前 Chrome 不支持本地 Translator API，请升级浏览器。";
    if (error.code === "PAIR_UNAVAILABLE") return "当前设备暂不支持英语到简体中文的本地翻译。";
  }
  if (error instanceof DOMException) {
    if (error.name === "NotSupportedError") return "当前设备暂不支持英语到简体中文的本地翻译。";
    if (error.name === "NetworkError") return "本地语言资源准备失败，请检查网络后重试。";
    if (error.name === "QuotaExceededError") return "选中的文本超过了本地翻译能力限制。";
  }
  return "翻译过程中发生错误，请重试。";
}

async function copyText(navigator: Navigator, document: Document, value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back to the browser's selection-based copy path.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.dataset.benyiRoot = "copy";
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy failed");
}

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

class SelectionTranslationError extends Error {
  constructor(readonly code: "API_UNSUPPORTED" | "PAIR_UNAVAILABLE") {
    super(code);
    this.name = "SelectionTranslationError";
  }
}

const selectionStyles = `
  :host {
    all: initial;
    color-scheme: light dark;
    font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  [hidden] { display: none !important; }
  button { font: inherit; }
  .trigger,
  .card {
    position: fixed;
    z-index: 2147483647;
    box-sizing: border-box;
    pointer-events: auto;
  }
  .trigger {
    width: 38px;
    height: 38px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.78);
    border-radius: 12px;
    background: #287a49;
    color: #fff;
    font-size: 17px;
    font-weight: 750;
    line-height: 1;
    box-shadow: 0 8px 24px rgba(18, 58, 36, 0.24), 0 2px 7px rgba(18, 58, 36, 0.18);
    cursor: pointer;
    transition: transform 140ms ease, background 140ms ease, box-shadow 140ms ease;
  }
  .trigger:hover {
    background: #216b3e;
    box-shadow: 0 10px 28px rgba(18, 58, 36, 0.3), 0 3px 8px rgba(18, 58, 36, 0.2);
    transform: translateY(-1px);
  }
  .trigger:active { transform: translateY(1px) scale(0.97); }
  .trigger:focus-visible,
  .close:focus-visible,
  .action:focus-visible {
    outline: 3px solid rgba(53, 143, 85, 0.32);
    outline-offset: 2px;
  }
  .card {
    width: min(360px, calc(100vw - 16px));
    max-height: min(460px, calc(100vh - 16px));
    overflow: auto;
    padding: 14px;
    border: 1px solid rgba(42, 73, 54, 0.15);
    border-radius: 18px;
    background: rgba(252, 254, 252, 0.98);
    color: #183323;
    box-shadow: 0 18px 50px rgba(24, 51, 35, 0.2), 0 4px 14px rgba(24, 51, 35, 0.1);
    backdrop-filter: blur(16px);
  }
  .header,
  .brand,
  .actions {
    display: flex;
    align-items: center;
  }
  .header { justify-content: space-between; gap: 12px; }
  .brand { gap: 8px; }
  .brand-mark {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border-radius: 9px;
    background: #287a49;
    color: #fff;
    font-size: 14px;
    font-weight: 750;
  }
  .brand-name { font-size: 15px; letter-spacing: 0.02em; }
  .close {
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: #607067;
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }
  .close:hover { background: #edf3ef; color: #183323; }
  .source {
    display: -webkit-box;
    margin: 13px 0 0;
    overflow: hidden;
    color: #637169;
    font-size: 12px;
    line-height: 1.5;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }
  .status {
    margin: 12px 0 0;
    color: #526159;
    font-size: 12px;
    font-weight: 650;
    line-height: 1.4;
  }
  .status[data-tone="active"] { color: #287a49; }
  .status[data-tone="success"] { color: #287a49; }
  .status[data-tone="error"] { color: #a33c38; }
  .progress {
    width: 100%;
    height: 5px;
    margin: 10px 0 0;
    border: 0;
    border-radius: 99px;
    overflow: hidden;
    accent-color: #287a49;
  }
  .progress::-webkit-progress-bar { background: #e4ece7; }
  .progress::-webkit-progress-value { background: #287a49; transition: width 180ms ease; }
  .result {
    margin: 12px 0 0;
    color: #183323;
    font-size: 15px;
    font-weight: 500;
    line-height: 1.68;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .actions { gap: 8px; margin-top: 14px; }
  .action {
    min-height: 34px;
    padding: 0 12px;
    border: 1px solid #cedbd2;
    border-radius: 10px;
    background: #fff;
    color: #355142;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }
  .action:hover { border-color: #9bb7a5; background: #f3f7f4; }
  .action.primary { border-color: #287a49; background: #287a49; color: #fff; }
  .action.primary:hover { background: #216b3e; }
  @media (prefers-color-scheme: dark) {
    .card {
      border-color: rgba(197, 224, 205, 0.14);
      background: rgba(24, 31, 27, 0.98);
      color: #edf6ef;
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.42), 0 4px 14px rgba(0, 0, 0, 0.28);
    }
    .close { color: #aebbb2; }
    .close:hover { background: #2d3931; color: #fff; }
    .source, .status { color: #aebbb2; }
    .result { color: #edf6ef; }
    .progress::-webkit-progress-bar { background: #354139; }
    .action { border-color: #46584c; background: #253029; color: #dbe9de; }
    .action:hover { border-color: #65806e; background: #2d3931; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
  }
`;
