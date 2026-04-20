#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { analyze, generate, compile, report, build } from './commands';
import type { CliConfig } from './commands';

const COMMANDS = ['analyze', 'generate', 'compile', 'report', 'build'] as const;
type Command = (typeof COMMANDS)[number];

function printUsage(): void {
  console.log('Usage: vite-bundled-i18n <command> [--config <path>]');
  console.log('');
  console.log('Commands:');
  console.log('  analyze   — Walk imports and print a summary of key usage per route');
  console.log('  generate  — Generate tree-shaken bundles and TypeScript types');
  console.log('  report    — Generate diagnostic reports (manifest, missing, unused, stats)');
  console.log('  compile   — Compile pre-resolved flat Map modules for production');
  console.log('  build     — Run analyze + generate + compile + report in one step');
  console.log('');
  console.log('Options:');
  console.log('  --config <path>  Path to config file (default: i18n.config.json)');
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

function parseArgs(argv: string[]): { command: Command; configPath: string } {
  const args = argv.slice(2);
  let command: Command | undefined;
  let configPath = 'i18n.config.json';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--config' && i + 1 < args.length) {
      configPath = args[++i];
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

  return { command: command!, configPath };
}

const { command, configPath } = parseArgs(process.argv);
const config = loadConfig(configPath);

const commands: Record<Command, (cfg: CliConfig) => void> = {
  analyze,
  generate,
  compile,
  report,
  build,
};

commands[command](config);
