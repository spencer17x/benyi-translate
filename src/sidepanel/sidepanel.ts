import {
  isPageToPanelMessage,
  PROTOCOL_VERSION,
  TASK_PORT_NAME,
  type DisplayMode,
  type PageToPanelMessage,
  type PanelToPageMessage,
  type PingMessage,
  type PingResponse,
  type TaskIdentity,
  type TaskProgress,
  type TaskStatus,
} from "../shared/protocol";
import { PANEL_COMMANDS, type PanelCommand } from "../shared/commands";
import type { PageCommandMessage } from "../shared/engine-protocol";
import {
  DEFAULT_TRANSLATION_COLOR,
  normalizeTranslationColor,
  TRANSLATION_COLOR_STORAGE_KEY,
} from "../shared/preferences";
import { injectionErrorCode } from "./access";

const statusElement = requiredElement<HTMLParagraphElement>("status");
const statusDot = requiredElement<HTMLSpanElement>("status-dot");
const translationCard = requiredElement<HTMLElement>("translation-card");
const progressWrap = requiredElement<HTMLDivElement>("progress-wrap");
const progressElement = requiredElement<HTMLProgressElement>("progress");
const progressLabel = requiredElement<HTMLSpanElement>("progress-label");
const progressSummary = requiredElement<HTMLParagraphElement>("progress-summary");
const startButton = requiredElement<HTMLButtonElement>("start");
const startLabel = requiredElement<HTMLSpanElement>("start-label");
const pauseButton = requiredElement<HTMLButtonElement>("pause");
const cancelButton = requiredElement<HTMLButtonElement>("cancel");
const undoButton = requiredElement<HTMLButtonElement>("undo");
const totalMetric = requiredElement<HTMLElement>("metric-total");
const completedMetric = requiredElement<HTMLElement>("metric-completed");
const failedMetric = requiredElement<HTMLElement>("metric-failed");
const translationColorInput = requiredElement<HTMLInputElement>("translation-color");
const translationColorValue = requiredElement<HTMLOutputElement>("translation-color-value");
const resetTranslationColorButton = requiredElement<HTMLButtonElement>("reset-translation-color");
const configureShortcutsButton = requiredElement<HTMLButtonElement>("configure-shortcuts");
const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-mode]"));
const shortcutRows = Array.from(document.querySelectorAll<HTMLElement>("[data-command]"));

let activeTabId: number | undefined;
let activePort: chrome.runtime.Port | undefined;
let pageId: string | undefined;
let taskId: string | undefined;
let taskStatus: TaskStatus = "idle";
let displayMode: DisplayMode = "bilingual";
let progress: TaskProgress = emptyProgress();
let connectionInFlight: Promise<void> | undefined;
let reconnectRequested = false;
let reconnectTimer: number | undefined;
let translationColor: string | undefined;

startButton.addEventListener("click", () => void startOrResumeTranslation());
pauseButton.addEventListener("click", pauseTranslation);
cancelButton.addEventListener("click", cancelTranslation);
undoButton.addEventListener("click", undoTranslation);
translationColorInput.addEventListener("input", () => void saveTranslationColor());
resetTranslationColorButton.addEventListener("click", () => void resetTranslationColor());
configureShortcutsButton.addEventListener("click", () => void openShortcutSettings());

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode;
    if (mode === "original" || mode === "bilingual" || mode === "translation") {
      setDisplayMode(mode);
    }
  });
}

chrome.tabs.onActivated.addListener(scheduleConnection);
scheduleConnection();
void renderShortcutHints();
void loadTranslationColorPreference();

async function loadTranslationColorPreference(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(TRANSLATION_COLOR_STORAGE_KEY);
    translationColor = normalizeTranslationColor(stored[TRANSLATION_COLOR_STORAGE_KEY]);
  } catch {
    translationColor = undefined;
  }
  renderTranslationColor();
}

async function saveTranslationColor(): Promise<void> {
  const color = normalizeTranslationColor(translationColorInput.value);
  if (!color) return;
  translationColor = color;
  renderTranslationColor();
  try {
    await chrome.storage.local.set({ [TRANSLATION_COLOR_STORAGE_KEY]: color });
  } catch {
    setStatus("无法保存译文颜色，请重新加载扩展后重试。", "error");
  }
}

async function resetTranslationColor(): Promise<void> {
  translationColor = undefined;
  renderTranslationColor();
  try {
    await chrome.storage.local.remove(TRANSLATION_COLOR_STORAGE_KEY);
  } catch {
    setStatus("无法恢复默认颜色，请重新加载扩展后重试。", "error");
  }
}

