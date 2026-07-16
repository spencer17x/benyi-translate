import {
  isEnginePageMessage,
  type EngineResultMessage,
} from "../shared/engine-protocol";
import { createId } from "../shared/id";
import {
  PROTOCOL_VERSION,
  type PageToPanelMessage,
  type PanelToPageMessage,
  type SegmentInput,
  type SegmentResult,
  type TaskIdentity,
  type TaskStatus,
} from "../shared/protocol";
import { translateText } from "../translation/translate";

const SOURCE_LANGUAGE = "en";
const TARGET_LANGUAGE = "zh";
const DETECTION_CONFIDENCE = 0.6;

const sessions = new Map<string, TranslationSession>();

chrome.runtime.onMessage.addListener((value: unknown, sender) => {
  if (!isEnginePageMessage(value)) return false;
  if (sender.tab?.id !== value.message.tabId) return false;
  handlePageMessage(value.message);
  return false;
});

function handlePageMessage(message: PageToPanelMessage): void {
  if (message.type === "PAGE_STATE" && message.taskId === undefined) {
    removeTabSessions(message.tabId);
    return;
  }

  const identity = taskIdentity(message);
  if (!identity) return;
  const key = identityKey(identity);
  let session = sessions.get(key);
  if (!session) {
    session = new TranslationSession(identity, () => sessions.delete(key));
    sessions.set(key, session);
  }
  session.handle(message);
}

function removeTabSessions(tabId: number): void {
  for (const [key, session] of sessions) {
    if (session.tabId !== tabId) continue;
    session.destroy();
    sessions.delete(key);
  }
}

class TranslationSession {
  readonly tabId: number;
  private status: TaskStatus = "collecting";
  private queue: SegmentInput[] = [];
  private queuedSegments = new Set<string>();
  private collectionDone = false;
  private collectionSample: string | undefined;
  private declaredLanguage: string | undefined;
  private total = 0;
  private sourceApproved = false;
  private processing = false;
  private translator: Translator | undefined;
  private detector: LanguageDetector | undefined;
  private preparationController: AbortController | undefined;
  private translationController: AbortController | undefined;
  private preparationPromise: Promise<void> | undefined;
  private destroyed = false;

  constructor(
    private readonly identity: TaskIdentity,
    private readonly onFinish: () => void,
  ) {
    this.tabId = identity.tabId;
  }

  handle(message: PageToPanelMessage): void {
    if (!matchesIdentity(message, this.identity) || this.destroyed) return;

    switch (message.type) {
      case "PAGE_STATE":
        this.handleStatus(message.status);
        break;
      case "PAGE_COLLECTION":
        this.collectionSample = message.sourceSample;
        this.declaredLanguage = message.declaredLanguage;
        this.total = message.total;
        void this.prepareAndProcess().catch((error: unknown) => void this.fail(error));
        break;
      case "PAGE_SEGMENTS":
        this.enqueue(message.segments);
        this.collectionDone ||= message.done;
        void this.processQueue().catch((error: unknown) => void this.fail(error));
        break;
      case "TASK_STATUS":
        this.handleStatus(message.status);
        break;
      case "TASK_ERROR":
        this.finish();
        break;
      case "TASK_PROGRESS":
        break;
    }
  }

  private handleStatus(status: TaskStatus): void {
    this.status = status;
    if (status === "paused") {
      this.translationController?.abort();
      this.queue = [];
      this.queuedSegments.clear();
      return;
    }
    if (status === "cancelled" || status === "completed" || status === "failed" || status === "idle") {
      this.finish();
      return;
    }
    if (status === "collecting" || status === "preparing" || status === "translating") {
      void this.prepareAndProcess().catch((error: unknown) => void this.fail(error));
    }
  }

  private async prepareAndProcess(): Promise<void> {
    if (this.destroyed || this.status === "paused" || this.collectionSample === undefined) return;
    if (!this.preparationPromise) {
      this.preparationPromise = this.prepareModelsAndApprove().finally(() => {
        this.preparationPromise = undefined;
      });
    }
    await this.preparationPromise;
    await this.processQueue();
  }

  private async prepareModelsAndApprove(): Promise<void> {
    if (this.sourceApproved && this.translator) return;
    if (this.total === 0 || !this.collectionSample?.trim()) {
      await this.complete();
      return;
    }
    if (!("Translator" in self)) throw new EngineError("API_UNSUPPORTED");

    this.preparationController?.abort();
    const controller = new AbortController();
    this.preparationController = controller;
    const availability = await Translator.availability({
      sourceLanguage: SOURCE_LANGUAGE,
      targetLanguage: TARGET_LANGUAGE,
    });
    if (availability === "unavailable") throw new EngineError("PAIR_UNAVAILABLE");

    const [translator, detector] = await Promise.all([
      Translator.create({
        sourceLanguage: SOURCE_LANGUAGE,
        targetLanguage: TARGET_LANGUAGE,
        signal: controller.signal,
      }),
      prepareDetector(controller.signal),
    ]);
    if (this.destroyed || controller.signal.aborted) {
      translator.destroy();
      detector?.destroy();
      return;
    }
    this.translator = translator;
    this.detector = detector;
    this.preparationController = undefined;
    await this.approveSourceLanguage();
  }

