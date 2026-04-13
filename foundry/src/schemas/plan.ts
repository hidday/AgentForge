import { z } from "zod";

// The model sometimes outputs openQuestions as plain strings instead of
// objects. Normalize both forms to the expected shape.
export const OpenQuestionSchema = z
  .union([
    z.object({
      id: z.string(),
      question: z.string(),
      requiredForExecution: z.boolean().catch(false),
    }),
    z.string().transform((s, ctx) => ({
      id: `q${ctx.path.join("-") || "1"}`,
      question: s,
      requiredForExecution: false as boolean,
    })),
  ])
  .transform((v) => v as { id: string; question: string; requiredForExecution: boolean });

export const PlanStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
});

// A flexible string field: coerce objects to their string representation,
// fall back to an empty string if nothing useful can be extracted.
const FlexString = z.union([
  z.string(),
  z.object({ description: z.string() }).transform((v) => v.description),
  z.object({ text: z.string() }).transform((v) => v.text),
  z.object({ risk: z.string() }).transform((v) => v.risk),
  z.object({ assumption: z.string() }).transform((v) => v.assumption),
  z.unknown().transform((v) => (typeof v === "string" ? v : "")),
]);

export const PlanSchema = z.object({
  planVersion: z.number().int().positive(),
  summary: z.string(),
  requirementsTraceability: z.string().optional().default(""),
  assumptions: z.array(FlexString),
  openQuestions: z.array(OpenQuestionSchema),
  risks: z.array(FlexString),
  steps: z.array(PlanStepSchema),
  testPlan: z.string(),
  confidence: z.number().min(0).max(1),
});

export type Plan = z.infer<typeof PlanSchema>;
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;
