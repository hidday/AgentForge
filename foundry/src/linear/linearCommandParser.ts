export type LinearCommand =
  | { type: "ai-plan" }
  | { type: "approve-plan" }
  | { type: "reject-plan" }
  | { type: "run-ai" }
  | { type: "re-review" }
  | { type: "pause-ai" }
  | { type: "resume-ai" }
  | { type: "unknown"; raw: string };

const COMMAND_MAP: Record<string, LinearCommand["type"]> = {
  "/ai-plan": "ai-plan",
  "/approve-plan": "approve-plan",
  "/reject-plan": "reject-plan",
  "/run-ai": "run-ai",
  "/re-review": "re-review",
  "/pause-ai": "pause-ai",
  "/resume-ai": "resume-ai",
};

export function parseLinearCommand(text: string): LinearCommand | null {
  const trimmed = text.trim();
  const firstLine = trimmed.split("\n")[0]?.trim() ?? "";

  for (const [prefix, type] of Object.entries(COMMAND_MAP)) {
    if (firstLine === prefix || firstLine.startsWith(`${prefix} `)) {
      return { type } as LinearCommand;
    }
  }

  if (firstLine.startsWith("/")) {
    return { type: "unknown", raw: firstLine };
  }

  return null;
}
