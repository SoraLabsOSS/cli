import { add } from "@/commands/add.js";
import { build } from "@/commands/build.js";
import { diff } from "@/commands/diff.js";
import { doctor } from "@/commands/doctor.js";
import { init } from "@/commands/init.js";
import { list } from "@/commands/list.js";
import { initMcpClient, startMcpServer } from "@/commands/mcp.js";
import { validate } from "@/commands/validate.js";
import {
  parseAddArgs,
  parseBuildArgs,
  parseDiffArgs,
  parseDoctorArgs,
  parseInitArgs,
  parseListArgs,
  parseMcpArgs,
  parseValidateArgs,
  resolveCwd,
} from "@/utils/args.js";
import { error, header, sanitize } from "@/utils/colors.js";
import { printUpdateNotice, startUpdateCheck } from "@/utils/update-check.js";

declare const __VERSION__: string;

const args = process.argv.slice(2);
const [command] = args;

function printHelp(): void {
  header();
  console.log("Usage: npx @soralabs/cli <command> [options]");
  console.log();
  console.log("Commands:");
  console.log(
    "  init                  Initialize project with components.json and styling"
  );
  console.log("  add [components...]   Add components to your project");
  console.log("  list                  List available components");
  console.log(
    "  diff <components...>  Compare installed components against the registry"
  );
  console.log("  doctor                Diagnose common project setup issues");
  console.log(
    "  build [file]          Build registry components into distribution JSON files"
  );
  console.log(
    "  validate [file]       Validate registry.json schema and component files"
  );
  console.log(
    "  mcp [init]            Start MCP server or configure AI assistant integration"
  );
  console.log();
  console.log("Options:");
  console.log(
    "  --cwd, -c <path>       Run as if started in <path> (for monorepos, e.g. packages/ui)"
  );
  console.log(
    "  --output, -o <path>   Output directory for build command (default: public/r)"
  );
  console.log("  --path <path>         Custom component install path");
  console.log(
    "  --registry <name|url> Product registry key (default: ui) or a full registry URL"
  );
  console.log(
    "  --force, -f           Overwrite existing files without asking"
  );
  console.log(
    "  --yes, -y             Skip confirmation prompts (for scripts/CI)"
  );
  console.log("  --defaults, -d        Use default configurations during init");
  console.log(
    "  --dry-run             Preview changes without writing files or installing packages"
  );
  console.log(
    "  --silent, -s          Suppress per-file output, keep summary lines"
  );
  console.log(
    "  --view                Print resolved file contents instead of writing them"
  );
  console.log(
    "  --json                Output as JSON (list, doctor, validate commands)"
  );
  console.log("  --version, -v         Show the CLI version");
  console.log("  --help, -h            Show this help message");
  console.log();
  console.log("Environment:");
  console.log(
    "  SORA_NO_UPDATE_CHECK  Set to disable the npm update check on every run"
  );
  console.log();
  console.log("Examples:");
  console.log("  npx @soralabs/cli init");
  console.log("  npx @soralabs/cli add text-effect");
  console.log("  npx @soralabs/cli add text-effect draw-underline-link");
  console.log(
    "  npx @soralabs/cli add                         # Interactive mode"
  );
  console.log("  npx @soralabs/cli list");
  console.log(
    "  npx @soralabs/cli add some-item --registry https://your-registry.example.com   # any shadcn-compatible registry"
  );
  console.log("  npx @soralabs/cli diff text-effect");
  console.log(
    "  npx @soralabs/cli add card --cwd packages/ui       # install into a monorepo workspace"
  );
  console.log("  npx @soralabs/cli doctor");
  console.log("  npx @soralabs/cli doctor --json");
  console.log(
    "  npx @soralabs/cli build                       # build registry into public/r"
  );
  console.log(
    "  npx @soralabs/cli validate                    # validate registry.json"
  );
}

async function runAdd(): Promise<void> {
  const parsed = parseAddArgs(args.slice(1));
  const cwd = resolveCwd(parsed.cwd);
  if (cwd === null) {
    process.exitCode = 1;
    return;
  }
  const componentArgs = parsed._.map(String);

  const ok = await add(componentArgs, {
    cwd,
    dryRun: parsed["dry-run"],
    force: parsed.force,
    path: parsed.path,
    registry: parsed.registry,
    silent: parsed.silent,
    view: parsed.view,
    yes: parsed.yes,
  });
  if (!ok) {
    process.exitCode = 1;
  }
}

