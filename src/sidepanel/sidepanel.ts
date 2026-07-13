import {
  isPageToPanelMessage,
  PROTOCOL_VERSION,
  TASK_PORT_NAME,
  type DisplayMode,
  type PageToPanelMessage,
  type PanelToPageMessage,
  type PingMessage,
  type PingResponse,
  type SegmentInput,
  type SegmentResult,
  type TaskIdentity,
  type TaskProgress,
  type TaskStatus,
} from "../shared/protocol";
import { createId } from "../shared/id";
import { translateText } from "../translation/translate";

const SOURCE_LANGUAGE = "en";
const TARGET_LANGUAGE = "zh";
const DETECTION_CONFIDENCE = 0.6;

const statusElement = requiredElement<HTMLParagraphElement>("status");
const statusDot = requiredElement<HTMLSpanElement>("status-dot");
const progressWrap = requiredElement<HTMLDivElement>("progress-wrap");
const progressElement = requiredElement<HTMLProgressElement>("progress");
const progressLabel = requiredElement<HTMLSpanElement>("progress-label");
const startButton = requiredElement<HTMLButtonElement>("start");
const pauseButton = requiredElement<HTMLButtonElement>("pause");
const cancelButton = requiredElement<HTMLButtonElement>("cancel");
const undoButton = requiredElement<HTMLButtonElement>("undo");
const totalMetric = requiredElement<HTMLElement>("metric-total");
const completedMetric = requiredElement<HTMLElement>("metric-completed");
const failedMetric = requiredElement<HTMLElement>("metric-failed");
const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-mode]"));

let activeTabId: number | undefined;
let activePort: chrome.runtime.Port | undefined;
let pageId: string | undefined;
let taskId: string | undefined;
let taskStatus: TaskStatus = "idle";
let displayMode: DisplayMode = "bilingual";
let progress: TaskProgress = emptyProgress();
let queue: SegmentInput[] = [];
let queuedSegments = new Set<string>();
let collectionDone = false;
let collectionSample: string | undefined;
let declaredLanguage: string | undefined;
let sourceApproved = false;
let modelsReady = false;
let processing = false;
let localPreparing = false;
let translator: Translator | undefined;
let detector: LanguageDetector | undefined;
let preparationController: AbortController | undefined;
let translationController: AbortController | undefined;

startButton.addEventListener("click", () => {
  void startOrResumeTranslation();
});

pauseButton.addEventListener("click", pauseTranslation);
cancelButton.addEventListener("click", cancelTranslation);
undoButton.addEventListener("click", undoTranslation);

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode;
    if (mode !== "original" && mode !== "bilingual" && mode !== "translation") return;
    displayMode = mode;
    updateModeButtons();
    const identity = currentIdentity();
    if (identity) postToPage({ version: PROTOCOL_VERSION, type: "PAGE_MODE_SET", ...identity, mode });
  });
}

chrome.tabs.onActivated.addListener(() => {
  void connectToActiveTab();
});

void connectToActiveTab();

async function connectToActiveTab(): Promise<void> {
  disconnectFromPage();
  setStatus("正在连接当前页面…", "neutral");
  startButton.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new BenyiError("NO_ACTIVE_TAB");

    activeTabId = tab.id;
    await ensureContentScript(tab.id);

    const port = chrome.tabs.connect(tab.id, { name: TASK_PORT_NAME });
    activePort = port;
    port.onMessage.addListener(handlePageMessage);
    port.onDisconnect.addListener(() => {
      if (activePort !== port) return;
      activePort = undefined;
      translationController?.abort();
      destroyModels();
      if (taskId) taskStatus = "paused";
      setStatus("页面连接已断开。重新打开或刷新页面后可继续。", "error");
      renderControls();
    });
    postToPage({ version: PROTOCOL_VERSION, type: "PANEL_HELLO", tabId: tab.id });
  } catch (error) {
    setStatus(errorMessage(error), "error");
    renderControls();
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  const ping: PingMessage = { version: PROTOCOL_VERSION, type: "BENYI_PING" };
  try {
    const response = (await chrome.tabs.sendMessage(tabId, ping)) as PingResponse | undefined;
    if (response?.type === "BENYI_PONG") return;
  } catch {
    // The expected path before the content script has been injected.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content-script.js"],
    });
    const response = (await chrome.tabs.sendMessage(tabId, ping)) as PingResponse | undefined;
    if (response?.type !== "BENYI_PONG") throw new BenyiError("CONTENT_SCRIPT_UNAVAILABLE");
  } catch {
    throw new BenyiError("PAGE_UNSUPPORTED");
  }
}

