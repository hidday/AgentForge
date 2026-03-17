import { z } from "zod";

export const PlanReviewFindingSeverity = z.enum(["blocker", "important", "suggestion", "nit"]);
export type PlanReviewFindingSeverity = z.infer<typeof PlanReviewFindingSeverity>;

export const PlanReviewVerdict = z.enum(["approved", "changes_requested"]);
export type PlanReviewVerdict = z.infer<typeof PlanReviewVerdict>;

export const PlanReviewFindingSchema = z.object({
  id: z.string(),
  severity: PlanReviewFindingSeverity,
  type: z.string(),
  affectedStepId: z.string().optional(),
  title: z.string(),
  details: z.string(),
});

export const PlanReviewSchema = z.object({
  reviewId: z.string(),
  summary: z.string(),
  findings: z.array(PlanReviewFindingSchema),
  overallVerdict: PlanReviewVerdict,
});

export type PlanReview = z.infer<typeof PlanReviewSchema>;
export type PlanReviewFinding = z.infer<typeof PlanReviewFindingSchema>;
