import { MAX_BATCH_CHARACTERS, MAX_BATCH_SEGMENTS, type SegmentInput } from "./protocol";

const URL_ONLY = /^(?:https?:\/\/|www\.)\S+$/i;
const NO_LETTERS_OR_NUMBERS = /^[\s\p{P}\p{S}]+$/u;

export function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function shouldSkipText(value: string): boolean {
  const normalized = normalizeText(value);
  return (
    normalized.length < 2 ||
    URL_ONLY.test(normalized) ||
    NO_LETTERS_OR_NUMBERS.test(normalized)
  );
}

export function isProbablyChinese(value: string): boolean {
  const letters = normalizeText(value).match(/\p{L}/gu) ?? [];
  if (letters.length < 2) return false;
  const hanCharacters = value.match(/\p{Script=Han}/gu) ?? [];
  return hanCharacters.length / letters.length >= 0.6;
}

export function hashText(value: string): string {
  let hash = 0x811c9dc5;
  const normalized = normalizeText(value);

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function splitText(value: string, maxLength = 1_200): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  if (normalized.length <= maxLength) return [normalized];
  if (maxLength < 20) throw new RangeError("maxLength must be at least 20");

  const chunks: string[] = [];
  let remainder = normalized;

  while (remainder.length > maxLength) {
    const window = remainder.slice(0, maxLength + 1);
    const minimumCut = Math.floor(maxLength * 0.5);
    const cut = findCutIndex(window, minimumCut, maxLength);
    const chunk = remainder.slice(0, cut).trim();

    if (chunk) chunks.push(chunk);
    remainder = remainder.slice(cut).trimStart();
  }

  if (remainder) chunks.push(remainder);
  return chunks;
}

export function batchSegments(segments: SegmentInput[]): SegmentInput[][] {
  const batches: SegmentInput[][] = [];
  let current: SegmentInput[] = [];
  let characterCount = 0;

  for (const segment of segments) {
    const exceedsLimit =
      current.length >= MAX_BATCH_SEGMENTS ||
      characterCount + segment.sourceText.length > MAX_BATCH_CHARACTERS;

    if (current.length > 0 && exceedsLimit) {
      batches.push(current);
      current = [];
      characterCount = 0;
    }

    current.push(segment);
    characterCount += segment.sourceText.length;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

function findCutIndex(value: string, minimum: number, maximum: number): number {
  const sentenceBoundary = /[.!?。！？]\s+/gu;
  const clauseBoundary = /[,;，；:]\s+/gu;
  let best = -1;

  for (const pattern of [sentenceBoundary, clauseBoundary]) {
    for (const match of value.matchAll(pattern)) {
      const end = (match.index ?? 0) + match[0].length;
      if (end >= minimum && end <= maximum) best = Math.max(best, end);
    }
    if (best >= minimum) return best;
  }

  const whitespace = value.lastIndexOf(" ", maximum);
  if (whitespace >= minimum) return whitespace + 1;
  return maximum;
}
