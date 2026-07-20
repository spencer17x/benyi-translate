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
import { isPageCommandMessage } from "../shared/engine-protocol";
import { PANEL_COMMANDS } from "../shared/commands";
import { hashText, isProbablyChinese, normalizeText, shouldSkipText } from "../shared/text";
import { createId } from "../shared/id";
import { normalizeTranslationColor, TRANSLATION_COLOR_STORAGE_KEY } from "../shared/preferences";
import { translateText } from "../translation/translate";
import { candidateSelector, preferredDeclaredLanguage } from "./candidates";
import {
  applyDisplayMode,
  applyTranslationColor,
  clearTranslationUi,
  renderTaskNotice,
  renderTranslationNode,
  SOURCE_ATTRIBUTE,
  STYLE_ID,
  TASK_NOTICE_ID,
} from "./dom";
import { observePageNavigation } from "./navigation";
import { initializeSelectionTranslation } from "./selection";
import { acceptsDynamicContent } from "./task-policy";

declare global {
  var __benyiContentScriptInstance: { buildId: string; dispose(): void } | undefined;
}

declare const __BENYI_BUILD_ID__: string;

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
const SOURCE_LANGUAGE = "en";
const TARGET_LANGUAGE = "zh";
const DETECTION_CONFIDENCE = 0.6;

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

if (globalThis.__benyiContentScriptInstance?.buildId !== __BENYI_BUILD_ID__) {
  globalThis.__benyiContentScriptInstance?.dispose();
  globalThis.__benyiContentScriptInstance = {
    buildId: __BENYI_BUILD_ID__,
    dispose: initializeContentScript(),
  };
}

