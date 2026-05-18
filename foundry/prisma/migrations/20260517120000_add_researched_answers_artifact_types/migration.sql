-- AlterEnum: add ResearchedAnswers and ResearcherTranscript variants to ArtifactType
ALTER TYPE "ArtifactType" ADD VALUE IF NOT EXISTS 'ResearchedAnswers';
ALTER TYPE "ArtifactType" ADD VALUE IF NOT EXISTS 'ResearcherTranscript';
