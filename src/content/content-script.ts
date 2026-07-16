import {
  isPanelToPageMessage,
  isPingMessage,
  isSelectionTranslateMessage,
  MAX_BATCH_SEGMENTS,
  PROTOCOL_VERSION,
  TASK_PORT_NAME,
  type DisplayMode,
  type PageToPanelMessage,
  type PanelToPageMessage,
  type PingResponse,
  type SegmentInput,
  type SegmentResult,
  type TaskIdentity,
  type TaskProgress,
  type TaskStatus,
} from "../shared/protocol";
import {
  batchSegments,
  hashText,
  isProbablyChinese,
  normalizeText,
  shouldSkipText,
} from "../shared/text";
import { createId } from "../shared/id";
import { candidateSelector, preferredDeclaredLanguage } from "./candidates";
import {
  applyDisplayMode,
  clearTranslationUi,
  renderTranslationNode,
  SOURCE_ATTRIBUTE,
} from "./dom";
import { initializeSelectionTranslation } from "./selection";

declare global {
  var __benyiContentScriptLoaded: boolean | undefined;
}

const EXCLUDED_SELECTOR = [
  "script",
  "style",
  "noscript",
  "textarea",
  "input",
  "select",
  "option",
  "pre",
  "code",
  "svg",
  "canvas",
  "[contenteditable='true']",
  "[contenteditable='']",
  "[data-benyi-translation]",
  "[data-benyi-root]",
].join(", ");
const CACHE_SCHEMA_VERSION = 1;
const CACHE_LIMIT = 1_000;
const SAMPLE_LIMIT = 4_000;

type SegmentStatus = "queued" | "sent" | "translated" | "failed" | "cancelled";

type SegmentState = {
  element: HTMLElement;
  input: SegmentInput;
  status: SegmentStatus;
  translationNode?: HTMLElement;
};

type PageTask = {
  taskId: string;
  sourceLanguage: string;
  targetLanguage: string;
  status: TaskStatus;
  mode: DisplayMode;
  segments: Map<string, SegmentState>;
};

if (!globalThis.__benyiContentScriptLoaded) {
  globalThis.__benyiContentScriptLoaded = true;
  initializeContentScript();
}