function initializeContentScript(): () => void {
  const supportedSelector = candidateSelector(location.hostname);
  const selectionTranslation = initializeSelectionTranslation();
  let pageId = createId();
  let activeTask: PageTask | undefined;
  let activePort: chrome.runtime.Port | undefined;
  let trustedTabId: number | undefined;
  let segmentCounter = 0;
  let mutationTimer: number | undefined;
  let taskNoticeTimer: number | undefined;
  let pageTranslator: Translator | undefined;
  let pageDetector: LanguageDetector | undefined;
  let modelController: AbortController | undefined;
  let translationController: AbortController | undefined;
  let processing = false;
  let translationColor: string | undefined;
  const elementSegments = new WeakMap<HTMLElement, string>();
  const translationCache = new Map<string, string>();
  const preferencesReady = loadTranslationColor();

  const handleRuntimeMessage: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
    message: unknown,
    _sender,
    sendResponse,
  ) => {
    if (isPageCommandMessage(message)) {
      trustedTabId = message.tabId;
      void handlePageCommand(message.command);
      sendResponse({ accepted: true });
      return false;
    }
    if (isPanelToPageMessage(message)) {
      void handlePanelMessage(message);
      return false;
    }
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
  };

  const handleRuntimeConnect = (port: chrome.runtime.Port): void => {
    if (port.name !== TASK_PORT_NAME) return;

    if (activePort && activePort !== port) activePort.disconnect();
    activePort = port;

    port.onMessage.addListener((message: unknown) => {
      if (!isPanelToPageMessage(message)) return;
      void handlePanelMessage(message);
    });

    port.onDisconnect.addListener(() => {
      if (activePort !== port) return;
      activePort = undefined;
    });
  };

  const handlePreferenceChange: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
    changes,
    areaName,
  ) => {
    if (areaName !== "local" || !(TRANSLATION_COLOR_STORAGE_KEY in changes)) return;
    translationColor = normalizeTranslationColor(changes[TRANSLATION_COLOR_STORAGE_KEY]?.newValue);
    if (document.getElementById(STYLE_ID)) applyTranslationColor(document, translationColor);
  };

  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  chrome.runtime.onConnect.addListener(handleRuntimeConnect);
  chrome.storage.onChanged.addListener(handlePreferenceChange);

  const navigationObserver = observePageNavigation(window, invalidateForNavigation);
  const observer = new MutationObserver((mutations) => {
    navigationObserver.check();
    if (!activeTask || !acceptsDynamicContent(activeTask.status)) return;
    const hasPageChange = mutations.some(
      (mutation) =>
        (mutation.type === "characterData" && !isExtensionNode(mutation.target)) ||
        [...mutation.addedNodes, ...mutation.removedNodes].some((node) => !isExtensionNode(node)),
    );
    if (!hasPageChange) return;

    window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(() => {
      void processDynamicContent();
    }, 250);
  });

  observer.observe(document.documentElement, {
    characterData: true,
    childList: true,
    subtree: true,
  });
  return dispose;

  function dispose(): void {
    try {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
      chrome.runtime.onConnect.removeListener(handleRuntimeConnect);
      chrome.storage.onChanged.removeListener(handlePreferenceChange);
    } catch {
      // The previous extension context can already be invalid after a development reload.
    }
    observer.disconnect();
    navigationObserver.dispose();
    window.clearTimeout(mutationTimer);
    window.clearTimeout(taskNoticeTimer);
    activePort?.disconnect();
    selectionTranslation.dispose();
    undoPage(false);
  }

  async function loadTranslationColor(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(TRANSLATION_COLOR_STORAGE_KEY);
      translationColor = normalizeTranslationColor(stored[TRANSLATION_COLOR_STORAGE_KEY]);
    } catch {
      translationColor = undefined;
    }
  }

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
          translationController?.abort();
          sendPageState();
        }
        break;
      case "TRANSLATION_CANCEL":
        if (matchesActiveTask(message) && activeTask) {
          cancelTask();
        }
        break;
      case "TRANSLATION_RESULT":
        if (matchesActiveTask(message)) applyResults(message.results);
        break;
      case "TASK_COMPLETE":
        if (matchesActiveTask(message) && activeTask?.status === "translating") {
          activeTask.status = "completed";
          destroyPageModels();
          sendPageState();
        }
        break;
      case "TASK_FAIL":
        if (matchesActiveTask(message) && activeTask) {
          activeTask.status = "failed";
          sendTaskError(message.errorCode);
          destroyPageModels();
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

  async function handlePageCommand(
    command: (typeof PANEL_COMMANDS)[keyof typeof PANEL_COMMANDS],
  ): Promise<void> {
    if (trustedTabId === undefined) return;

    switch (command) {
      case PANEL_COMMANDS.translatePage:
        if (activeTask?.status === "paused") {
          await resumeTask(identity());
        } else {
          await startTask({
            version: PROTOCOL_VERSION,
            type: "PAGE_COLLECT",
            tabId: trustedTabId,
            pageId,
            taskId: createId(),
            sourceLanguage: "en",
            targetLanguage: "zh",
            mode: activeTask?.mode ?? "bilingual",
          });
        }
        break;
      case PANEL_COMMANDS.togglePause:
        if (activeTask?.status === "translating") {
          activeTask.status = "paused";
          translationController?.abort();
          sendPageState();
        } else if (activeTask?.status === "paused") {
          await resumeTask(identity());
        }
        break;
      case PANEL_COMMANDS.cancelTranslation:
        if (activeTask) cancelTask();
        break;
      case PANEL_COMMANDS.undoTranslation:
        undoPage();
        break;
      case PANEL_COMMANDS.cycleDisplayMode:
        if (activeTask) {
          const modes: DisplayMode[] = ["original", "bilingual", "translation"];
          const currentIndex = modes.indexOf(activeTask.mode);
          activeTask.mode = modes[(currentIndex + 1) % modes.length]!;
          applyDisplayMode(document, activeTask.mode);
          sendPageState();
        }
        break;
    }
  }

  async function startTask(
    message: Extract<PanelToPageMessage, { type: "PAGE_COLLECT" }>,
  ): Promise<void> {
    await preferencesReady;
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
    applyTranslationColor(document, translationColor);
    sendPageState();

    await discoverSegments();
    if (!matchesActiveTask(message) || !activeTask) return;

    if (activeTask.segments.size === 0) {
      activeTask.status = "completed";
      sendPageState();
      return;
    }

    activeTask.status = "preparing";
    sendPageState();
    try {
      const approved = await preparePageModels();
      if (!matchesActiveTask(message) || !activeTask) return;
      if (!approved) {
        activeTask.status = "completed";
        destroyPageModels();
        sendPageState();
        return;
      }
      activeTask.status = "translating";
      sendPageState();
      await processPendingSegments();
    } catch (error) {
      failActiveTask(error);
    }
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
    try {
      if (!pageTranslator) {
        activeTask.status = "preparing";
        sendPageState();
        const approved = await preparePageModels();
        if (!matchesActiveTask(message) || !activeTask) return;
        if (!approved) {
          activeTask.status = "completed";
          destroyPageModels();
          sendPageState();
          return;
        }
      }
      activeTask.status = "translating";
      sendPageState();
      await processPendingSegments();
    } catch (error) {
      failActiveTask(error);
    }
  }

  async function preparePageModels(): Promise<boolean> {
    if (!activeTask) return false;
    if (pageTranslator) return true;
    if (!("Translator" in globalThis)) throw new PageTranslationError("API_UNSUPPORTED");

    modelController?.abort();
    const controller = new AbortController();
    modelController = controller;
    const states = Array.from(activeTask.segments.values()).sort(
      (left, right) => left.input.priority - right.input.priority,
    );
    const sourceSample = states
      .map((state) => state.input.sourceText)
      .join("\n")
      .slice(0, SAMPLE_LIMIT);
    const declaredLanguage = preferredDeclaredLanguage(
      states.map((state) => state.element),
      document.documentElement.lang || undefined,
    );

    const availability = await Translator.availability({
      sourceLanguage: SOURCE_LANGUAGE,
      targetLanguage: TARGET_LANGUAGE,
    });
    if (availability === "unavailable") throw new PageTranslationError("PAIR_UNAVAILABLE");

    const [translator, detector] = await Promise.all([
      Translator.create({
        sourceLanguage: SOURCE_LANGUAGE,
        targetLanguage: TARGET_LANGUAGE,
        signal: controller.signal,
      }),
      prepareDetector(controller.signal),
    ]);
    if (!activeTask || controller.signal.aborted) {
      translator.destroy();
      detector?.destroy();
      throw new DOMException("Cancelled", "AbortError");
    }
    pageTranslator = translator;
    pageDetector = detector;
    modelController = undefined;

    let sourceLanguage = languageBase(declaredLanguage);
    if (pageDetector && sourceSample) {
      try {
        const [result] = await pageDetector.detect(sourceSample);
        const detected = languageBase(result?.detectedLanguage);
        if (detected && (result?.confidence ?? 0) >= DETECTION_CONFIDENCE) {
          sourceLanguage = detected;
        }
      } catch {
        // Fall back to a declared language, or the configured English source.
      } finally {
        pageDetector.destroy();
        pageDetector = undefined;
      }
    }

    if (sourceLanguage === "zh") return false;
    if (sourceLanguage && sourceLanguage !== SOURCE_LANGUAGE) {
      throw new PageTranslationError("SOURCE_LANGUAGE_UNSUPPORTED");
    }
    return true;
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
          existing.input = createSegmentInput(
            existing.input.segmentId,
            sourceText,
            contentHash,
            element,
            index,
          );
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

  async function processDynamicContent(): Promise<void> {
    const task = activeTask;
    if (!task || !acceptsDynamicContent(task.status)) return;

    await discoverSegments();
    if (activeTask !== task || !acceptsDynamicContent(task.status)) return;

    const hasQueuedSegments = Array.from(task.segments.values()).some(
      (state) => state.status === "queued",
    );
    if (!hasQueuedSegments) {
      sendPageState();
      return;
    }

    try {
      if (!pageTranslator) {
        task.status = "preparing";
        sendPageState();
        const approved = await preparePageModels();
        if (activeTask !== task) return;
        if (!approved) {
          task.status = "completed";
          destroyPageModels();
          sendPageState();
          return;
        }
      }

      task.status = "translating";
      sendPageState();
      await processPendingSegments();
    } catch (error) {
      failActiveTask(error);
    }
  }

  async function processPendingSegments(): Promise<void> {
    if (processing || !activeTask || activeTask.status !== "translating" || !pageTranslator) return;
    processing = true;

    try {
      while (activeTask?.status === "translating") {
        const state = Array.from(activeTask.segments.values())
          .filter((candidate) => candidate.status === "queued")
          .sort((left, right) => left.input.priority - right.input.priority)[0];
        if (!state) break;

        state.status = "sent";
        const controller = new AbortController();
        translationController = controller;
        try {
          const translatedText = await translateText(
            pageTranslator,
            state.input.sourceText,
            controller.signal,
          );
          applyResults([
            {
              segmentId: state.input.segmentId,
              contentHash: state.input.contentHash,
              status: "translated",
              translatedText,
            },
          ]);
        } catch (error) {
          if (isAbortError(error)) {
            if (state.status === "sent") state.status = "queued";
            break;
          }
          applyResults([
            {
              segmentId: state.input.segmentId,
              contentHash: state.input.contentHash,
              status: "failed",
              errorCode: errorCode(error),
            },
          ]);
        } finally {
          if (translationController === controller) translationController = undefined;
        }
      }

      if (
        activeTask?.status === "translating" &&
        !Array.from(activeTask.segments.values()).some(
          (state) => state.status === "queued" || state.status === "sent",
        )
      ) {
        activeTask.status = "completed";
        destroyPageModels();
        sendPageState();
      }
    } finally {
      processing = false;
    }
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

  function cancelTask(): void {
    if (!activeTask) return;
    activeTask.status = "cancelled";
    for (const state of activeTask.segments.values()) {
      if (state.status === "queued" || state.status === "sent") state.status = "cancelled";
    }
    destroyPageModels();
    sendPageState();
  }

  function failActiveTask(error: unknown): void {
    if (!activeTask || isAbortError(error)) return;
    activeTask.status = "failed";
    sendTaskError(errorCode(error));
    destroyPageModels();
    sendPageState();
  }

  function destroyPageModels(): void {
    modelController?.abort();
    translationController?.abort();
    pageDetector?.destroy();
    pageTranslator?.destroy();
    modelController = undefined;
    translationController = undefined;
    pageDetector = undefined;
    pageTranslator = undefined;
  }

  function undoPage(notify = true): void {
    destroyPageModels();
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
    const progress = getProgress(activeTask);
    postToPanel({
      version: PROTOCOL_VERSION,
      type: "TASK_PROGRESS",
      ...identity(),
      progress,
    });
    renderTaskNotice(document, activeTask.status, progress);
  }

  function sendPageState(): void {
    if (trustedTabId === undefined) return;
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
    window.clearTimeout(taskNoticeTimer);
    renderTaskNotice(document, message.status, message.progress);
    if (message.status === "completed" || message.status === "cancelled") {
      taskNoticeTimer = window.setTimeout(() => {
        document.getElementById(TASK_NOTICE_ID)?.remove();
      }, 2_400);
    }
  }

  function sendTaskError(errorCode: string): void {
    if (!activeTask || trustedTabId === undefined) return;
    const message: PageToPanelMessage = {
      version: PROTOCOL_VERSION,
      type: "TASK_ERROR",
      ...identity(),
      errorCode,
    };
    postToPanel(message);
  }

  function postToPanel(message: PageToPanelMessage): void {
    try {
      activePort?.postMessage(message);
    } catch {
      activePort = undefined;
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
    const element = node instanceof Element ? node : node.parentElement;
    return Boolean(element?.closest("[data-benyi-translation], [data-benyi-root]"));
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

async function prepareDetector(signal: AbortSignal): Promise<LanguageDetector | undefined> {
  if (!("LanguageDetector" in globalThis)) return undefined;
  try {
    return await LanguageDetector.create({ signal });
  } catch {
    return undefined;
  }
}

function languageBase(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase().split("-")[0] || undefined;
}

function errorCode(error: unknown): string {
  if (error instanceof PageTranslationError) return error.code;
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "USER_ACTIVATION_REQUIRED";
    if (error.name === "NotSupportedError") return "PAIR_UNAVAILABLE";
    if (error.name === "NetworkError") return "MODEL_DOWNLOAD_FAILED";
    if (error.name === "QuotaExceededError") return "INPUT_TOO_LARGE";
    if (error.name === "AbortError") return "TRANSLATION_CANCELLED";
  }
  return "UNKNOWN_ERROR";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

class PageTranslationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PageTranslationError";
  }
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
