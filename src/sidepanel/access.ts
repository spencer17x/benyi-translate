export type InjectionErrorCode = "SITE_ACCESS_REQUIRED" | "PAGE_UNSUPPORTED";

export function injectionErrorCode(error: unknown): InjectionErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  return /manifest must request permission|missing host permission/i.test(message)
    ? "SITE_ACCESS_REQUIRED"
    : "PAGE_UNSUPPORTED";
}