function renderTranslationColor(): void {
  translationColorInput.value = translationColor ?? DEFAULT_TRANSLATION_COLOR;
  translationColorValue.textContent = translationColor?.toUpperCase() ?? "自动";
  resetTranslationColorButton.disabled = translationColor === undefined;
}

async function renderShortcutHints(): Promise<void> {
  try {
    const commands = await chrome.commands.getAll();
    const shortcuts = new Map(commands.map((command) => [command.name, command.shortcut]));
    for (const row of shortcutRows) renderShortcut(row, shortcuts.get(row.dataset.command));
  } catch {
    for (const row of shortcutRows) renderShortcut(row);
  }
}

function renderShortcut(row: HTMLElement, shortcut?: string): void {
  const key = row.querySelector<HTMLElement>("kbd");
  if (!key) return;
  const assignedShortcut = shortcut?.trim();
  key.textContent = assignedShortcut || "未分配";
  row.dataset.assigned = String(Boolean(assignedShortcut));
}

async function openShortcutSettings(): Promise<void> {
  const shortcutSettingsUrl = "chrome://extensions/shortcuts";
  try {
    const tab = await chrome.tabs.create({ url: shortcutSettingsUrl });
    if (tab.id !== undefined) await chrome.tabs.update(tab.id, { url: shortcutSettingsUrl });
  } catch {
    setStatus(`请在地址栏打开 ${shortcutSettingsUrl} 修改快捷键。`, "neutral");
  }
}

function scheduleConnection(): void {
  window.clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  if (connectionInFlight) {
    reconnectRequested = true;
    return;
  }
  connectionInFlight = connectToActiveTab().finally(() => {
    connectionInFlight = undefined;
    if (reconnectRequested) {
      reconnectRequested = false;
      scheduleConnection();
    }
  });
}

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
      setStatus("控制面板已断开，页面翻译不会因此暂停。", "neutral");
      renderControls();
      reconnectTimer = window.setTimeout(scheduleConnection, 350);
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
    // Expected before the content script has been injected.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content-script.js"],
    });
  } catch (error) {
    throw new BenyiError(injectionErrorCode(error));
  }
}

function handlePageMessage(message: unknown): void {
  if (!isPageToPanelMessage(message)) return;
  if (activeTabId !== undefined && message.tabId !== activeTabId) return;

  switch (message.type) {
    case "PAGE_STATE":
      pageId = message.pageId;
      taskId = message.taskId;
      taskStatus = message.status;
      displayMode = message.mode;
      progress = message.progress;
      updateModeButtons();
      renderStatusFromTask();
      renderProgress();
      renderControls();
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
      renderStatusFromTask();
      renderControls();
      break;
    case "TASK_ERROR":
      if (!matchesCurrentTask(message)) return;
      taskStatus = "failed";
      setStatus(errorCodeMessage(message.errorCode), "error");
      renderControls();
      break;
    case "PAGE_COLLECTION":
    case "PAGE_SEGMENTS":
      break;
  }
}

async function startOrResumeTranslation(): Promise<void> {
  taskStatus = "preparing";
  setStatus("正在准备 Chrome 本地语言能力…", "active");
  renderControls();
  try {
    await runPageCommand(PANEL_COMMANDS.translatePage);
  } catch {
    taskStatus = "failed";
    setStatus("无法启动当前页面翻译，请刷新后重试。", "error");
    renderControls();
  }
}

function pauseTranslation(): void {
  if (taskStatus !== "translating") return;
  taskStatus = "paused";
  void runPageCommand(PANEL_COMMANDS.togglePause).catch(() => undefined);
  setStatus("翻译已暂停，已完成的译文会保留。", "neutral");
  renderControls();
}

function cancelTranslation(): void {
  taskStatus = "cancelled";
  void runPageCommand(PANEL_COMMANDS.cancelTranslation).catch(() => undefined);
  setStatus("翻译已取消，已完成的译文仍保留在页面中。", "neutral");
  renderControls();
}

function undoTranslation(): void {
  void runPageCommand(PANEL_COMMANDS.undoTranslation).catch(() => undefined);
  taskId = undefined;
  taskStatus = "idle";
  progress = emptyProgress();
  setStatus("已恢复原始页面。", "neutral");
  renderProgress();
  renderControls();
}

async function runPageCommand(command: PanelCommand): Promise<void> {
  if (activeTabId === undefined) throw new Error("No active tab");
  const message: PageCommandMessage = {
    version: PROTOCOL_VERSION,
    type: "PAGE_COMMAND",
    tabId: activeTabId,
    command,
  };
  const response = (await chrome.runtime.sendMessage(message)) as
    { accepted?: boolean } | undefined;
  if (!response?.accepted) throw new Error("Page command was rejected");
}

