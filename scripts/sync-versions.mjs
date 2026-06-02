#!/usr/bin/env node
// Helper script: reads the current version from manifest.json and ensures
// versions.json has an entry for it. Run this manually before tagging, or
// as a pre-commit hook. Idempotent — re-running with the same version is fine.
//
// Usage: node scripts/sync-versions.mjs
//
// release-please bumps manifest.json automatically but doesn't know how to
// update versions.json (whose KEYS are version numbers, not values). This
// script bridges that gap.

import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
const minAppVersion = manifest.minAppVersion;
const version = manifest.version;

if (!version) {
  console.error("manifest.json has no `version` field");
  process.exit(1);
}
if (!minAppVersion) {
  console.error("manifest.json has no `minAppVersion` field");
  process.exit(1);
}

if (versions[version] === minAppVersion) {
  console.log(`versions.json already has ${version} → ${minAppVersion} (nothing to do)`);
  process.exit(0);
}

versions[version] = minAppVersion;
fs.writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");
console.log(`versions.json updated: ${version} → ${minAppVersion}`);
