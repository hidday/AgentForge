#!/usr/bin/env node
// Propagates the canonical create-linear-issue skill spec to the self-contained
// global skill copies (Cursor + Claude) outside this repo.
//
// Canonical source (edit these, then run this script):
//   .agents/skills/create-linear-issue.md           (body, no frontmatter)
//   .agents/skills/create-linear-issue-examples.md  (examples)
//
// In-repo .cursor/.claude stubs point at the canonical via relative links and
// need no sync. Only the global ~/.cursor and ~/.claude copies are regenerated
// here, because those locations have no .agents/ folder to link back to.

import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const LEADING_COMMENT = /^\s*<!--[\s\S]*?-->\s*/;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = homedir();

const CANONICAL_BODY = join(
  repoRoot,
  ".agents/skills/create-linear-issue.md",
);
const CANONICAL_EXAMPLES = join(
  repoRoot,
  ".agents/skills/create-linear-issue-examples.md",
);

const FRONTMATTER = `---
name: create-linear-issue
description: >-
  Create structured Linear issues optimized for AI agent consumption by the Dev
  Orchestrator. Use when the user wants to create a new issue, task, ticket, or
  Linear issue, or when filing a bug, feature request, or refactor task.
---`;

const AUTOGEN_NOTE =
  "<!-- AUTO-GENERATED from AgentForge/.agents/skills/create-linear-issue.md " +
  "via scripts/sync-skill-copies.mjs. Do not edit directly; edit the canonical " +
  "source and re-run `node scripts/sync-skill-copies.mjs`. -->";

// Each target is a self-contained skill directory: SKILL.md + examples.md
const TARGET_DIRS = [
  join(HOME, ".cursor/skills/create-linear-issue"),
  join(HOME, ".claude/skills/create-linear-issue"),
];

function buildSkillMd() {
  let body = readFileSync(CANONICAL_BODY, "utf8").trimEnd();

  // Drop a leading canonical-marker HTML comment so it does not leak into the
  // generated copies (which carry their own AUTOGEN note instead).
  body = body.replace(LEADING_COMMENT, "");

  // The canonical body links to the examples via its in-repo path. In a
  // self-contained copy the examples file sits beside SKILL.md as examples.md.
  body = body.replace(
    /\[create-linear-issue-examples\.md\]\([^)]*create-linear-issue-examples\.md\)/g,
    "[examples.md](examples.md)",
  );

  return `${FRONTMATTER}\n${AUTOGEN_NOTE}\n\n${body}\n`;
}

function main() {
  const skillMd = buildSkillMd();
  const examplesMd =
    readFileSync(CANONICAL_EXAMPLES, "utf8").replace(LEADING_COMMENT, "");

  for (const dir of TARGET_DIRS) {
    mkdirSync(dir, { recursive: true });
    const skillPath = join(dir, "SKILL.md");
    const examplesPath = join(dir, "examples.md");
    writeFileSync(skillPath, skillMd, "utf8");
    writeFileSync(examplesPath, examplesMd, "utf8");
    console.log(`synced ${skillPath}`);
    console.log(`synced ${examplesPath}`);
  }

  console.log(`\nDone. Synced ${TARGET_DIRS.length} global skill copies.`);
}

main();
