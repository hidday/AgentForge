import { z } from "zod";

export const IssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  labels: z.array(z.string()),
  priority: z.number().int().min(0).max(4),
  project: z.string().optional(),
  cycle: z.string().optional(),
});

export const RepoConfigSchema = z.object({
  name: z.string(),
  defaultBranch: z.string(),
  workingBranch: z.string(),
  repoPath: z.string(),
  allowedPaths: z.array(z.string()),
  protectedPaths: z.array(z.string()),
});

export const ConstraintsSchema = z.object({
  requiredChecks: z.array(z.string()),
  maxFilesChanged: z.number().int().positive(),
  maxDiffLines: z.number().int().positive(),
  forbiddenPatterns: z.array(z.string()),
  mustNotTouch: z.array(z.string()),
});

export const RelatedIssueSchema = z.object({
  id: z.string(),
  identifier: z.string().optional(),
  title: z.string(),
  description: z.string(),
  state: z.string(),
  labels: z.array(z.string()),
  priority: z.number().int().min(0).max(4),
  url: z.string().optional(),
});

export const RelatedContextSchema = z.object({
  parent: RelatedIssueSchema.optional(),
  blockers: z.array(RelatedIssueSchema),
});

export const TaskBundleSchema = z.object({
  issue: IssueSchema,
  repo: RepoConfigSchema,
  constraints: ConstraintsSchema,
  definitionOfDone: z.array(z.string()),
  relatedContext: RelatedContextSchema.optional(),
});

export type TaskBundle = z.infer<typeof TaskBundleSchema>;
export type Issue = z.infer<typeof IssueSchema>;
export type RepoConfig = z.infer<typeof RepoConfigSchema>;
export type Constraints = z.infer<typeof ConstraintsSchema>;
export type RelatedIssue = z.infer<typeof RelatedIssueSchema>;
export type RelatedContext = z.infer<typeof RelatedContextSchema>;
