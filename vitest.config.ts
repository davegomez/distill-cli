import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [tsconfigPaths({ projects: ['./tsconfig.json'] })],
    test: {
        environment: 'node',
        include: [
            'src/**/*.test.ts',
            'test/unit/**/*.test.ts',
            'test/integration/**/*.test.ts',
            'test/*.spec.ts',
        ],
        exclude: ['test/e2e/**', 'test/fixtures/**'],
        setupFiles: ['test/setup.ts'],
        passWithNoTests: true,
    },
});
