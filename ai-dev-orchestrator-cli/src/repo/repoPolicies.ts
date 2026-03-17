import type { Constraints } from "../schemas/taskBundle.js";

export function validateFilePaths(
  filesChanged: string[],
  allowedPaths: string[],
  protectedPaths: string[],
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  for (const file of filesChanged) {
    const isAllowed =
      allowedPaths.length === 0 ||
      allowedPaths.some((p) => file.startsWith(p));
    if (!isAllowed) {
      violations.push(`File "${file}" is not in any allowed path`);
    }

    const isProtected = protectedPaths.some((p) => file.startsWith(p));
    if (isProtected) {
      violations.push(`File "${file}" is in a protected path`);
    }
  }

  return { valid: violations.length === 0, violations };
}

export function validateDiffSize(
  filesChanged: string[],
  constraints: Constraints,
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  if (filesChanged.length > constraints.maxFilesChanged) {
    violations.push(
      `Changed ${filesChanged.length} files (max: ${constraints.maxFilesChanged})`,
    );
  }

  return { valid: violations.length === 0, violations };
}

export function checkForbiddenPatterns(
  content: string,
  forbiddenPatterns: string[],
): { valid: boolean; matches: string[] } {
  const matches: string[] = [];

  for (const pattern of forbiddenPatterns) {
    const regex = new RegExp(pattern, "g");
    if (regex.test(content)) {
      matches.push(pattern);
    }
  }

  return { valid: matches.length === 0, matches };
}