function handlePageMessage(message: unknown): void {
  if (!isPageToPanelMessage(message)) return;
  if (activeTabId !== undefined && message.tabId !== activeTabId) return;

  switch (message.type) {
    case "PAGE_STATE":
      handlePageState(message);
      break;
    case "PAGE_COLLECTION":
      if (!matchesCurrentTask(message)) return;
      collectionSample = message.sourceSample;
      declaredLanguage = message.declaredLanguage;
      progress = { ...progress, total: message.total };
      renderProgress();
      void approveSourceLanguage().catch(failTask);
      break;
    case "PAGE_SEGMENTS":
      if (!matchesCurrentTask(message)) return;
      enqueueSegments(message.segments);
      collectionDone ||= message.done;
      void processQueue().catch(failTask);
      break;
    case "TASK_PROGRESS":
      if (!matchesCurrentTask(message)) return;
      progress = message.progress;
      renderProgress();
      renderControls();
      break;
    case "TASK_STATUS":
      if (!matchesCurrentTask(message)) return;
      taskStatus = message.status;
      renderControls();
      break;
    case "TASK_ERROR":
      if (!matchesCurrentTask(message)) return;
      taskStatus = "failed";
      setStatus(errorCodeMessage(message.errorCode), "error");
      destroyModels();
      renderControls();
      break;
  }
}

function handlePageState(message: Extract<PageToPanelMessage, { type: "PAGE_STATE" }>): void {
  pageId = message.pageId;
  taskId = message.taskId;
  taskStatus = message.status;
  displayMode = message.mode;
  progress = message.progress;

  updateModeButtons();
  renderProgress();
  if (!localPreparing) renderStatusFromTask();
  renderControls();
}

async function startOrResumeTranslation(): Promise<void> {
  const tabId = activeTabId;
  const currentPageId = pageId;
  if (tabId === undefined || currentPageId === undefined || !activePort) return;

  const isResume = taskStatus === "paused" && taskId !== undefined;
  const nextTaskId: string = isResume ? taskId! : createId();
  taskId = nextTaskId;
  taskStatus = "preparing";
  localPreparing = true;
  sourceApproved = isResume;
  modelsReady = false;
  collectionDone = false;
  collectionSample = undefined;
  declaredLanguage = undefined;
  queue = [];
  queuedSegments = new Set();
  progress = isResume ? progress : emptyProgress();
  renderControls();
  setStatus("正在准备 Chrome 本地语言能力…", "active");

  const modelsPromise = prepareModels();
  const identity: TaskIdentity = { tabId, pageId: currentPageId, taskId: nextTaskId };
  postToPage(
    isResume
      ? { version: PROTOCOL_VERSION, type: "TRANSLATION_RESUME", ...identity }
      : {
          version: PROTOCOL_VERSION,
          type: "PAGE_COLLECT",
          ...identity,
          sourceLanguage: SOURCE_LANGUAGE,
          targetLanguage: TARGET_LANGUAGE,
          mode: displayMode,
        },
  );

  try {
    await modelsPromise;
    modelsReady = true;
    localPreparing = false;
    taskStatus = "translating";
    await approveSourceLanguage();
    renderControls();
    await processQueue();
  } catch (error) {
    failTask(error);
  }
}

async function prepareModels(): Promise<void> {
  if (translator) {
    modelsReady = true;
    return;
  }
  if (!("Translator" in self)) throw new BenyiError("API_UNSUPPORTED");

  preparationController?.abort();
  const controller = new AbortController();
  preparationController = controller;

  const availabilityPromise = Translator.availability({
    sourceLanguage: SOURCE_LANGUAGE,
    targetLanguage: TARGET_LANGUAGE,
  });
  const translatorPromise = Translator.create({
    sourceLanguage: SOURCE_LANGUAGE,
    targetLanguage: TARGET_LANGUAGE,
    signal: controller.signal,
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        showPreparationProgress(event.loaded);
      });
    },
  });

  const detectorPromise = prepareDetector(controller.signal);
  const availability = await availabilityPromise;
  if (availability === "downloadable" || availability === "downloading") {
    setStatus("正在准备英语和简体中文语言资源…", "active");
    showPreparationProgress(0);
  }
  [translator, detector] = await Promise.all([translatorPromise, detectorPromise]);
  preparationController = undefined;
  renderProgress();
}

