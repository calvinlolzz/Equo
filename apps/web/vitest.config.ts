import { defineConfig } from "vitest/config";

/**
 * The project ran without a vitest config for a long time, and the defaults are
 * still what is wanted: node environment, per-file `@vitest-environment jsdom`
 * where a test needs a DOM, the standard include globs.
 *
 * The one thing this adds is a setup file, and it exists for a single reason -
 * see setupTests.ts. Everything else is deliberately left at the default so
 * that running vitest from here behaves exactly as it did before.
 */
export default defineConfig({
  test: {
    setupFiles: ["./src/setupTests.ts"],
  },
});
