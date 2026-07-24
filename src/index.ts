import { add } from "@/commands/add.js";
import { diff } from "@/commands/diff.js";
import { doctor } from "@/commands/doctor.js";
import { list } from "@/commands/list.js";
import { parseComponentArgs, parseFlag, resolveCwd } from "@/utils/args.js";
import { error, header } from "@/utils/colors.js";
import { printUpdateNotice, startUpdateCheck } from "@/utils/update-check.js";

declare const __VERSION__: string;

const args = process.argv.slice(2);
const [command] = args;

function printHelp(): void {
  header();
  console.log("Usage: npx @soralabsoss/sora-cli <command> [options]");
  console.log();
  console.log("Commands:");
  console.log("  add [components...]   Add components to your project");
  console.log("  list                  List available components");
  console.log(
    "  diff <components...>  Compare installed components against the registry"
  );
  console.log("  doctor                Diagnose common project setup issues");
  console.log();
  console.log("Options:");
  console.log(
    "  --cwd, -c <path>       Run as if started in <path> (for monorepos, e.g. packages/ui)"
  );
  console.log("  --path <path>         Custom component install path");
  console.log(
    "  --registry <name|url> Product registry key (default: ui) or a full registry URL"
  );
  console.log(
    "  --force               Overwrite existing files without asking"
  );
  console.log(
    "  --yes, -y             Skip the install confirmation prompt (for scripts/CI)"
  );
  console.log(
    "  --dry-run             Preview changes without writing files or installing packages"
  );
  console.log(
    "  --silent, -s          Suppress per-file output, keep summary lines"
  );
  console.log(
    "  --view                Print resolved file contents instead of writing them"
  );
  console.log("  --json                Output as JSON (list, doctor commands)");
  console.log("  --version, -v         Show the CLI version");
  console.log("  --help, -h            Show this help message");
  console.log();
  console.log("Environment:");
  console.log(
    "  SORA_NO_UPDATE_CHECK  Set to disable the npm update check on every run"
  );
  console.log();
  console.log("Examples:");
  console.log("  npx @soralabsoss/sora-cli add text-effect");
  console.log(
    "  npx @soralabsoss/sora-cli add text-effect draw-underline-link"
  );
  console.log(
    "  npx @soralabsoss/sora-cli add                         # Interactive mode"
  );
  console.log("  npx @soralabsoss/sora-cli list");
  console.log(
    "  npx @soralabsoss/sora-cli add some-item --registry https://your-registry.example.com   # any shadcn-compatible registry"
  );
  console.log("  npx @soralabsoss/sora-cli diff text-effect");
  console.log(
    "  npx @soralabsoss/sora-cli add card --cwd packages/ui       # install into a monorepo workspace"
  );
  console.log("  npx @soralabsoss/sora-cli doctor");
  console.log("  npx @soralabsoss/sora-cli doctor --json");
}

async function runAdd(): Promise<void> {
  const rest = args.slice(1);
  const cwd = resolveCwd(parseFlag(rest, "--cwd", "-c"));
  if (cwd === null) {
    process.exitCode = 1;
    return;
  }
  const path = parseFlag(rest, "--path");
  const registry = parseFlag(rest, "--registry");
  const force = rest.includes("--force") || rest.includes("-f");
  const yes = rest.includes("--yes") || rest.includes("-y");
  const dryRun = rest.includes("--dry-run");
  const silent = rest.includes("--silent") || rest.includes("-s");
  const view = rest.includes("--view");
  const componentArgs = parseComponentArgs(rest);

  const ok = await add(componentArgs, {
    cwd,
    dryRun,
    force,
    path,
    registry,
    silent,
    view,
    yes,
  });
  if (!ok) {
    process.exitCode = 1;
  }
}

async function runList(): Promise<void> {
  const rest = args.slice(1);
  const json = rest.includes("--json");
  const registry = parseFlag(rest, "--registry");
  await list({ json, registry });
}

async function runDiff(): Promise<void> {
  const rest = args.slice(1);
  const cwd = resolveCwd(parseFlag(rest, "--cwd", "-c"));
  if (cwd === null) {
    process.exitCode = 1;
    return;
  }
  const path = parseFlag(rest, "--path");
  const registry = parseFlag(rest, "--registry");
  const componentArgs = parseComponentArgs(rest);

  const ok = await diff(componentArgs, { cwd, path, registry });
  if (!ok) {
    process.exitCode = 1;
  }
}

async function runDoctor(): Promise<void> {
  const rest = args.slice(1);
  const cwd = resolveCwd(parseFlag(rest, "--cwd", "-c"));
  if (cwd === null) {
    process.exitCode = 1;
    return;
  }
  const path = parseFlag(rest, "--path");
  const registry = parseFlag(rest, "--registry");
  const json = rest.includes("--json");

  const ok = await doctor(__VERSION__, { cwd, json, path, registry });
  if (!ok) {
    process.exitCode = 1;
  }
}

async function runCommand(): Promise<void> {
  if (command === "add") {
    await runAdd();
    return;
  }

  if (command === "list" || command === "ls") {
    await runList();
    return;
  }

  if (command === "diff") {
    await runDiff();
    return;
  }

  if (command === "doctor") {
    await runDoctor();
    return;
  }

  error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

async function main(): Promise<void> {
  try {
    if (!command || command === "--help" || command === "-h") {
      printHelp();
      return;
    }

    if (command === "--version" || command === "-v") {
      console.log(__VERSION__);
      return;
    }

    // Kicked off in parallel with the command itself so it never adds
    // latency; only checked (with its own short timeout) once the
    // command's own work is done.
    const updateCheck = startUpdateCheck(__VERSION__);
    try {
      await runCommand();
    } finally {
      const latest = await updateCheck;
      if (latest) {
        printUpdateNotice(latest, __VERSION__);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(msg || "An unknown error occurred");
    process.exit(1);
  }
}

main();
