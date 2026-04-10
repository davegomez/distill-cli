import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listSkills, showSkill } from '#/commands/skills.ts';

const REQUIRED_SKILLS = [
    'distill-actions',
    'distill-content-is-data',
    'distill-errors',
    'distill-extract',
    'distill-fields',
    'distill-images',
];

const REQUIRED_FRONTMATTER_FIELDS = ['name', 'description', 'applies_to'];

describe('skills', () => {
    describe('listSkills', () => {
        it('returns all six shipped skills', () => {
            const skills = listSkills();
            const names = skills.map((s) => s.name);
            for (const name of REQUIRED_SKILLS) {
                expect(names).toContain(name);
            }
        });

        it('returns skills sorted by name', () => {
            const skills = listSkills();
            const names = skills.map((s) => s.name);
            const sorted = [...names].sort();
            expect(names).toEqual(sorted);
        });

        it('every skill has required metadata fields', () => {
            const skills = listSkills();
            for (const skill of skills) {
                for (const field of REQUIRED_FRONTMATTER_FIELDS) {
                    expect(skill).toHaveProperty(field);
                    expect(
                        (skill as unknown as Record<string, unknown>)[field],
                    ).toBeTruthy();
                }
            }
        });

        it('every skill has a file field', () => {
            const skills = listSkills();
            for (const skill of skills) {
                expect(skill.file).toMatch(/\.md$/);
            }
        });
    });

    describe('showSkill', () => {
        it('returns content for a valid skill name', () => {
            const content = showSkill('distill-extract');
            expect(content).toBeTruthy();
            expect(content).toContain('distill-extract');
        });

        it('returns null for an unknown skill name', () => {
            const content = showSkill('nonexistent-skill');
            expect(content).toBeNull();
        });

        it('returns content with frontmatter for each shipped skill', () => {
            for (const name of REQUIRED_SKILLS) {
                const content = showSkill(name);
                expect(content).toBeTruthy();
                expect(content).toMatch(/^---\n/);
            }
        });
    });

    describe('contract: frontmatter', () => {
        it('every skill file has name, description, and applies_to in frontmatter', () => {
            for (const name of REQUIRED_SKILLS) {
                const content = showSkill(name);
                expect(content, `${name} should exist`).toBeTruthy();

                const frontmatter = content?.match(
                    /^---\n([\s\S]*?)\n---/,
                )?.[1];
                expect(
                    frontmatter,
                    `${name} should have frontmatter`,
                ).toBeTruthy();

                expect(frontmatter).toMatch(/^name:\s*.+$/m);
                expect(frontmatter).toMatch(/^description:\s*.+$/m);
                expect(frontmatter).toMatch(/^applies_to:\s*.+$/m);
            }
        });
    });

    describe('CLI integration', () => {
        let stdoutData: string;

        beforeEach(() => {
            stdoutData = '';
            vi.spyOn(process.stdout, 'write').mockImplementation(
                (chunk: string | Uint8Array) => {
                    stdoutData += String(chunk);
                    return true;
                },
            );
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('distill skills list returns JSON array', () => {
            const skills = listSkills();
            process.stdout.write(`${JSON.stringify(skills, null, 2)}\n`);
            const parsed = JSON.parse(stdoutData);
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBeGreaterThanOrEqual(6);
        });

        it('distill skills show <name> prints content', () => {
            const content = showSkill('distill-extract');
            expect(content).toBeTruthy();
            process.stdout.write(content as string);
            expect(stdoutData).toContain('# Extracting content with distill');
        });
    });
});