function initializeContentScript(): void {
  const supportedSelector = candidateSelector(location.hostname);
  const selectionTranslation = initializeSelectionTranslation();
  let pageId = createId();
  let activeTask: PageTask | undefined;
  let activePort: chrome.runtime.Port | undefined;
  let trustedTabId: number | undefined;
  let segmentCounter = 0;
  let mutationTimer: number | undefined;
  const elementSegments = new WeakMap<HTMLElement, string>();
  const translationCache = new Map<string, string>();

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (isSelectionTranslateMessage(message)) {
      void selectionTranslation.translate(message.sourceText);
      sendResponse({ accepted: true });
      return false;
    }
    if (!isPingMessage(message)) return false;

    const response: PingResponse = {
      version: PROTOCOL_VERSION,
      type: "BENYI_PONG",
      pageId,
    };
    sendResponse(response);
    return false;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== TASK_PORT_NAME) return;

    if (activePort && activePort !== port) activePort.disconnect();
    activePort = port;
    trustedTabId = undefined;

    port.onMessage.addListener((message: unknown) => {
      if (!isPanelToPageMessage(message)) return;
      void handlePanelMessage(message);
    });

    port.onDisconnect.addListener(() => {
      if (activePort !== port) return;
      if (activeTask && ["collecting", "preparing", "translating"].includes(activeTask.status)) {
        activeTask.status = "paused";
      }
      activePort = undefined;
      trustedTabId = undefined;
    });
  });

  const observer = new MutationObserver((mutations) => {
    if (!activeTask || activeTask.status !== "translating" || !activePort) return;
    const hasPageChange = mutations.some(
      (mutation) =>
        (mutation.type === "characterData" && !isExtensionNode(mutation.target)) ||
        [...mutation.addedNodes].some((node) => !isExtensionNode(node)),
    );
    if (!hasPageChange) return;

    window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(() => {
      void sendNewSegments();
    }, 250);
  });

  observer.observe(document.documentElement, { characterData: true, childList: true, subtree: true });
  window.addEventListener("popstate", invalidateForNavigation);
  window.addEventListener("hashchange", invalidateForNavigation);

  async function handlePanelMessage(message: PanelToPageMessage): Promise<void> {
    if (message.type === "PANEL_HELLO") {
      trustedTabId = message.tabId;
      sendPageState();
      return;
    }

    if (trustedTabId === undefined || message.tabId !== trustedTabId || message.pageId !== pageId) {
      return;
    }

    switch (message.type) {
      case "PAGE_COLLECT":
        await startTask(message);
        break;
      case "TRANSLATION_RESUME":
        await resumeTask(message);
        break;
      case "TRANSLATION_PAUSE":
        if (matchesActiveTask(message) && activeTask) {
          activeTask.status = "paused";
          sendPageState();
        }
        break;
      case "TRANSLATION_CANCEL":
        if (matchesActiveTask(message) && activeTask) {
          activeTask.status = "cancelled";
          for (const state of activeTask.segments.values()) {
            if (state.status === "queued" || state.status === "sent") state.status = "cancelled";
          }
          sendPageState();
        }
        break;
      case "TRANSLATION_RESULT":
        if (matchesActiveTask(message)) applyResults(message.results);
        break;
      case "TASK_COMPLETE":
        if (matchesActiveTask(message) && activeTask?.status === "translating") {
          activeTask.status = "completed";
          sendPageState();
        }
        break;
      case "TASK_FAIL":
        if (matchesActiveTask(message) && activeTask) {
          activeTask.status = "failed";
          sendTaskError(message.errorCode);
          sendPageState();
        }
        break;
      case "PAGE_MODE_SET":
        if (matchesActiveTask(message) && activeTask) {
          activeTask.mode = message.mode;
          applyDisplayMode(document, message.mode);
          sendPageState();
        }
        break;
      case "PAGE_UNDO":
        if (matchesActiveTask(message)) undoPage();
        break;
    }
  }

  async function startTask(message: Extract<PanelToPageMessage, { type: "PAGE_COLLECT" }>): Promise<void> {
    if (activeTask?.taskId !== message.taskId) undoPage(false);

    activeTask = {
      taskId: message.taskId,
      sourceLanguage: message.sourceLanguage,
      targetLanguage: message.targetLanguage,
      status: "collecting",
      mode: message.mode,
      segments: new Map(),
    };
    applyDisplayMode(document, message.mode);
    sendPageState();

    await discoverSegments();
    if (!matchesActiveTask(message) || !activeTask) return;

    activeTask.status = "translating";
    sendCollection(Array.from(activeTask.segments.values()));
    sendPendingSegments();
    sendPageState();
  }

  async function resumeTask(message: TaskIdentity): Promise<void> {
    if (!matchesActiveTask(message) || !activeTask) return;
    activeTask.status = "collecting";
    sendPageState();
    await discoverSegments();
    if (!matchesActiveTask(message) || !activeTask) return;

    for (const state of activeTask.segments.values()) {
      if (state.status === "sent" || state.status === "cancelled") state.status = "queued";
    }
    activeTask.status = "translating";
    sendCollection(Array.from(activeTask.segments.values()).filter((state) => state.status !== "translated"));
    sendPendingSegments();
    sendPageState();
  }

  async function discoverSegments(): Promise<void> {
    if (!activeTask) return;
    const elements = Array.from(document.querySelectorAll<HTMLElement>(supportedSelector));

    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      if (!element || !isReadableElement(element)) continue;

      const sourceText = normalizeText(element.innerText);
      if (shouldSkipText(sourceText) || isProbablyChinese(sourceText)) continue;

      const contentHash = hashText(sourceText);
      const existingId = elementSegments.get(element);
      const existing = existingId ? activeTask.segments.get(existingId) : undefined;

      if (existing) {
        if (existing.input.contentHash !== contentHash) {
          existing.translationNode?.remove();
          existing.translationNode = undefined;
          existing.input = createSegmentInput(existing.input.segmentId, sourceText, contentHash, element, index);
          existing.status = "queued";
        }
      } else {
        const segmentId = `segment-${++segmentCounter}`;
        const input = createSegmentInput(segmentId, sourceText, contentHash, element, index);
        const cached = readCache(input);
        const state: SegmentState = { element, input, status: cached ? "translated" : "queued" };
        activeTask.segments.set(segmentId, state);
        elementSegments.set(element, segmentId);
        if (cached) renderTranslation(state, cached);
      }

      if (index > 0 && index % 100 === 0) await yieldToMainThread();
    }

    for (const [segmentId, state] of activeTask.segments) {
      if (state.element.isConnected) continue;
      state.translationNode?.remove();
      activeTask.segments.delete(segmentId);
    }
  }

  function createSegmentInput(
    segmentId: string,
    sourceText: string,
    contentHash: string,
    element: HTMLElement,
    order: number,
  ): SegmentInput {
    if (!activeTask) throw new Error("No active page task");
    return {
      segmentId,
      sourceText,
      contentHash,
      sourceLanguage: activeTask.sourceLanguage,
      targetLanguage: activeTask.targetLanguage,
      priority: getViewportPriority(element) * 1_000_000 + order,
    };
  }

  function sendCollection(states: SegmentState[]): void {
    if (!activeTask || trustedTabId === undefined) return;
    const sorted = [...states].sort((left, right) => left.input.priority - right.input.priority);
    const sourceSample = sorted
      .map((state) => state.input.sourceText)
      .join("\n")
      .slice(0, SAMPLE_LIMIT);
    postToPanel({
      version: PROTOCOL_VERSION,
      type: "PAGE_COLLECTION",
      ...identity(),
      declaredLanguage: preferredDeclaredLanguage(
        sorted.map((state) => state.element),
        document.documentElement.lang || undefined,
      ),
      sourceSample,
      total: activeTask.segments.size,
    });
  }

  function sendPendingSegments(): void {
    if (!activeTask) return;
    const pending = Array.from(activeTask.segments.values())
      .filter((state) => state.status === "queued")
      .sort((left, right) => left.input.priority - right.input.priority);
    const batches = batchSegments(pending.map((state) => state.input));

    if (batches.length === 0) {
      postToPanel({
        version: PROTOCOL_VERSION,
        type: "PAGE_SEGMENTS",
        ...identity(),
        batchId: createId(),
        segments: [],
        done: true,
      });
      return;
    }

    batches.forEach((segments, index) => {
      for (const segment of segments) {
        const state = activeTask?.segments.get(segment.segmentId);
        if (state) state.status = "sent";
      }
      postToPanel({
        version: PROTOCOL_VERSION,
        type: "PAGE_SEGMENTS",
        ...identity(),
        batchId: createId(),
        segments,
        done: index === batches.length - 1,
      });
    });
  }

  async function sendNewSegments(): Promise<void> {
    if (!activeTask || activeTask.status !== "translating") return;
    await discoverSegments();
    if (!activeTask || activeTask.status !== "translating") return;
    const queued = Array.from(activeTask.segments.values()).filter((state) => state.status === "queued");
    if (queued.length === 0) return;
    sendCollection(queued);
    sendPendingSegments();
    sendPageState();
  }

  function applyResults(results: SegmentResult[]): void {
    if (!activeTask || activeTask.status !== "translating") return;

    for (const result of results.slice(0, MAX_BATCH_SEGMENTS)) {
      const state = activeTask.segments.get(result.segmentId);
      if (!state || state.input.contentHash !== result.contentHash) continue;
      if (!state.element.isConnected || hashText(state.element.innerText) !== result.contentHash) {
        state.status = "queued";
        continue;
      }

      if (result.status === "translated" && result.translatedText !== undefined) {
        renderTranslation(state, result.translatedText);
        writeCache(state.input, result.translatedText);
        state.status = "translated";
      } else if (result.status === "failed") {
        state.status = "failed";
      } else {
        state.status = "queued";
      }
    }

    sendProgress();
  }

  function renderTranslation(state: SegmentState, translatedText: string): void {
    state.translationNode?.remove();
    state.translationNode = renderTranslationNode(
      document,
      state.element,
      state.input.segmentId,
      translatedText,
    );
  }

  function undoPage(notify = true): void {
    if (activeTask) {
      for (const state of activeTask.segments.values()) {
        state.translationNode?.remove();
        state.element.removeAttribute(SOURCE_ATTRIBUTE);
      }
    }
    clearTranslationUi(document);
    activeTask = undefined;
    if (notify) sendPageState();
  }

  function invalidateForNavigation(): void {
    if (activeTask && trustedTabId !== undefined) sendTaskError("PAGE_NAVIGATED");
    undoPage(false);
    pageId = createId();
    sendPageState();
  }

  function sendProgress(): void {
    if (!activeTask || trustedTabId === undefined) return;
    postToPanel({
      version: PROTOCOL_VERSION,
      type: "TASK_PROGRESS",
      ...identity(),
      progress: getProgress(activeTask),
    });
  }

  function sendPageState(): void {
    if (!activePort || trustedTabId === undefined) return;
    const message: PageToPanelMessage = activeTask
      ? {
          version: PROTOCOL_VERSION,
          type: "PAGE_STATE",
          tabId: trustedTabId,
          pageId,
          taskId: activeTask.taskId,
          status: activeTask.status,
          mode: activeTask.mode,
          progress: getProgress(activeTask),
        }
      : {
          version: PROTOCOL_VERSION,
          type: "PAGE_STATE",
          tabId: trustedTabId,
          pageId,
          status: "idle",
          mode: "bilingual",
          progress: emptyProgress(),
        };
    postToPanel(message);
  }

  function sendTaskError(errorCode: string): void {
    if (!activeTask || trustedTabId === undefined) return;
    postToPanel({
      version: PROTOCOL_VERSION,
      type: "TASK_ERROR",
      ...identity(),
      errorCode,
    });
  }

  function postToPanel(message: PageToPanelMessage): void {
    try {
      activePort?.postMessage(message);
    } catch {
      if (activeTask && activeTask.status === "translating") activeTask.status = "paused";
    }
  }

  function matchesActiveTask(message: TaskIdentity): boolean {
    return (
      activeTask !== undefined &&
      trustedTabId === message.tabId &&
      pageId === message.pageId &&
      activeTask.taskId === message.taskId
    );
  }

  function identity(): TaskIdentity {
    if (!activeTask || trustedTabId === undefined) throw new Error("No active task identity");
    return { tabId: trustedTabId, pageId, taskId: activeTask.taskId };
  }

  function getProgress(task: PageTask): TaskProgress {
    let completed = 0;
    let failed = 0;
    let skipped = 0;
    for (const state of task.segments.values()) {
      if (state.status === "translated") completed += 1;
      if (state.status === "failed") failed += 1;
      if (state.status === "cancelled") skipped += 1;
    }
    return { total: task.segments.size, completed, failed, skipped };
  }

  function emptyProgress(): TaskProgress {
    return { total: 0, completed: 0, failed: 0, skipped: 0 };
  }

  function isReadableElement(element: HTMLElement): boolean {
    if (element.closest(EXCLUDED_SELECTOR)) return false;
    if (element.querySelector(supportedSelector)) return false;
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    if (element.getClientRects().length === 0) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function getViewportPriority(element: HTMLElement): number {
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    if (rect.bottom >= 0 && rect.top <= viewportHeight) return 0;
    if (rect.bottom >= -viewportHeight && rect.top <= viewportHeight * 2) return 1;
    return 2;
  }

  function isExtensionNode(node: Node): boolean {
    return node instanceof Element && Boolean(node.closest("[data-benyi-translation], [data-benyi-root]"));
  }

  function cacheKey(input: SegmentInput): string {
    return `${CACHE_SCHEMA_VERSION}:${input.sourceLanguage}:${input.targetLanguage}:${input.contentHash}`;
  }

  function readCache(input: SegmentInput): string | undefined {
    const key = cacheKey(input);
    const value = translationCache.get(key);
    if (value === undefined) return undefined;
    translationCache.delete(key);
    translationCache.set(key, value);
    return value;
  }

  function writeCache(input: SegmentInput, translatedText: string): void {
    const key = cacheKey(input);
    translationCache.delete(key);
    translationCache.set(key, translatedText);
    if (translationCache.size <= CACHE_LIMIT) return;
    const oldestKey = translationCache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) translationCache.delete(oldestKey);
  }
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
