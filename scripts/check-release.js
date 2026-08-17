import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const baseRef = process.argv[2] ?? process.env.RELEASE_CHECK_BASE_REF ?? 'origin/main';

function fail(message) {
  console.error(`Release check failed: ${message}`);
  process.exitCode = 1;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function gitShowJson(ref, path) {
  try {
    return JSON.parse(
      execFileSync('git', ['show', `${ref}:${path}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );
  } catch (error) {
    fail(`could not read ${path} from ${ref}`);
    return null;
  }
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareSemver(a, b) {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  if (!parsedA || !parsedB) return null;
  for (let i = 0; i < 3; i += 1) {
    if (parsedA[i] !== parsedB[i]) return parsedA[i] - parsedB[i];
  }
  return 0;
}

const packageJson = readJson('package.json');
const version = packageJson.version;
const versionedFiles = ['manifest.json', 'manifest.firefox.json'];

for (const path of versionedFiles) {
  const fileVersion = readJson(path).version;
  if (fileVersion !== version) {
    fail(`${path} version ${fileVersion} does not match package.json version ${version}`);
  }
}

if (existsSync('package-lock.json')) {
  const lock = readJson('package-lock.json');
  if (lock.version !== version) {
    fail(`package-lock.json version ${lock.version} does not match package.json version ${version}`);
  }
  const rootVersion = lock.packages?.['']?.version;
  if (rootVersion !== version) {
    fail(`package-lock.json root package version ${rootVersion} does not match package.json version ${version}`);
  }
}

const basePackageJson = gitShowJson(baseRef, 'package.json');
if (basePackageJson) {
  const comparison = compareSemver(version, basePackageJson.version);
  if (comparison === null) {
    fail(`could not compare package versions ${basePackageJson.version} and ${version}`);
  } else if (comparison <= 0) {
    fail(`package.json version must increase from ${basePackageJson.version}; found ${version}`);
  }
}

const readme = readFileSync('README.md', 'utf8');
if (!readme.includes('<summary>Release notes</summary>')) {
  fail('README.md is missing the collapsible release notes section');
}

const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
if (!new RegExp(`^### v${escapedVersion}$`, 'm').test(readme)) {
  fail(`README.md is missing release notes for v${version}`);
}

if (process.exitCode) {
  process.exit();
}

console.log(`Release metadata is ready for v${version}.`);
