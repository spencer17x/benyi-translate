export const PROTOCOL_VERSION = 1 as const;
export const TASK_PORT_NAME = "benyi-task-v1";
export const MAX_BATCH_SEGMENTS = 50;
export const MAX_BATCH_CHARACTERS = 32_000;

export type DisplayMode = "original" | "bilingual" | "translation";

export type TaskStatus =
  | "idle"
  | "collecting"
  | "preparing"
  | "translating"
  | "paused"
  | "cancelled"
  | "completed"
  | "failed";

export type TaskIdentity = {
  tabId: number;
  pageId: string;
  taskId: string;
};

export type SegmentInput = {
  segmentId: string;
  sourceText: string;
  contentHash: string;
  sourceLanguage: string;
  targetLanguage: string;
  priority: number;
};

export type SegmentResult = {
  segmentId: string;
  contentHash: string;
  status: "translated" | "failed" | "cancelled";
  translatedText?: string;
  errorCode?: string;
};

export type TaskProgress = {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
};

export type PanelToPageMessage =
  | { version: 1; type: "PANEL_HELLO"; tabId: number }
  | ({
      version: 1;
      type: "PAGE_COLLECT";
      sourceLanguage: string;
      targetLanguage: string;
      mode: DisplayMode;
    } & TaskIdentity)
  | ({ version: 1; type: "TRANSLATION_RESUME" } & TaskIdentity)
  | ({ version: 1; type: "TRANSLATION_PAUSE" } & TaskIdentity)
  | ({ version: 1; type: "TRANSLATION_CANCEL" } & TaskIdentity)
  | ({
      version: 1;
      type: "TRANSLATION_RESULT";
      batchId: string;
      results: SegmentResult[];
    } & TaskIdentity)
  | ({ version: 1; type: "TASK_COMPLETE" } & TaskIdentity)
  | ({ version: 1; type: "TASK_FAIL"; errorCode: string } & TaskIdentity)
  | ({ version: 1; type: "PAGE_MODE_SET"; mode: DisplayMode } & TaskIdentity)
  | ({ version: 1; type: "PAGE_UNDO" } & TaskIdentity);

export type PageToPanelMessage =
  | {
      version: 1;
      type: "PAGE_STATE";
      tabId: number;
      pageId: string;
      taskId?: string;
      status: TaskStatus;
      mode: DisplayMode;
      progress: TaskProgress;
    }
  | ({
      version: 1;
      type: "PAGE_COLLECTION";
      declaredLanguage?: string;
      sourceSample: string;
      total: number;
    } & TaskIdentity)
  | ({
      version: 1;
      type: "PAGE_SEGMENTS";
      batchId: string;
      segments: SegmentInput[];
      done: boolean;
    } & TaskIdentity)
  | ({ version: 1; type: "TASK_PROGRESS"; progress: TaskProgress } & TaskIdentity)
  | ({ version: 1; type: "TASK_STATUS"; status: TaskStatus } & TaskIdentity)
  | ({ version: 1; type: "TASK_ERROR"; errorCode: string } & TaskIdentity);

export type PingMessage = { version: 1; type: "BENYI_PING" };
export type PingResponse = { version: 1; type: "BENYI_PONG"; pageId: string };

export function isPanelToPageMessage(value: unknown): value is PanelToPageMessage {
  if (!isProtocolRecord(value)) return false;

  if (value.type === "PANEL_HELLO") return isSafeTabId(value.tabId);
  if (!hasTaskIdentity(value)) return false;

  switch (value.type) {
    case "PAGE_COLLECT":
      return (
        typeof value.sourceLanguage === "string" &&
        typeof value.targetLanguage === "string" &&
        isDisplayMode(value.mode)
      );
    case "TRANSLATION_RESULT":
      return (
        typeof value.batchId === "string" &&
        Array.isArray(value.results) &&
        value.results.length <= MAX_BATCH_SEGMENTS &&
        value.results.every(isSegmentResult)
      );
    case "PAGE_MODE_SET":
      return isDisplayMode(value.mode);
    case "TASK_FAIL":
      return typeof value.errorCode === "string";
    case "TRANSLATION_RESUME":
    case "TRANSLATION_PAUSE":
    case "TRANSLATION_CANCEL":
    case "TASK_COMPLETE":
    case "PAGE_UNDO":
      return true;
    default:
      return false;
  }
}

