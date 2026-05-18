import { z } from "zod";

export const ResearchedAnswerConfidenceSchema = z.enum(["high", "medium", "low", "unresolved"]);
export type ResearchedAnswerConfidence = z.infer<typeof ResearchedAnswerConfidenceSchema>;

export const ResearchedAnswerSchema = z.object({
  questionId: z.string(),
  question: z.string(),
  answer: z.string(),
  confidence: ResearchedAnswerConfidenceSchema,
  sources: z.array(z.string()).optional(),
});

export const ResearchedAnswersSchema = z.object({
  summary: z.string(),
  answers: z.array(ResearchedAnswerSchema),
  completedAt: z.string(),
});

export type ResearchedAnswer = z.infer<typeof ResearchedAnswerSchema>;
export type ResearchedAnswers = z.infer<typeof ResearchedAnswersSchema>;
