import { readFileSync, writeFileSync } from 'node:fs';

// Accept the target version as a CLI argument (e.g. `node version-bump.mjs 1.2.0`).
// Falls back to npm_package_version for `npm version` lifecycle compatibility.
const targetVersion = process.argv[2] ?? process.env.npm_package_version;

if (!targetVersion || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(targetVersion)) {
	console.error('Usage: node version-bump.mjs <version>  (e.g. 1.2.0)');
	console.error(`Received: ${targetVersion ?? '(nothing)'}`);
	process.exit(1);
}

// The manifest lives in public/ -- vite-plugin-static-copy copies it into build/.
const manifestPath = 'public/manifest.json';
const versionsPath = 'versions.json';

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);

const versions = JSON.parse(readFileSync(versionsPath, 'utf8'));
versions[targetVersion] = minAppVersion;
writeFileSync(versionsPath, `${JSON.stringify(versions, null, '\t')}\n`);

console.log(`Bumped to ${targetVersion} (minAppVersion ${minAppVersion}).`);
console.log(`Updated ${manifestPath} and ${versionsPath}.`);