async function runList(): Promise<void> {
  const parsed = parseListArgs(args.slice(1));
  await list({ json: parsed.json, registry: parsed.registry });
}

async function runDiff(): Promise<void> {
  const parsed = parseDiffArgs(args.slice(1));
  const cwd = resolveCwd(parsed.cwd);
  if (cwd === null) {
    process.exitCode = 1;
    return;
  }
  const componentArgs = parsed._.map(String);

  const ok = await diff(componentArgs, {
    cwd,
    path: parsed.path,
    registry: parsed.registry,
  });
  if (!ok) {
    process.exitCode = 1;
  }
}

async function runDoctor(): Promise<void> {
  const parsed = parseDoctorArgs(args.slice(1));
  const cwd = resolveCwd(parsed.cwd);
  if (cwd === null) {
    process.exitCode = 1;
    return;
  }

  const ok = await doctor(__VERSION__, {
    cwd,
    json: parsed.json,
    registry: parsed.registry,
  });
  if (!ok) {
    process.exitCode = 1;
  }
}

async function runInit(): Promise<void> {
  const parsed = parseInitArgs(args.slice(1));
  const cwd = resolveCwd(parsed.cwd);
  if (cwd === null) {
    process.exitCode = 1;
    return;
  }

  const ok = await init({
    cwd,
    defaults: parsed.defaults,
    force: parsed.force,
    yes: parsed.yes,
  });
  if (!ok) {
    process.exitCode = 1;
  }
}

function runBuild(argv: string[]): void {
  const parsed = parseBuildArgs(argv);
  const cwd = resolveCwd(parsed.cwd);
  if (cwd === null) {
    process.exitCode = 1;
    return;
  }

  const [registryFile] = parsed._.map(String);
  const ok = build(registryFile, {
    cwd,
    output: parsed.output,
  });
  if (!ok) {
    process.exitCode = 1;
  }
}

function runValidate(argv: string[]): void {
  const parsed = parseValidateArgs(argv);
  const cwd = resolveCwd(parsed.cwd);
  if (cwd === null) {
    process.exitCode = 1;
    return;
  }

  const [registryFile] = parsed._.map(String);
  const ok = validate(registryFile, {
    cwd,
    json: parsed.json,
  });
  if (!ok) {
    process.exitCode = 1;
  }
}

async function runMcp(): Promise<void> {
  const [, sub] = args;
  if (sub === "init") {
    const parsed = parseMcpArgs(args.slice(2));
    const cwd = resolveCwd(parsed.cwd);
    if (cwd === null) {
      process.exitCode = 1;
      return;
    }
    const ok = await initMcpClient({ client: parsed.client, cwd });
    if (!ok) {
      process.exitCode = 1;
    }
    return;
  }
  await startMcpServer();
}

function runRegistry(): void {
  const [, sub] = args;
  if (sub === "build") {
    runBuild(args.slice(2));
    return;
  }
  if (sub === "validate") {
    runValidate(args.slice(2));
    return;
  }
  error(`Unknown registry command: ${sub ?? ""}`);
  printHelp();
  process.exit(1);
}

async function runCommand(): Promise<void> {
  if (command === "init") {
    await runInit();
    return;
  }

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

  if (command === "build") {
    runBuild(args.slice(1));
    return;
  }

  if (command === "validate") {
    runValidate(args.slice(1));
    return;
  }

  if (command === "mcp") {
    await runMcp();
    return;
  }

  if (command === "registry") {
    runRegistry();
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
    // command's own work is done. Doctor reports the CLI version as one
    // of its own checks, so don't fire a second npm request (and a
    // duplicate notice) for it.
    const updateCheck =
      command === "doctor"
        ? Promise.resolve(null)
        : startUpdateCheck(__VERSION__);
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
    error(sanitize(msg) || "An unknown error occurred");
    process.exit(1);
  }
}

main();
