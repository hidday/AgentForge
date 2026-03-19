import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, "../prompts");

export function loadPromptTemplate(filename: string): string {
  return readFileSync(resolve(PROMPTS_DIR, filename), "utf-8");
}

function toDisplayString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function renderTemplate(template: string, vars: Record<string, unknown>): string {
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
        .map((item: unknown, i) => {
          if (typeof item === "object" && item !== null) {
            return Object.entries(item as Record<string, unknown>)
              .map(([k, v]) => `  - ${k}: ${toDisplayString(v)}`)
              .join("\n");
          }
          return `${String(i + 1)}. ${toDisplayString(item)}`;
        })
        .join("\n");
    }
    return toDisplayString(value);
  });
}
