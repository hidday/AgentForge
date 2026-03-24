import { z } from "zod";

export const DispositionStatus = z.enum(["accepted", "dismissed", "partially_incorporated"]);
export type DispositionStatus = z.infer<typeof DispositionStatus>;

// The model sometimes uses synonyms like "partially_accepted". Normalize
// any unknown value that looks like partial to "partially_incorporated".
const NormalizedDispositionStatus = z
  .string()
  .transform((v) => {
    if (v === "accepted") return "accepted";
    if (v === "dismissed" || v === "rejected") return "dismissed";
    return "partially_incorporated";
  })
  .pipe(DispositionStatus);

export const DispositionItemSchema = z.object({
  findingId: z.string(),
  status: NormalizedDispositionStatus,
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
