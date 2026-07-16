export const TRANSLATION_COLOR_STORAGE_KEY = "translationColor";
export const DEFAULT_TRANSLATION_COLOR = "#24683a";
export const DEFAULT_DARK_TRANSLATION_COLOR = "#72c68b";

export function normalizeTranslationColor(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return undefined;
  return value.toLowerCase();
}
