import type { TaskStatus } from "../shared/protocol";

export function acceptsDynamicContent(status: TaskStatus): boolean {
  return status === "translating" || status === "completed";
}
