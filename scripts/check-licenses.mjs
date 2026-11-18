// Licence policy gate. Fails when any PRODUCTION
// dependency — i.e. anything that can end up inside main.js — has a licence
// outside the allow-list, or has no licence at all. Dev-only tooling is
// reported but never blocks. No third-party dependency: reads package-lock.json
// and the installed package.json files directly.
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ALLOWED = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "Apache-2.0", "Unlicense", "CC0-1.0"]);
const BLOCKED = /\b(A?GPL|LGPL|SSPL|EUPL|CC-BY-NC|BUSL)\b/i;
// Weak copyleft: tolerated in dev tooling after review, never in production.
const REVIEW = /\b(MPL|EPL|CDDL)\b/i;

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const rows = [];
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
	if (!path || entry.optional || entry.link) continue;
	let license = entry.license;
	if (!license && existsSync(join(path, "package.json"))) {
		const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
		license = pkg.license ?? (pkg.licenses ?? []).map((l) => l.type).join(" OR ");
	}
	rows.push({ name: path.replace(/^.*node_modules\//, ""), version: entry.version, license: license || "UNKNOWN", dev: !!entry.dev });
}

/** Accept SPDX expressions like "(MIT OR Apache-2.0)" if any alternative is allowed. */
function allowed(expr) {
	if (BLOCKED.test(expr) || REVIEW.test(expr)) return false;
	return expr
		.replace(/[()]/g, "")
		.split(/\s+OR\s+/i)
		.some((alt) => alt.split(/\s+AND\s+/i).every((part) => ALLOWED.has(part.trim())));
}

const prod = rows.filter((r) => !r.dev);
const violations = prod.filter((r) => !allowed(r.license));
const devFlags = rows.filter((r) => r.dev && (BLOCKED.test(r.license) || REVIEW.test(r.license)));

const byLicense = {};
for (const r of rows) byLicense[r.license] = (byLicense[r.license] ?? 0) + 1;
console.log(`Licences across ${rows.length} packages:`, byLicense);
console.log(`Production (bundled) packages: ${prod.map((r) => `${r.name}@${r.version} (${r.license})`).join(", ") || "none"}`);

for (const r of devFlags) console.warn(`note: dev-only copyleft package ${r.name}@${r.version} (${r.license}) — not bundled, review if that changes`);

if (violations.length) {
	for (const r of violations) console.error(`✗ ${r.name}@${r.version}: licence "${r.license}" is not allowed in production dependencies`);
	process.exit(1);
}
console.log("✓ Licence policy satisfied.");
