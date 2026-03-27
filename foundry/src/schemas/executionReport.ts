import { z } from "zod";

const KNOWN_STATUSES = ["pass", "fail", "skip"] as const;
type CheckStatus = (typeof KNOWN_STATUSES)[number];

export const CheckResultSchema = z.object({
  status: z
    .string()
    .transform((v): CheckStatus => (KNOWN_STATUSES.includes(v as CheckStatus) ? (v as CheckStatus) : "skip")),
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
