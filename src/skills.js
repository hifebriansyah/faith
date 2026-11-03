// Skills: folders under skills/<name>/SKILL.md (the Agent Skills format: frontmatter name + description, then instructions).
// The prompt lists only name and description; the model reads the full text with the load_skill tool when a task matches.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const SKILLS_DIR = new URL("../skills/", import.meta.url).pathname;

/** Split a SKILL.md into { name, description, body }; null when it has no frontmatter name. */
export function parseSkill(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const field = (k) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(m[1])?.[1].trim();
  const name = field("name");
  return name ? { name, description: field("description") ?? "", body: m[2].trim() } : null;
}

/** Read every skill under `dir` (read on each call, so edits apply without a restart): Map name -> skill. */
export function loadSkills(dir = SKILLS_DIR) {
  const skills = new Map();
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return skills;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const skill = parseSkill(readFileSync(join(dir, e.name, "SKILL.md"), "utf8"));
      if (skill) skills.set(skill.name, skill);
    } catch {} // a folder without SKILL.md is not a skill
  }
  return skills;
}

/** The load_skill tool for agent.js: names come from the loaded map, so the model can never read other files. */
export function skillTool(skills) {
  return {
    run: async ({ name }) => {
      const skill = skills.get(name);
      if (!skill) throw new Error(`unknown skill "${name}"; available: ${[...skills.keys()].join(", ")}`);
      return skill.body;
    },
    usage: '{"name": "skill-name"}',
    does: "read a skill's full instructions; do this first when a skill below matches the task",
    skill: true, // the result is instructions: keep all of it (agent.js does not cut it)
  };
}
