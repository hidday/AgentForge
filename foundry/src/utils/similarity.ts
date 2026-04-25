/**
 * Trigram similarity utilities for skill retrieval ranking and novelty pre-check.
 * All functions are pure (no I/O), enabling direct unit testing.
 */

/**
 * Extracts overlapping trigrams (3-character sequences) from a string.
 * Lowercases the input and strips punctuation before extracting.
 */
export function extractTrigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\w\s]/g, "");
  const trigrams = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(normalized.slice(i, i + 3));
  }
  return trigrams;
}

/**
 * Returns the Jaccard coefficient of two trigram sets.
 * Range [0, 1]. Returns 0 if both sets are empty.
 */
export function trigramSimilarity(a: string, b: string): number {
  const trigramsA = extractTrigrams(a);
  const trigramsB = extractTrigrams(b);

  if (trigramsA.size === 0 && trigramsB.size === 0) return 0;

  let intersection = 0;
  for (const trigram of trigramsA) {
    if (trigramsB.has(trigram)) intersection++;
  }

  const union = trigramsA.size + trigramsB.size - intersection;
  if (union === 0) return 0;

  return intersection / union;
}

/**
 * Scores how relevant a skill is to a query string.
 * Returns the max of similarity against taskCategory and the first 200 chars of skillMarkdown.
 */
export function scoreSkillRelevance(
  skill: { taskCategory: string; skillMarkdown: string },
  query: string,
): number {
  const categoryScore = trigramSimilarity(query, skill.taskCategory);
  const contentScore = trigramSimilarity(query, skill.skillMarkdown.slice(0, 200));
  return Math.max(categoryScore, contentScore);
}

/**
 * Returns the maximum scoreSkillRelevance across all existing skills.
 * Returns 0 if the array is empty.
 */
export function maxNoveltyOverlap(
  existingSkills: Array<{ taskCategory: string; skillMarkdown: string }>,
  query: string,
): number {
  if (existingSkills.length === 0) return 0;
  return Math.max(...existingSkills.map((skill) => scoreSkillRelevance(skill, query)));
}
