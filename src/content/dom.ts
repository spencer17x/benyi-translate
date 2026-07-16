import type { DisplayMode, TaskProgress, TaskStatus } from "../shared/protocol";
import {
  DEFAULT_DARK_TRANSLATION_COLOR,
  DEFAULT_TRANSLATION_COLOR,
  normalizeTranslationColor,
} from "../shared/preferences";

export const STYLE_ID = "benyi-translation-style";
export const SOURCE_ATTRIBUTE = "data-benyi-source";
export const MODE_ATTRIBUTE = "data-benyi-mode";
export const TASK_NOTICE_ID = "benyi-task-notice";

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

export function applyTranslationColor(document: Document, color: string | undefined): void {
  const normalizedColor = normalizeTranslationColor(color);
  document.getElementById(STYLE_ID)?.remove();
  ensureTranslationStyle(document, normalizedColor);
}

export function clearTranslationUi(document: Document): void {
  document.querySelectorAll<HTMLElement>("[data-benyi-translation]").forEach((node) => node.remove());
  document.querySelectorAll<HTMLElement>("[data-benyi-source]").forEach((node) => {
    node.removeAttribute(SOURCE_ATTRIBUTE);
  });
  document.documentElement.removeAttribute(MODE_ATTRIBUTE);
  document.getElementById(STYLE_ID)?.remove();
  document.getElementById(TASK_NOTICE_ID)?.remove();
}

export function renderTaskNotice(
  document: Document,
  status: TaskStatus,
  progress: TaskProgress,
): HTMLElement | undefined {
  if (status === "idle") {
    document.getElementById(TASK_NOTICE_ID)?.remove();
    return undefined;
  }

  let host = document.getElementById(TASK_NOTICE_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = TASK_NOTICE_ID;
    host.dataset.benyiRoot = "task-notice";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; color-scheme: light dark; }
      .notice {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483646;
        box-sizing: border-box;
        max-width: min(320px, calc(100vw - 36px));
        padding: 10px 14px;
        border: 1px solid rgba(44, 92, 61, 0.18);
        border-radius: 13px;
        background: rgba(250, 253, 251, 0.96);
        color: #21452d;
        box-shadow: 0 10px 32px rgba(26, 67, 41, 0.18);
        font: 650 13px/1.45 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        backdrop-filter: blur(14px);
      }
      .notice[data-tone="success"] { border-color: rgba(40, 122, 73, 0.32); color: #216b3e; }
      .notice[data-tone="error"] { border-color: rgba(163, 60, 56, 0.28); color: #9a3532; }
      @media (prefers-color-scheme: dark) {
        .notice { border-color: rgba(183, 216, 193, 0.18); background: rgba(27, 35, 30, 0.96); color: #dcebe0; }
        .notice[data-tone="success"] { color: #78d394; }
        .notice[data-tone="error"] { color: #f0a09b; }
      }
    `;
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    shadow.append(style, notice);
    (host as HTMLElement & { __benyiNotice?: HTMLElement }).__benyiNotice = notice;
    (document.body ?? document.documentElement).append(host);
  }

  const target = (host as HTMLElement & { __benyiNotice?: HTMLElement }).__benyiNotice;
  if (target) updateTaskNotice(target, status, progress);
  return host;
}

function updateTaskNotice(target: HTMLElement, status: TaskStatus, progress: TaskProgress): void {
  target.textContent = taskNoticeText(status, progress);
  target.dataset.tone =
    status === "completed" ? "success" : status === "failed" ? "error" : "active";
}

export function taskNoticeText(status: TaskStatus, progress: TaskProgress): string {
  const handled = progress.completed + progress.failed + progress.skipped;
  return (
    status === "collecting" || status === "preparing"
      ? "本译正在准备本地翻译…"
      : status === "translating"
        ? progress.total > 0
          ? `本译正在翻译 ${handled} / ${progress.total}`
          : "本译正在翻译当前页面…"
        : status === "paused"
          ? "本译翻译已暂停"
          : status === "cancelled"
            ? "本译翻译已取消"
            : status === "completed"
              ? "本译翻译完成"
              : "本译翻译未完成，请重试"
  );
}

export function ensureTranslationStyle(document: Document, customColor?: string): void {
  if (document.getElementById(STYLE_ID)) return;
  const lightColor = customColor ?? DEFAULT_TRANSLATION_COLOR;
  const darkColor = customColor ?? DEFAULT_DARK_TRANSLATION_COLOR;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    [data-benyi-translation] {
      display: block !important;
      margin-block: 0.45em 0.8em !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      color: ${lightColor} !important;
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
      [data-benyi-translation] { color: ${darkColor} !important; }
    }
  `;
  (document.head ?? document.documentElement).append(style);
}
