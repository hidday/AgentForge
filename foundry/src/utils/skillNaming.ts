const KEBAB_CASE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Slugify a label into a kebab-case skill name suitable for SKILL.md export. */
export function slugifySkillName(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "distilled-skill";
}

export function isValidSkillName(name: string): boolean {
  return KEBAB_CASE_NAME.test(name);
}

export function normalizeSkillName(name: string | undefined, fallback: string): string {
  const trimmed = name?.trim();
  if (trimmed && isValidSkillName(trimmed)) return trimmed;
  return slugifySkillName(fallback);
}
