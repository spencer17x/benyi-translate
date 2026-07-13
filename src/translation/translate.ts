import { splitText } from "../shared/text";

export const DEFAULT_TRANSLATION_CHUNK_LENGTH = 1_200;

export type TranslationAdapter = {
  translate(input: string, options?: { signal?: AbortSignal }): Promise<string>;
};

export async function translateText(
  translator: TranslationAdapter,
  sourceText: string,
  signal: AbortSignal,
  maxLength = DEFAULT_TRANSLATION_CHUNK_LENGTH,
): Promise<string> {
  const chunks = splitText(sourceText, maxLength);
  const translated: string[] = [];
  for (const chunk of chunks) translated.push(await translateChunk(translator, chunk, signal));
  return translated.join("");
}

async function translateChunk(
  translator: TranslationAdapter,
  sourceText: string,
  signal: AbortSignal,
  depth = 0,
): Promise<string> {
  try {
    return await translator.translate(sourceText, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof DOMException && error.name === "QuotaExceededError" && depth < 5) {
      const nextLength = Math.max(20, Math.floor(sourceText.length / 2));
      const parts = splitText(sourceText, nextLength);
      if (parts.length <= 1) throw error;
      const translated: string[] = [];
      for (const part of parts) {
        translated.push(await translateChunk(translator, part, signal, depth + 1));
      }
      return translated.join("");
    }
    throw error;
  }
}
