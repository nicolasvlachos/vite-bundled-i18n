#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { analyze, generate, compile, report, build, clean, rebuild } from './commands';
import type { CliConfig, CleanOptions } from './commands';

const COMMANDS = ['analyze', 'generate', 'compile', 'report', 'build', 'clean', 'rebuild'] as const;
type Command = (typeof COMMANDS)[number];

function printUsage(): void {
  console.log('Usage: vite-bundled-i18n <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  analyze   — Walk imports and print a summary of key usage per route');
  console.log('  generate  — Generate tree-shaken bundles and TypeScript types');
  console.log('  report    — Generate diagnostic reports (manifest, missing, unused, stats)');
  console.log('  compile   — Compile pre-resolved flat Map modules for production');
  console.log('  build     — Run analyze + generate + compile + report in one step');
  console.log('  clean     — Remove .i18n/ generated artifacts (extraction cache, reports, types, build-stamp)');
  console.log('  rebuild   — clean + build (use when prod bundles look stale or out-of-sync)');
  console.log('');
  console.log('Options:');
  console.log('  --config <path>      Path to config file (default: i18n.config.json)');
  console.log('  --no-cache           Disable the extraction cache for this run');
  console.log('  --clear-cache        Clear the extraction cache before running');
  console.log('  --extra-path <path>  (clean/rebuild) Additional path to remove. Repeatable.');
  console.log('  --allow-outside-root (clean/rebuild) Permit --extra-path entries outside the project root.');
}

function loadConfig(configPath: string): CliConfig {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    console.error(`Config file not found: ${resolved}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(resolved, 'utf-8');
  return JSON.parse(raw) as CliConfig;
}

interface ParsedArgs {
  command: Command;
  configPath: string;
  noCache: boolean;
  clearCache: boolean;
  extraPaths: string[];
  allowOutsideRoot: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let command: Command | undefined;
  let configPath = 'i18n.config.json';
  let noCache = false;
  let clearCache = false;
  let allowOutsideRoot = false;
  const extraPaths: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--config' && i + 1 < args.length) {
      configPath = args[++i];
    } else if (arg === '--no-cache') {
      noCache = true;
    } else if (arg === '--clear-cache') {
      clearCache = true;
    } else if (arg === '--extra-path' && i + 1 < args.length) {
      extraPaths.push(args[++i]);
    } else if (arg === '--allow-outside-root') {
      allowOutsideRoot = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (!command && COMMANDS.includes(arg as Command)) {
      command = arg as Command;
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }

  if (!command) {
    printUsage();
    process.exit(1);
  }

  return { command: command!, configPath, noCache, clearCache, extraPaths, allowOutsideRoot };
}

const { command, configPath, noCache, clearCache, extraPaths, allowOutsideRoot } = parseArgs(process.argv);

// `clean` is the only command that doesn't strictly require a config file —
// it operates on `outDir` (defaults to `.i18n/`) plus any `--extra-path`
// values. If a config exists we honor its `outDir`; otherwise we fall
// back to the default. This keeps `npx vite-bundled-i18n clean` usable
// even when the config has been moved or deleted.
if (command === 'clean') {
  const cleanConfig: CliConfig | null = fs.existsSync(path.resolve(configPath))
    ? loadConfig(configPath)
    : null;
  const cleanOpts: CleanOptions = {
    rootDir: cleanConfig?.rootDir,
    outDir: cleanConfig?.outDir,
    extraPaths,
    allowOutsideRoot,
  };
  clean(cleanOpts);
  process.exit(0);
}

const config = loadConfig(configPath);

// CLI flags merge into the config's `cache` field so downstream resolution
// sees them. Env vars still take the final word via resolveCacheConfig.
if (noCache) {
  config.cache = false;
}
if (clearCache) {
  // Resolve-time handling: a CLI-driven clear is honored even when config
  // doesn't opt into the cache object form. We signal via an env var so
  // the central resolver is the single source of truth.
  process.env.VITE_I18N_CLEAR_CACHE = '1';
}

if (command === 'rebuild') {
  rebuild(config, { extraPaths, allowOutsideRoot });
  process.exit(0);
}

const commands: Record<Exclude<Command, 'clean' | 'rebuild'>, (cfg: CliConfig) => void> = {
  analyze,
  generate,
  compile,
  report,
  build,
};

commands[command as Exclude<Command, 'clean' | 'rebuild'>](config);
