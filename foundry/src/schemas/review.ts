import { z } from "zod";

export const FindingSeverity = z.enum(["blocker", "important", "suggestion", "nit"]);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const OverallVerdict = z.enum(["approved", "changes_requested"]);
export type OverallVerdict = z.infer<typeof OverallVerdict>;

export const FindingSchema = z.object({
  id: z.string(),
  severity: FindingSeverity,
  type: z.string(),
  file: z.string(),
  lineHint: z.number().int().optional(),
  title: z.string(),
  details: z.string(),
});

export const ReviewSchema = z.object({
  reviewId: z.string(),
  summary: z.string(),
  findings: z.array(FindingSchema),
  overallVerdict: OverallVerdict,
});

export type Review = z.infer<typeof ReviewSchema>;
export type Finding = z.infer<typeof FindingSchema>;
