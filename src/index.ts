import { add } from "@/commands/add.js";
import { build } from "@/commands/build.js";
import { diff } from "@/commands/diff.js";
import { doctor } from "@/commands/doctor.js";
import { info } from "@/commands/info.js";
import { init } from "@/commands/init.js";
import { list } from "@/commands/list.js";
import { initMcpClient, startMcpServer } from "@/commands/mcp.js";
import { search } from "@/commands/search.js";
import { validate } from "@/commands/validate.js";
import {
  parseAddArgs,
  parseBuildArgs,
  parseDiffArgs,
  parseDoctorArgs,
  parseInfoArgs,
  parseInitArgs,
  parseListArgs,
  parseMcpArgs,
  parseSearchArgs,
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
  console.log("  search [query]        Search components by keyword or type");
  console.log(
    "  info <component>      Display component metadata and dependencies"
  );
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

const fail = (ok: boolean) => {
  if (!ok) {
    process.exitCode = 1;
  }
};

/** Resolves cwd and sets exitCode=1 + returns null on failure. */
function cwd(parsed: { cwd?: string }): string | null {
  const resolved = resolveCwd(parsed.cwd);
  if (resolved === null) {
    process.exitCode = 1;
  }
  return resolved;
}

const COMMANDS = {
  add: async () => {
    const p = parseAddArgs(args.slice(1));
    const dir = cwd(p);
    if (!dir) {
      return;
    }
    fail(
      await add(p._, {
        cwd: dir,
        dryRun: p["dry-run"],
        force: p.force,
        path: p.path,
        registry: p.registry,
        silent: p.silent,
        view: p.view,
        yes: p.yes,
      })
    );
  },
  build: (argv = args.slice(1)) => {
    const p = parseBuildArgs(argv);
    const dir = cwd(p);
    if (!dir) {
      return;
    }
    fail(build(p._[0], { cwd: dir, output: p.output }));
  },
  diff: async () => {
    const p = parseDiffArgs(args.slice(1));
    const dir = cwd(p);
    if (!dir) {
      return;
    }
    fail(
      await diff(p._, {
        cwd: dir,
        path: p.path,
        registry: p.registry,
      })
    );
  },
  doctor: async () => {
    const p = parseDoctorArgs(args.slice(1));
    const dir = cwd(p);
    if (!dir) {
      return;
    }
    fail(
      await doctor(__VERSION__, {
        cwd: dir,
        json: p.json,
        registry: p.registry,
      })
    );
  },
  info: async () => {
    const p = parseInfoArgs(args.slice(1));
    fail(
      await info({ component: p.component, json: p.json, registry: p.registry })
    );
  },
  init: async () => {
    const p = parseInitArgs(args.slice(1));
    const dir = cwd(p);
    if (!dir) {
      return;
    }
    fail(
      await init({ cwd: dir, defaults: p.defaults, force: p.force, yes: p.yes })
    );
  },
  list: async () => {
    const p = parseListArgs(args.slice(1));
    await list({ json: p.json, registry: p.registry });
  },
  mcp: async () => {
    const [, sub] = args;
    if (sub === "init") {
      const p = parseMcpArgs(args.slice(2));
      const dir = cwd(p);
      if (!dir) {
        return;
      }
      fail(await initMcpClient({ client: p.client, cwd: dir }));
      return;
    }
    await startMcpServer();
  },
  registry: () => {
    const [, sub] = args;
    if (sub === "build") {
      return COMMANDS.build(args.slice(2));
    }
    if (sub === "validate") {
      return COMMANDS.validate(args.slice(2));
    }
    error(`Unknown registry command: ${sub ?? ""}`);
    printHelp();
    process.exit(1);
  },
  search: async () => {
    const p = parseSearchArgs(args.slice(1));
    fail(
      await search({
        json: p.json,
        limit: p.limit,
        query: p.query,
        registry: p.registry,
        type: p.type,
      })
    );
  },
  validate: (argv = args.slice(1)) => {
    const p = parseValidateArgs(argv);
    const dir = cwd(p);
    if (!dir) {
      return;
    }
    fail(validate(p._[0], { cwd: dir, json: p.json }));
  },
};

type CommandHandler = (argv?: string[]) => void | Promise<void>;

const COMMAND_MAP: Record<string, CommandHandler | undefined> = {
  ...COMMANDS,
  find: COMMANDS.search,
  ls: COMMANDS.list,
  show: COMMANDS.info,
};

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

    const handler = Object.hasOwn(COMMAND_MAP, command)
      ? COMMAND_MAP[command]
      : undefined;
    if (!handler) {
      error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
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
      await handler();
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