export function isPageToPanelMessage(value: unknown): value is PageToPanelMessage {
  if (!isProtocolRecord(value)) return false;

  if (value.type === "PAGE_STATE") {
    return (
      isSafeTabId(value.tabId) &&
      typeof value.pageId === "string" &&
      (value.taskId === undefined || typeof value.taskId === "string") &&
      isTaskStatus(value.status) &&
      isDisplayMode(value.mode) &&
      isTaskProgress(value.progress)
    );
  }

  if (!hasTaskIdentity(value)) return false;

  switch (value.type) {
    case "PAGE_COLLECTION":
      return (
        (value.declaredLanguage === undefined || typeof value.declaredLanguage === "string") &&
        typeof value.sourceSample === "string" &&
        value.sourceSample.length <= MAX_BATCH_CHARACTERS &&
        typeof value.total === "number" &&
        Number.isSafeInteger(value.total) &&
        value.total >= 0
      );
    case "PAGE_SEGMENTS":
      return (
        typeof value.batchId === "string" &&
        typeof value.done === "boolean" &&
        Array.isArray(value.segments) &&
        value.segments.length <= MAX_BATCH_SEGMENTS &&
        value.segments.every(isSegmentInput) &&
        value.segments.reduce((sum, segment) => sum + segment.sourceText.length, 0) <=
          MAX_BATCH_CHARACTERS
      );
    case "TASK_PROGRESS":
      return isTaskProgress(value.progress);
    case "TASK_STATUS":
      return isTaskStatus(value.status);
    case "TASK_ERROR":
      return typeof value.errorCode === "string";
    default:
      return false;
  }
}

export function isPingMessage(value: unknown): value is PingMessage {
  return isProtocolRecord(value) && value.type === "BENYI_PING";
}

export function isDisplayMode(value: unknown): value is DisplayMode {
  return value === "original" || value === "bilingual" || value === "translation";
}

function isProtocolRecord(value: unknown): value is Record<string, unknown> & { version: 1; type: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).version === PROTOCOL_VERSION &&
    typeof (value as Record<string, unknown>).type === "string"
  );
}

function hasTaskIdentity(value: Record<string, unknown>): value is Record<string, unknown> & TaskIdentity {
  return (
    isSafeTabId(value.tabId) &&
    typeof value.pageId === "string" &&
    value.pageId.length > 0 &&
    value.pageId.length <= 100 &&
    typeof value.taskId === "string" &&
    value.taskId.length > 0 &&
    value.taskId.length <= 100
  );
}

function isSafeTabId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    value === "idle" ||
    value === "collecting" ||
    value === "preparing" ||
    value === "translating" ||
    value === "paused" ||
    value === "cancelled" ||
    value === "completed" ||
    value === "failed"
  );
}

function isTaskProgress(value: unknown): value is TaskProgress {
  if (typeof value !== "object" || value === null) return false;
  const progress = value as Record<string, unknown>;
  const hasValidCounts = ["total", "completed", "failed", "skipped"].every(
    (key) => typeof progress[key] === "number" && Number.isSafeInteger(progress[key]) && progress[key] >= 0,
  );
  if (!hasValidCounts) return false;
  return (
    (progress.completed as number) + (progress.failed as number) + (progress.skipped as number) <=
    (progress.total as number)
  );
}

function isSegmentInput(value: unknown): value is SegmentInput {
  if (typeof value !== "object" || value === null) return false;
  const segment = value as Record<string, unknown>;
  return (
    typeof segment.segmentId === "string" &&
    segment.segmentId.length <= 100 &&
    typeof segment.sourceText === "string" &&
    segment.sourceText.length <= MAX_BATCH_CHARACTERS &&
    typeof segment.contentHash === "string" &&
    segment.contentHash.length <= 100 &&
    typeof segment.sourceLanguage === "string" &&
    segment.sourceLanguage.length <= 35 &&
    typeof segment.targetLanguage === "string" &&
    segment.targetLanguage.length <= 35 &&
    typeof segment.priority === "number" &&
    Number.isFinite(segment.priority)
  );
}

function isSegmentResult(value: unknown): value is SegmentResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.segmentId === "string" &&
    result.segmentId.length <= 100 &&
    typeof result.contentHash === "string" &&
    result.contentHash.length <= 100 &&
    (result.status === "translated" || result.status === "failed" || result.status === "cancelled") &&
    (result.translatedText === undefined ||
      (typeof result.translatedText === "string" && result.translatedText.length <= MAX_BATCH_CHARACTERS * 2)) &&
    (result.errorCode === undefined ||
      (typeof result.errorCode === "string" && result.errorCode.length <= 100))
  );
}
