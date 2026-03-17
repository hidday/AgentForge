import { z } from "zod";
import { ChecksSchema } from "./executionReport.js";

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
  rerunChecks: ChecksSchema,
  readyForHumanReview: z.boolean(),
});

export type Remediation = z.infer<typeof RemediationSchema>;
export type ResolutionItem = z.infer<typeof ResolutionItemSchema>;
