import { z } from "zod";
import { PlanSchema } from "./plan.js";
import { PlanReviewSchema } from "./planReview.js";
import { PlanRevisionSchema } from "./planRevision.js";
import { ExecutionReportSchema } from "./executionReport.js";
import { ReviewSchema } from "./review.js";
import { RemediationSchema } from "./remediation.js";
import { ResearchedAnswersSchema } from "./researchedAnswers.js";

export const Stage = z.enum([
  "planner",
  "plan-reviewer",
  "plan-reviser",
  "answer-researcher",
  "executor",
  "reviewer",
  "remediation",
  "distillation",
]);
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

export const PlanReviewerOutputSchema = CliOutputBaseSchema.extend({
  stage: z.literal("plan-reviewer"),
  payload: PlanReviewSchema,
});

export const PlanReviserOutputSchema = CliOutputBaseSchema.extend({
  stage: z.literal("plan-reviser"),
  payload: z.object({
    revision: PlanRevisionSchema,
    revisedPlan: PlanSchema,
  }),
});

export const AnswerResearcherOutputSchema = CliOutputBaseSchema.extend({
  stage: z.literal("answer-researcher"),
  payload: ResearchedAnswersSchema,
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

export const DistillationDecisionSchema = z.object({
  shouldPersist: z.boolean(),
  reason: z.string(),
  skillMarkdown: z.string().optional(),
  taskCategory: z.string().optional(),
});

export const DistillationOutputSchema = CliOutputBaseSchema.extend({
  stage: z.literal("distillation"),
  payload: DistillationDecisionSchema,
});

export const CliOutputSchema = z.discriminatedUnion("stage", [
  PlannerOutputSchema,
  PlanReviewerOutputSchema,
  PlanReviserOutputSchema,
  AnswerResearcherOutputSchema,
  ExecutorOutputSchema,
  ReviewerOutputSchema,
  RemediationOutputSchema,
  DistillationOutputSchema,
]);

export type CliOutput = z.infer<typeof CliOutputSchema>;
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;
export type PlanReviewerOutput = z.infer<typeof PlanReviewerOutputSchema>;
export type PlanReviserOutput = z.infer<typeof PlanReviserOutputSchema>;
export type AnswerResearcherOutput = z.infer<typeof AnswerResearcherOutputSchema>;
export type ExecutorOutput = z.infer<typeof ExecutorOutputSchema>;
export type ReviewerOutput = z.infer<typeof ReviewerOutputSchema>;
export type RemediationOutput = z.infer<typeof RemediationOutputSchema>;
export type DistillationOutput = z.infer<typeof DistillationOutputSchema>;

export const STRUCTURED_OUTPUT_BEGIN = "BEGIN_STRUCTURED_OUTPUT";
export const STRUCTURED_OUTPUT_END = "END_STRUCTURED_OUTPUT";