async function prepareDetector(signal: AbortSignal): Promise<LanguageDetector | undefined> {
  if (!("LanguageDetector" in self)) return undefined;
  try {
    return await LanguageDetector.create({ signal });
  } catch {
    return undefined;
  }
}

async function approveSourceLanguage(): Promise<void> {
  if (sourceApproved || !modelsReady || collectionSample === undefined) return;
  if (progress.total === 0 || !collectionSample.trim()) {
    sourceApproved = false;
    taskStatus = "completed";
    setStatus("当前页面没有发现可翻译的正文。", "neutral");
    const identity = currentIdentity();
    if (identity) postToPage({ version: PROTOCOL_VERSION, type: "TASK_COMPLETE", ...identity });
    destroyModels();
    renderControls();
    return;
  }

  let sourceLanguage = languageBase(declaredLanguage);
  if (detector) {
    try {
      const [result] = await detector.detect(collectionSample);
      const detected = languageBase(result?.detectedLanguage);
      const confidence = result?.confidence ?? 0;
      if (detected && confidence >= DETECTION_CONFIDENCE) sourceLanguage = detected;
    } catch {
      // The declared language or English fallback remains available.
    } finally {
      detector.destroy();
      detector = undefined;
    }
  }

  if (sourceLanguage === "zh") {
    taskStatus = "completed";
    setStatus("页面主要内容已经是中文，无需翻译。", "neutral");
    const identity = currentIdentity();
    if (identity) postToPage({ version: PROTOCOL_VERSION, type: "TASK_COMPLETE", ...identity });
    translator?.destroy();
    translator = undefined;
    renderControls();
    return;
  }

  if (sourceLanguage && sourceLanguage !== "en") {
    throw new BenyiError("SOURCE_LANGUAGE_UNSUPPORTED");
  }

  sourceApproved = true;
  setStatus("正在优先翻译当前视口内容…", "active");
  await processQueue();
}

function enqueueSegments(segments: SegmentInput[]): void {
  for (const segment of segments) {
    const key = segmentKey(segment);
    if (queuedSegments.has(key)) continue;
    queuedSegments.add(key);
    queue.push(segment);
  }
  queue.sort((left, right) => left.priority - right.priority);
}

async function processQueue(): Promise<void> {
  if (processing || !translator || !sourceApproved || taskStatus !== "translating") return;
  processing = true;

  try {
    while (queue.length > 0 && taskStatus === "translating") {
      const segment = queue.shift();
      if (!segment) break;
      queuedSegments.delete(segmentKey(segment));
      const identity = currentIdentity();
      if (!identity) return;

      const controller = new AbortController();
      translationController = controller;

      try {
        const translatedText = await translateText(translator, segment.sourceText, controller.signal);
        const result: SegmentResult = {
          segmentId: segment.segmentId,
          contentHash: segment.contentHash,
          status: "translated",
          translatedText,
        };
        postResult(identity, result);
      } catch (error) {
        if (isAbortError(error)) {
          if ((taskStatus as TaskStatus) === "paused") {
            queue.unshift(segment);
            queuedSegments.add(segmentKey(segment));
          }
          break;
        }

        postResult(identity, {
          segmentId: segment.segmentId,
          contentHash: segment.contentHash,
          status: "failed",
          errorCode: errorCode(error),
        });
      } finally {
        if (translationController === controller) translationController = undefined;
      }
    }

    if (collectionDone && queue.length === 0 && taskStatus === "translating") {
      const identity = currentIdentity();
      if (identity) postToPage({ version: PROTOCOL_VERSION, type: "TASK_COMPLETE", ...identity });
      taskStatus = "completed";
      setStatus("当前页面翻译完成。", "active");
      destroyModels();
      renderControls();
    }
  } finally {
    processing = false;
  }
}

