import { z } from "zod";

export const DispositionStatus = z.enum(["accepted", "dismissed", "partially_incorporated"]);
export type DispositionStatus = z.infer<typeof DispositionStatus>;

export const DispositionItemSchema = z.object({
  findingId: z.string(),
  status: DispositionStatus,
  rationale: z.string(),
});

export const PlanRevisionSchema = z.object({
  originalPlanVersion: z.number().int().positive(),
  revisedPlanVersion: z.number().int().positive(),
  reviewId: z.string(),
  dispositions: z.array(DispositionItemSchema),
});

export type PlanRevision = z.infer<typeof PlanRevisionSchema>;
export type DispositionItem = z.infer<typeof DispositionItemSchema>;
