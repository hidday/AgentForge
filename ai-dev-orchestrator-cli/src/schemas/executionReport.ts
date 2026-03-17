import { z } from "zod";

export const CheckResultSchema = z.object({
  status: z.enum(["pass", "fail", "skip"]),
  details: z.string(),
});

export const ChecksSchema = z.object({
  lint: CheckResultSchema,
  typecheck: CheckResultSchema,
  tests: CheckResultSchema,
});

export const ExecutionReportSchema = z.object({
  summary: z.string(),
  filesChanged: z.array(z.string()),
  checks: ChecksSchema,
  notes: z.array(z.string()),
  prDraftCreated: z.boolean(),
});

export type ExecutionReport = z.infer<typeof ExecutionReportSchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
export type Checks = z.infer<typeof ChecksSchema>;