function pauseTranslation(): void {
  const identity = currentIdentity();
  if (!identity || taskStatus !== "translating") return;
  taskStatus = "paused";
  translationController?.abort();
  postToPage({ version: PROTOCOL_VERSION, type: "TRANSLATION_PAUSE", ...identity });
  setStatus("翻译已暂停，已完成的译文会保留。", "neutral");
  renderControls();
}

function cancelTranslation(): void {
  const identity = currentIdentity();
  if (!identity) return;
  taskStatus = "cancelled";
  localPreparing = false;
  preparationController?.abort();
  translationController?.abort();
  queue = [];
  queuedSegments.clear();
  collectionDone = true;
  postToPage({ version: PROTOCOL_VERSION, type: "TRANSLATION_CANCEL", ...identity });
  destroyModels();
  setStatus("翻译已取消，已完成的译文仍保留在页面中。", "neutral");
  renderControls();
}

function failTask(error: unknown): void {
  if (isAbortError(error)) return;
  localPreparing = false;
  taskStatus = "failed";
  setStatus(errorMessage(error), "error");
  const identity = currentIdentity();
  if (identity) {
    postToPage({
      version: PROTOCOL_VERSION,
      type: "TASK_FAIL",
      ...identity,
      errorCode: errorCode(error),
    });
  }
  destroyModels();
  renderControls();
}

function undoTranslation(): void {
  const identity = currentIdentity();
  if (!identity) return;
  preparationController?.abort();
  translationController?.abort();
  postToPage({ version: PROTOCOL_VERSION, type: "PAGE_UNDO", ...identity });
  destroyModels();
  queue = [];
  queuedSegments.clear();
  taskId = undefined;
  taskStatus = "idle";
  progress = emptyProgress();
  setStatus("已恢复原始页面。", "neutral");
  renderProgress();
  renderControls();
}

function postResult(identity: TaskIdentity, result: SegmentResult): void {
  const message: PanelToPageMessage = {
    version: PROTOCOL_VERSION,
    type: "TRANSLATION_RESULT",
    ...identity,
    batchId: createId(),
    results: [result],
  };
  postToPage(message);
}

function postToPage(message: PanelToPageMessage): void {
  try {
    activePort?.postMessage(message);
  } catch {
    taskStatus = taskId ? "paused" : "idle";
    setStatus("无法连接当前页面。", "error");
    renderControls();
  }
}

function currentIdentity(): TaskIdentity | undefined {
  if (activeTabId === undefined || pageId === undefined || taskId === undefined) return undefined;
  return { tabId: activeTabId, pageId, taskId };
}

function matchesCurrentTask(message: TaskIdentity): boolean {
  const identity = currentIdentity();
  return (
    identity !== undefined &&
    message.tabId === identity.tabId &&
    message.pageId === identity.pageId &&
    message.taskId === identity.taskId
  );
}

function disconnectFromPage(): void {
  translationController?.abort();
  preparationController?.abort();
  destroyModels();
  if (activePort) {
    activePort.disconnect();
    activePort = undefined;
  }
  activeTabId = undefined;
  pageId = undefined;
  taskId = undefined;
  taskStatus = "idle";
  localPreparing = false;
  queue = [];
  queuedSegments.clear();
  collectionDone = false;
  collectionSample = undefined;
  declaredLanguage = undefined;
  sourceApproved = false;
  modelsReady = false;
  progress = emptyProgress();
  renderProgress();
}

function destroyModels(): void {
  detector?.destroy();
  translator?.destroy();
  detector = undefined;
  translator = undefined;
  modelsReady = false;
  preparationController = undefined;
  translationController = undefined;
}

function showPreparationProgress(value: number): void {
  progressWrap.hidden = false;
  progressElement.max = 1;
  progressElement.value = Math.max(0, Math.min(value, 1));
  progressLabel.textContent = `${Math.round(value * 100)}%`;
}

function renderProgress(): void {
  const handled = progress.completed + progress.failed + progress.skipped;
  progressWrap.hidden = progress.total === 0 && !localPreparing;
  progressElement.max = Math.max(progress.total, 1);
  progressElement.value = Math.min(handled, progress.total);
  progressLabel.textContent = `${handled} / ${progress.total}`;
  totalMetric.textContent = String(progress.total);
  completedMetric.textContent = String(progress.completed);
  failedMetric.textContent = String(progress.failed);
}

