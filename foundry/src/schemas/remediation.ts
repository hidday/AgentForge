import { z } from "zod";
import { ExecutionReportSchema } from "./executionReport.js";

export const ResolutionStatus = z.enum(["accepted", "rejected", "partially_addressed"]);
export type ResolutionStatus = z.infer<typeof ResolutionStatus>;

export const ResolutionItemSchema = z.object({
  findingId: z.string(),
  status: ResolutionStatus,
  action: z.string(),
  rationale: z.string(),
});

export const RemediationSchema = z.object({
  reviewId: z.string(),
  resolution: z.array(ResolutionItemSchema),
  readyForHumanReview: z.boolean(),
  executionReport: ExecutionReportSchema,
});

export type Remediation = z.infer<typeof RemediationSchema>;
export type ResolutionItem = z.infer<typeof ResolutionItemSchema>;
