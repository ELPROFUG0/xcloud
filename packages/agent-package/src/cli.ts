#!/usr/bin/env node
import { inspectAgentPackage, installAgentPackage } from "./index.js";

function usage() {
  console.log(`xcloud-agent

Usage:
  xcloud-agent inspect <file.xcloud-agent>
  xcloud-agent install <file.xcloud-agent> [--id <agent-id>] [--home <home-dir>]
`);
}

function readOption(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
}

async function main() {
  const [command, file, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }
  if (!file) throw new Error(`Missing package file for "${command}".`);

  if (command === "inspect") {
    const result = await inspectAgentPackage(file);
    console.log(JSON.stringify({
      file: result.file,
      agent: result.manifest.agent,
      ui: result.manifest.ui,
      hasAgentContext: result.hasAgentContext,
      hasUi: result.hasUi,
      entries: result.entries.length,
    }, null, 2));
    return;
  }

  if (command === "install") {
    const result = await installAgentPackage(file, {
      id: readOption(rest, "--id"),
      home: readOption(rest, "--home"),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
