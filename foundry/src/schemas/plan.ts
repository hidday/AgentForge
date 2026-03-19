import { z } from "zod";

export const OpenQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  requiredForExecution: z.boolean(),
});

export const PlanStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
});

export const PlanSchema = z.object({
  planVersion: z.number().int().positive(),
  summary: z.string(),
  assumptions: z.array(z.string()),
  openQuestions: z.array(OpenQuestionSchema),
  risks: z.array(z.string()),
  steps: z.array(PlanStepSchema),
  testPlan: z.string(),
  confidence: z.number().min(0).max(1),
});

export type Plan = z.infer<typeof PlanSchema>;
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;