function setDisplayMode(mode: DisplayMode): void {
  displayMode = mode;
  updateModeButtons();
  const identity = currentIdentity();
  if (identity) postToPage({ version: PROTOCOL_VERSION, type: "PAGE_MODE_SET", ...identity, mode });
}

function postToPage(message: PanelToPageMessage): void {
  try {
    activePort?.postMessage(message);
  } catch {
    setStatus("无法连接当前页面。", "error");
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
  if (activePort) {
    activePort.disconnect();
    activePort = undefined;
  }
  activeTabId = undefined;
  pageId = undefined;
  taskId = undefined;
  taskStatus = "idle";
  progress = emptyProgress();
  renderProgress();
}

function renderProgress(): void {
  const handled = progress.completed + progress.failed + progress.skipped;
  progressWrap.hidden = progress.total === 0;
  progressElement.max = Math.max(progress.total, 1);
  progressElement.value = Math.min(handled, progress.total);
  progressLabel.textContent = `${handled} / ${progress.total}`;
  progressSummary.textContent =
    progress.total > 0 ? `已处理 ${handled} 个段落，共 ${progress.total} 个` : "正在准备页面正文…";
  totalMetric.textContent = String(progress.total);
  completedMetric.textContent = String(progress.completed);
  failedMetric.textContent = String(progress.failed);
}

function renderControls(): void {
  const connected = activePort !== undefined && pageId !== undefined;
  const busy =
    taskStatus === "collecting" || taskStatus === "preparing" || taskStatus === "translating";
  translationCard.dataset.taskStatus = taskStatus;
  translationCard.setAttribute("aria-busy", String(busy));
  startButton.disabled = !connected || busy;
  startLabel.textContent =
    taskStatus === "paused"
      ? "继续翻译"
      : taskStatus === "completed" || taskStatus === "cancelled" || taskStatus === "failed"
        ? "重新翻译"
        : "开始翻译";
  startButton.hidden = taskStatus === "translating" || taskStatus === "preparing";
  pauseButton.hidden = taskStatus !== "translating";
  cancelButton.hidden = !busy && taskStatus !== "paused";
  undoButton.disabled = progress.completed === 0 || taskId === undefined;
  renderProgress();
}

function renderStatusFromTask(): void {
  switch (taskStatus) {
    case "idle":
      setStatus("正文仅由 Chrome 本地处理；关闭面板后翻译仍会继续。", "neutral");
      break;
    case "collecting":
      setStatus("正在发现当前页面中的可阅读正文…", "active");
      break;
    case "preparing":
      setStatus("正在准备 Chrome 本地语言能力…", "active");
      break;
    case "translating":
      setStatus("正在后台翻译当前页面，可以关闭控制面板。", "active");
      break;
    case "paused":
      setStatus("翻译已暂停，已完成的译文会保留。", "neutral");
      break;
    case "cancelled":
      setStatus("翻译已取消，已完成的译文仍保留。", "neutral");
      break;
    case "completed":
      setStatus("当前页面翻译完成。", "success");
      break;
    case "failed":
      setStatus("翻译没有完成，请重试。", "error");
      break;
  }
}

function setStatus(message: string, state: "neutral" | "active" | "success" | "error"): void {
  statusElement.textContent = message;
  translationCard.dataset.tone = state;
  if (state === "neutral") delete statusDot.dataset.state;
  else statusDot.dataset.state = state;
}

function updateModeButtons(): void {
  for (const button of modeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === displayMode));
  }
}

function emptyProgress(): TaskProgress {
  return { total: 0, completed: 0, failed: 0, skipped: 0 };
}

function errorMessage(error: unknown): string {
  return errorCodeMessage(error instanceof BenyiError ? error.code : "UNKNOWN_ERROR");
}

function errorCodeMessage(code: string): string {
  switch (code) {
    case "NO_ACTIVE_TAB":
      return "没有找到当前标签页。";
    case "PAGE_UNSUPPORTED":
      return "当前页面受浏览器保护，无法注入翻译功能。请在普通网页中使用本译。";
    case "SITE_ACCESS_REQUIRED":
      return "请点击 Chrome 工具栏中的本译图标，授权当前网页后重试。";
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
    case "USER_ACTIVATION_REQUIRED":
      return "首次下载本地语言资源需要再次点击工具栏中的本译图标。";
    default:
      return "翻译过程中发生错误，请重试。";
  }
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
