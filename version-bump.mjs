import { readFileSync, writeFileSync } from 'fs';

// Usage:
//   npm run bump -- 1.0.1   set an explicit version (no git needed)
//   npm version patch       npm's own flow; also stages the files in git
const targetVersion = process.argv[2] ?? process.env.npm_package_version;

if (!targetVersion || !/^\d+\.\d+\.\d+$/.test(targetVersion)) {
	console.error(`Expected a version like 1.0.1, got "${targetVersion ?? ''}".`);
	process.exit(1);
}

const writeJson = (file, data) => writeFileSync(file, JSON.stringify(data, null, '\t') + '\n');

// Bump manifest.json, keeping its minAppVersion.
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeJson('manifest.json', manifest);

// Map the new version to its minimum Obsidian version.
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
if (!(targetVersion in versions)) {
	versions[targetVersion] = minAppVersion;
	writeJson('versions.json', versions);
}

// Keep package.json in step when called directly.
if (process.argv[2]) {
	const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
	pkg.version = targetVersion;
	writeJson('package.json', pkg);
}

console.log(`Version set to ${targetVersion} (minAppVersion ${minAppVersion}).`);
