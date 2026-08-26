# Contributing to sora-cli

Thank you for helping improve `@soralabsoss/sora-cli`, the CLI that installs [Sora UI](https://ui.soralabs.studio) (and, over time, other Sora Labs product) components into a user's project.

## Before you start

- Search existing issues and pull requests before starting duplicate work.
- For a large feature or behavior change (new command, new flag, new registry source), open an issue first and describe the problem and proposed approach.
- Keep pull requests focused. Avoid unrelated refactors or formatting changes.
- Never commit `dist/`, `.env` files, credentials, or other generated/local artifacts.

## Repository structure

sora-cli is a single-package CLI built with Bun and bundled with tsup.

```text
src/
├── index.ts            CLI entry point, command routing, help/version
├── constants.ts        Registry base URLs for each Sora Labs product
├── types.ts            Shared types
├── commands/           Command implementations
│   ├── add.ts          `add` command - install components
│   ├── list.ts         `list` command - list available components
│   ├── diff.ts         `diff` command - compare installed vs registry
│   └── doctor.ts       `doctor` command - project diagnostics
├── prompts/            Interactive prompts (component picker, etc.)
└── utils/              Shared utilities
    ├── args.ts         Type-safe argument parsing with @bomb.sh/args
    ├── registry.ts     Registry fetching and validation
    ├── tree.ts         Dependency tree resolution
    ├── install.ts      File writing and dependency installation
    ├── detect.ts       Project config detection (package manager, aliases)
    ├── diff.ts         File-level diff engine
    ├── colors.ts       Output formatting (stdout/stderr routing)
    ├── spinner.ts      Clack spinner wrapper
    └── update-check.ts Non-blocking npm version check
```

The CLI works by fetching a shadcn-compatible registry (`<product-url>/r/registry.json`, `<product-url>/r/<name>.json`), resolving the dependency tree, writing files into the user's project, and installing dependencies with their detected package manager (bun/pnpm/yarn/npm).

Adding a new Sora Labs product as a source should only require adding an entry to [`src/constants.ts`](src/constants.ts) — avoid introducing product-specific branches elsewhere in the code.

## Prerequisites

- [Git](https://git-scm.com/)
- [Bun](https://bun.sh/) 1.3.5 or a compatible version
- Node.js 18 or later (the published CLI targets `node >=18`)

## Set up the project

1. Fork the repository and clone your fork:

   ```bash
    git clone https://github.com/<YOUR_USERNAME>/cli.git
    cd cli
   ```

2. Create a branch from the latest default branch:

   ```bash
   git checkout -b fix/short-description
   ```

3. Install dependencies:

   ```bash
   bun install
   ```

4. Build and run the CLI locally:

   ```bash
   bun run build      # bundles src/index.ts -> dist/index.js via tsup
   node dist/index.js list
   node dist/index.js add text-effect
   ```

   Use `bun run dev` to rebuild on file changes while iterating.

## Development guidelines

- Keep command logic in `src/commands/`, prompt/UI logic in `src/prompts/`, and reusable helpers (registry fetching, dependency resolution, file writing, package-manager detection) in `src/utils/`. Avoid duplicating logic across commands.
- Preserve existing CLI flags and behavior (`--path`, `--force`, `--registry`) unless a change is explicitly agreed on in an issue, since these are part of the public interface documented in the [README](README.md).
- When adding or changing a flag, update the `Usage`/`Options` section of the README to match.
- Argument parsing uses `@bomb.sh/args` for type safety. When adding a new command, create a typed parse function in `src/utils/args.ts` with the appropriate config (boolean, string, alias, default).
- Test against a real target project directory when changing file-writing or dependency-resolution logic — a stale `dist/` bundle can hide real behavior, so rebuild before testing.
- Keep output messages (spinners, prompts, errors) consistent with the existing `@clack/prompts` / `picocolors` style already used in the codebase.

## Quality checks

Run these before opening a pull request:

```bash
bun run typecheck    # TypeScript type checking
bun test             # run test suite (247 tests)
bun run build        # bundle for distribution
bun x ultracite fix  # auto-fix lint issues
```

The test suite covers argument parsing, registry fetching, dependency resolution, file writing, and command behavior. Tests use `bun:test` and mock external dependencies (fetch, child_process).

## Submitting a pull request

1. Rebase or update your branch from the current default branch.
2. Check the diff for secrets, generated output (`dist/`), and unrelated changes.
3. Commit with a short, descriptive, imperative message.
4. Push the branch to your fork and open a pull request.

In the pull request, include:

- What changed and why.
- The issue it resolves, when applicable.
- How the change was tested (e.g. commands run, target project used).
- Terminal output or a short recording for changes to CLI output or interactive prompts.

Maintainers may request changes to keep the CLI's behavior, flags, and registry-resolution logic consistent and backward compatible.

Thank you for contributing to sora-cli!
