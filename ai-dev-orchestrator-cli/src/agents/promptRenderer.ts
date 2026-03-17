import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, "../prompts");

export function loadPromptTemplate(filename: string): string {
  return readFileSync(resolve(PROMPTS_DIR, filename), "utf-8");
}

export function renderTemplate(
  template: string,
  vars: Record<string, unknown>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
    const keys = path.trim().split(".");
    let value: unknown = vars;
    for (const key of keys) {
      if (value == null || typeof value !== "object") {
        return `{{${path.trim()}}}`;
      }
      value = (value as Record<string, unknown>)[key];
    }
    if (Array.isArray(value)) {
      return value
        .map((item, i) => {
          if (typeof item === "object" && item !== null) {
            return Object.entries(item)
              .map(([k, v]) => `  - ${k}: ${v}`)
              .join("\n");
          }
          return `${i + 1}. ${String(item)}`;
        })
        .join("\n");
    }
    return String(value ?? "");
  });
}