  private async approveSourceLanguage(): Promise<void> {
    let sourceLanguage = languageBase(this.declaredLanguage);
    if (this.detector && this.collectionSample) {
      try {
        const [result] = await this.detector.detect(this.collectionSample);
        const detected = languageBase(result?.detectedLanguage);
        if (detected && (result?.confidence ?? 0) >= DETECTION_CONFIDENCE) sourceLanguage = detected;
      } catch {
        // The declared language or English fallback remains available.
      } finally {
        this.detector.destroy();
        this.detector = undefined;
      }
    }

    if (sourceLanguage === "zh") {
      await this.complete();
      return;
    }
    if (sourceLanguage && sourceLanguage !== "en") {
      throw new EngineError("SOURCE_LANGUAGE_UNSUPPORTED");
    }
    this.sourceApproved = true;
  }

  private enqueue(segments: SegmentInput[]): void {
    for (const segment of segments) {
      const key = segmentKey(segment);
      if (this.queuedSegments.has(key)) continue;
      this.queuedSegments.add(key);
      this.queue.push(segment);
    }
    this.queue.sort((left, right) => left.priority - right.priority);
  }

  private async processQueue(): Promise<void> {
    if (
      this.processing ||
      !this.translator ||
      !this.sourceApproved ||
      this.isPaused() ||
      this.destroyed
    ) {
      return;
    }
    this.processing = true;

    try {
      while (this.queue.length > 0 && !this.isPaused() && !this.destroyed) {
        const segment = this.queue.shift();
        if (!segment) break;
        this.queuedSegments.delete(segmentKey(segment));
        const controller = new AbortController();
        this.translationController = controller;

        try {
          const translatedText = await translateText(this.translator, segment.sourceText, controller.signal);
          await this.postResult({
            segmentId: segment.segmentId,
            contentHash: segment.contentHash,
            status: "translated",
            translatedText,
          });
        } catch (error) {
          if (isAbortError(error)) break;
          await this.postResult({
            segmentId: segment.segmentId,
            contentHash: segment.contentHash,
            status: "failed",
            errorCode: errorCode(error),
          });
        } finally {
          if (this.translationController === controller) this.translationController = undefined;
        }
      }

      if (this.collectionDone && this.queue.length === 0 && !this.destroyed && !this.isPaused()) {
        await this.complete();
      }
    } finally {
      this.processing = false;
    }
  }

  private async postResult(result: SegmentResult): Promise<void> {
    await this.post({
      version: PROTOCOL_VERSION,
      type: "TRANSLATION_RESULT",
      ...this.identity,
      batchId: createId(),
      results: [result],
    });
  }

  private isPaused(): boolean {
    return this.status === "paused";
  }

  private async complete(): Promise<void> {
    if (this.destroyed) return;
    await this.post({ version: PROTOCOL_VERSION, type: "TASK_COMPLETE", ...this.identity });
    this.finish();
  }

  private async fail(error: unknown): Promise<void> {
    if (this.destroyed || isAbortError(error)) return;
    await this.post({
      version: PROTOCOL_VERSION,
      type: "TASK_FAIL",
      ...this.identity,
      errorCode: errorCode(error),
    });
    this.finish();
  }

  private async post(message: PanelToPageMessage): Promise<void> {
    const envelope: EngineResultMessage = {
      version: PROTOCOL_VERSION,
      type: "ENGINE_RESULT_MESSAGE",
      tabId: this.identity.tabId,
      message,
    };
    await chrome.runtime.sendMessage(envelope).catch(() => undefined);
  }

  private finish(): void {
    if (this.destroyed) return;
    this.destroy();
    this.onFinish();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.preparationController?.abort();
    this.translationController?.abort();
    this.detector?.destroy();
    this.translator?.destroy();
    this.queue = [];
    this.queuedSegments.clear();
  }
}

async function prepareDetector(signal: AbortSignal): Promise<LanguageDetector | undefined> {
  if (!("LanguageDetector" in self)) return undefined;
  try {
    return await LanguageDetector.create({ signal });
  } catch {
    return undefined;
  }
}

function taskIdentity(message: PageToPanelMessage): TaskIdentity | undefined {
  if (message.type === "PAGE_STATE") {
    if (!message.taskId) return undefined;
    return { tabId: message.tabId, pageId: message.pageId, taskId: message.taskId };
  }
  return { tabId: message.tabId, pageId: message.pageId, taskId: message.taskId };
}

function matchesIdentity(message: PageToPanelMessage, identity: TaskIdentity): boolean {
  const candidate = taskIdentity(message);
  return (
    candidate !== undefined &&
    candidate.tabId === identity.tabId &&
    candidate.pageId === identity.pageId &&
    candidate.taskId === identity.taskId
  );
}

function identityKey(identity: TaskIdentity): string {
  return `${identity.tabId}:${identity.pageId}:${identity.taskId}`;
}

function segmentKey(segment: SegmentInput): string {
  return `${segment.segmentId}:${segment.contentHash}`;
}

function languageBase(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase().split("-")[0] || undefined;
}

function errorCode(error: unknown): string {
  if (error instanceof EngineError) return error.code;
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

class EngineError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "EngineError";
  }
}
