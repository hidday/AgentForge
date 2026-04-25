-- AlterEnum: add Skill variant to ArtifactType
ALTER TYPE "ArtifactType" ADD VALUE IF NOT EXISTS 'Skill';

-- CreateTable
CREATE TABLE "agent_skills" (
    "id" TEXT NOT NULL,
    "repoSlug" TEXT NOT NULL,
    "taskCategory" TEXT NOT NULL,
    "skillMarkdown" TEXT NOT NULL,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "utilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "agent_skills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_skills_repoSlug_archivedAt_idx" ON "agent_skills"("repoSlug", "archivedAt");

-- CreateIndex
CREATE INDEX "agent_skills_repoSlug_utilityScore_idx" ON "agent_skills"("repoSlug", "utilityScore");