function renderControls(): void {
  const connected = activePort !== undefined && pageId !== undefined;
  const busy = localPreparing || taskStatus === "collecting" || taskStatus === "preparing" || taskStatus === "translating";
  startButton.disabled = !connected || busy;
  startButton.textContent = taskStatus === "paused" ? "继续翻译" : "开始翻译";
  startButton.hidden = taskStatus === "translating" || localPreparing;
  pauseButton.hidden = taskStatus !== "translating";
  cancelButton.hidden = !busy && taskStatus !== "paused";
  undoButton.disabled = progress.completed === 0 || taskId === undefined;
  renderProgress();
}

function renderStatusFromTask(): void {
  switch (taskStatus) {
    case "idle":
      setStatus("已连接。点击开始后，正文只会交给 Chrome 的本地翻译能力。", "neutral");
      break;
    case "collecting":
      setStatus("正在发现当前页面中的可阅读正文…", "active");
      break;
    case "preparing":
      setStatus("正在准备 Chrome 本地语言能力…", "active");
      break;
    case "translating":
      setStatus("正在优先翻译当前视口内容…", "active");
      break;
    case "paused":
      setStatus("翻译已暂停，点击继续可处理剩余正文。", "neutral");
      break;
    case "cancelled":
      setStatus("翻译已取消，已完成的译文仍保留。", "neutral");
      break;
    case "completed":
      setStatus("当前页面翻译完成。", "active");
      break;
    case "failed":
      setStatus("翻译没有完成，请重试。", "error");
      break;
  }
}

function setStatus(message: string, state: "neutral" | "active" | "error"): void {
  statusElement.textContent = message;
  if (state === "neutral") delete statusDot.dataset.state;
  else statusDot.dataset.state = state;
}

function updateModeButtons(): void {
  for (const button of modeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === displayMode));
  }
}

function languageBase(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase().split("-")[0] || undefined;
}

function segmentKey(segment: SegmentInput): string {
  return `${segment.segmentId}:${segment.contentHash}`;
}

function emptyProgress(): TaskProgress {
  return { total: 0, completed: 0, failed: 0, skipped: 0 };
}

function errorCode(error: unknown): string {
  if (error instanceof BenyiError) return error.code;
  if (error instanceof DOMException) {
    if (error.name === "NotSupportedError") return "PAIR_UNAVAILABLE";
    if (error.name === "NetworkError") return "MODEL_DOWNLOAD_FAILED";
    if (error.name === "QuotaExceededError") return "INPUT_TOO_LARGE";
    if (error.name === "AbortError") return "TRANSLATION_CANCELLED";
  }
  return "UNKNOWN_ERROR";
}

function errorMessage(error: unknown): string {
  return errorCodeMessage(errorCode(error));
}

function errorCodeMessage(code: string): string {
  switch (code) {
    case "NO_ACTIVE_TAB":
      return "没有找到当前标签页。";
    case "PAGE_UNSUPPORTED":
      return "当前页面受浏览器保护，无法注入翻译功能。请在普通网页中使用本译。";
    case "CONTENT_SCRIPT_UNAVAILABLE":
      return "无法连接当前页面，请刷新后重试。";
    case "API_UNSUPPORTED":
      return "当前 Chrome 不支持本地 Translator API，请升级浏览器。";
    case "PAIR_UNAVAILABLE":
      return "当前设备暂不支持英语到简体中文的本地翻译。";
    case "MODEL_DOWNLOAD_FAILED":
      return "本地语言资源准备失败，请检查网络后重试。";
    case "SOURCE_LANGUAGE_UNSUPPORTED":
      return "首版目前只支持英语网页到简体中文。";
    case "PAGE_NAVIGATED":
      return "页面已发生导航，旧翻译任务已失效。";
    case "INPUT_TOO_LARGE":
      return "部分段落超过本地翻译能力的输入限制。";
    case "TRANSLATION_CANCELLED":
      return "翻译已取消。";
    default:
      return "翻译过程中发生错误，请重试。";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: ${id}`);
  return element as T;
}

class BenyiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "BenyiError";
  }
}
