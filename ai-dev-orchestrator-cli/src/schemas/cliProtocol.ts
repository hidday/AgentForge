import { z } from "zod";
import { PlanSchema } from "./plan.js";
import { ExecutionReportSchema } from "./executionReport.js";
import { ReviewSchema } from "./review.js";
import { RemediationSchema } from "./remediation.js";

export const Stage = z.enum(["planner", "executor", "reviewer", "remediation"]);
export type Stage = z.infer<typeof Stage>;

export const CliOutputBaseSchema = z.object({
  success: z.boolean(),
  stage: Stage,
  notes: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
});

export const PlannerOutputSchema = CliOutputBaseSchema.extend({
  stage: z.literal("planner"),
  payload: PlanSchema,
});

export const ExecutorOutputSchema = CliOutputBaseSchema.extend({
  stage: z.literal("executor"),
  payload: ExecutionReportSchema,
});

export const ReviewerOutputSchema = CliOutputBaseSchema.extend({
  stage: z.literal("reviewer"),
  payload: ReviewSchema,
});

export const RemediationOutputSchema = CliOutputBaseSchema.extend({
  stage: z.literal("remediation"),
  payload: RemediationSchema,
});

export const CliOutputSchema = z.discriminatedUnion("stage", [
  PlannerOutputSchema,
  ExecutorOutputSchema,
  ReviewerOutputSchema,
  RemediationOutputSchema,
]);

export type CliOutput = z.infer<typeof CliOutputSchema>;
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;
export type ExecutorOutput = z.infer<typeof ExecutorOutputSchema>;
export type ReviewerOutput = z.infer<typeof ReviewerOutputSchema>;
export type RemediationOutput = z.infer<typeof RemediationOutputSchema>;

export const STRUCTURED_OUTPUT_BEGIN = "BEGIN_STRUCTURED_OUTPUT";
export const STRUCTURED_OUTPUT_END = "END_STRUCTURED_OUTPUT";
