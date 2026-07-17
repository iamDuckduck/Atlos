import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const shouldSkipSubset = args.includes('--skip-subset') || args.includes('--skip-subset-fonts');
const unknownArgs = args.filter((arg) => !['--skip-subset', '--skip-subset-fonts'].includes(arg));

if (unknownArgs.length > 0) {
  throw new Error(`Unknown build:all arguments: ${unknownArgs.join(', ')}`);
}

const baseEnv = {
  ...process.env,
  DEPLOY_CHANNEL: process.env.DEPLOY_CHANNEL || 'prod',
};

const runSync = (command, commandArgs, env = {}) => {
  console.log(`\n> ${[command, ...commandArgs].join(' ')}`);
  execFileSync(command, commandArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...baseEnv, ...env },
  });
};

const runAsync = (label, command, commandArgs, env = {}) =>
  new Promise((resolve) => {
    console.log(`\n[build:all:${label}] > ${[command, ...commandArgs].join(' ')}`);
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...baseEnv, ...env },
    });
    child.on('error', (error) => resolve({ label, ok: false, error }));
    child.on('exit', (code, signal) => resolve({
      label,
      ok: code === 0,
      code,
      signal,
    }));
  });

runSync('node', [
  './scripts/build-prepare.mjs',
  '--skip-seo',
  ...(shouldSkipSubset ? ['--skip-subset'] : []),
]);

const results = await Promise.all([
  runAsync('oss', 'node', ['./scripts/build-oss.mjs', '--skip-prepare'], {
    BUILD_TARGET: 'oss',
    BUILD_OUT_DIR: 'dist/oss',
  }),
  runAsync('r2', 'node', ['./scripts/build-r2.mjs', '--skip-prepare'], {
    BUILD_TARGET: 'r2',
    BUILD_OUT_DIR: 'dist/r2',
  }),
]);

console.log('\n[build:all] summary');
for (const result of results) {
  console.log(`- ${result.label}: ${result.ok ? 'succeeded' : `failed (${result.signal || result.code || result.error?.message})`}`);
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}
