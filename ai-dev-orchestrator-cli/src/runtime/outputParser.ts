import type { ZodType } from "zod";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../schemas/cliProtocol.js";
import { OutputParseError } from "../utils/errors.js";

export class OutputParser {
  extractStructuredBlock(raw: string): string {
    const beginIdx = raw.lastIndexOf(STRUCTURED_OUTPUT_BEGIN);
    if (beginIdx === -1) {
      throw new OutputParseError(
        `Could not find "${STRUCTURED_OUTPUT_BEGIN}" delimiter in output`,
        raw.slice(-500),
      );
    }

    const afterBegin = beginIdx + STRUCTURED_OUTPUT_BEGIN.length;
    const endIdx = raw.indexOf(STRUCTURED_OUTPUT_END, afterBegin);
    if (endIdx === -1) {
      throw new OutputParseError(
        `Found "${STRUCTURED_OUTPUT_BEGIN}" but no matching "${STRUCTURED_OUTPUT_END}" delimiter`,
        raw.slice(beginIdx, beginIdx + 500),
      );
    }

    return raw.slice(afterBegin, endIdx).trim();
  }

  parseJson(block: string): unknown {
    try {
      return JSON.parse(block);
    } catch (err) {
      throw new OutputParseError(
        `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
        block.slice(0, 500),
      );
    }
  }

  validate<T>(data: unknown, schema: ZodType<T>): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new OutputParseError(
        `Structured output failed schema validation:\n${issues}`,
        JSON.stringify(data).slice(0, 500),
      );
    }
    return result.data;
  }

  parse<T>(raw: string, schema: ZodType<T>): T {
    const block = this.extractStructuredBlock(raw);
    const data = this.parseJson(block);
    return this.validate(data, schema);
  }
}
