# Security Policy

At **SoraLabs**, we take the security of **Sora CLI (`@soralabs/cli`)**, our component registries, package resolution logic, and ecosystem tooling seriously. If you believe you have discovered a security vulnerability, we appreciate your help in disclosing it to us responsibly.

## Supported Versions

Only the latest published version of `@soralabs/cli` receives active security patches.

| Version | Supported |
| :--- | :--- |
| `>= 0.5.x` | :white_check_mark: |
| `< 0.5.0` | :x: |

## Scope & Security Architecture

Sora CLI interacts with remote network endpoints and local filesystem trees. Areas of particular security focus include:

- **Path Traversal Guards**: Preventing remote registry items from writing files outside the target project boundary (e.g., `resolveTarget`, `assertSafeDestination`).
- **Command & Argument Injection**: Ensuring dependencies and package manager invocations validate package names against malicious shell flags or injection vectors.
- **Registry URL Integrity**: Enforcing HTTPS endpoints for remote registries (disallowing unencrypted HTTP outside local development).
- **Model Context Protocol (MCP)**: Protecting local stdio execution and configuration routines for AI assistants.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue, pull request, or discussion for security vulnerabilities. Public disclosure can put developers and projects relying on Sora CLI at risk before a fix is available.

### How to Report

You can submit vulnerabilities through either of the following confidential channels:

1. **GitHub Security Advisories (Recommended):**  
   Submit a confidential report directly via [GitHub Security Advisories](https://github.com/SoraLabsOSS/cli/security/advisories/new).
2. **Email:**  
   Send details directly to [security@soralabs.studio](mailto:security@soralabs.studio).

### What to Include

To help us assess and resolve the issue quickly, please provide:

- A clear description of the vulnerability.
- The affected CLI version(s) and operating system environment.
- Step-by-step reproduction instructions or a minimal Proof of Concept (PoC).
- Potential impact and realistic exploitation scenarios (e.g. arbitrary file overwrite, unsafe dependency installation).
- Any proposed fixes or mitigations (optional).

## Response Process & Timeline

- **Acknowledgement:** The SoraLabs team will acknowledge receipt of your report within **48–72 hours**.
- **Assessment & Triage:** We will verify the vulnerability, evaluate its CVSS severity score, and keep you informed throughout the triage process.
- **Fix & Release:** If confirmed, we will develop, test, and release a patched version to npm as quickly as possible.
- **Coordinated Disclosure:** After the fix is deployed, we will publish a GitHub Security Advisory detailing the issue. We will credit you for responsible disclosure unless you choose to remain anonymous.
