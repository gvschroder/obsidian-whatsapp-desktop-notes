import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

// Fixed, non-UTC time zone: day headers use local time while "Sync since" is
// parsed as UTC, so the golden files must not depend on the
// machine running the tests. São Paulo has had no DST since 2019.
const TZ = "America/Sao_Paulo";
process.env.TZ = TZ;

export default defineConfig({
	resolve: {
		// The `obsidian` npm package ships types only; tests use an in-memory stand-in.
		alias: { obsidian: fileURLToPath(new URL("./tests/mocks/obsidian.ts", import.meta.url)) },
	},
	test: {
		include: ["tests/**/*.test.ts"],
		env: { TZ },
		setupFiles: ["tests/setup.ts"],
		coverage: {
			provider: "v8",
			// Gate the pure layers, where every decision lives. Adapters (source/,
			// vault/, ui/) are covered by the characterization tests instead.
			include: ["src/core/**/*.ts", "src/state/migrations.ts"],
			exclude: ["src/core/types.ts"],
			thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
			reporter: ["text-summary", "text"],
		},
	},
});
