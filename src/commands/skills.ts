import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SKILLS_DIR = join(import.meta.dirname, '..', '..', 'skills');

interface SkillMeta {
    name: string;
    description: string;
    applies_to: string;
}

/** Parse YAML frontmatter from a skill markdown file. */
function parseFrontmatter(content: string): SkillMeta | null {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const yaml = match[1];
    const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim();
    const applies_to = yaml.match(/^applies_to:\s*(.+)$/m)?.[1]?.trim();

    if (!name || !description || !applies_to) return null;
    return { name, description, applies_to };
}

export interface SkillEntry {
    name: string;
    description: string;
    applies_to: string;
    file: string;
}

/** List all available skills with their metadata. */
export function listSkills(): SkillEntry[] {
    const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md'));
    const skills: SkillEntry[] = [];

    for (const file of files) {
        const content = readFileSync(join(SKILLS_DIR, file), 'utf-8');
        const meta = parseFrontmatter(content);
        if (meta) {
            skills.push({ ...meta, file });
        }
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** Show the full content of a skill by name. Returns null if not found. */
export function showSkill(name: string): string | null {
    const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md'));

    for (const file of files) {
        const content = readFileSync(join(SKILLS_DIR, file), 'utf-8');
        const meta = parseFrontmatter(content);
        if (meta?.name === name) return content;
    }

    return null;
}
