# Agentia Org Graph

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-%3E%3D18-blue.svg)](package.json)
[![Agentia 0.122](https://img.shields.io/badge/agentia-0.122.0--alpha.1-blue.svg)](https://developer.copado.com/docs)

**Org Graph** maps the blast radius of one metadata member before you
deploy it. Upstream plus downstream dependencies as a diagram file or
JSON.

Impact visible before deploy. Built for the **Agentia Headless Virtual
Hackathon** as an oclif plugin on top of the public `agentia` CLI.

---

## Table of Contents

- [The Problem](#the-problem)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Live Demo Workflow](#live-demo-workflow)
- [Command Reference](#command-reference)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [How It Works](#how-it-works)
- [Security](#security)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Hackathon Fit](#hackathon-fit)
- [License](#license)

---

## The Problem

Developers deploy a class blind to what depends on it, then watch
downstream flows and triggers break. Dependency impact lives in heads
and tribal knowledge, never in tooling that runs before the deploy.

## Features

- **Verified dependency primitive** — lists through the real gateway
  command with credential, org and pipeline scope.
- **Upstream plus downstream split** — what the member needs versus
  what breaks if it changes.
- **Mermaid output** — flowchart file ready for decks, wikis and
  reviews, with the center node highlighted.
- **JSON output** — counts plus capped node lists for gates and agents.
- **Honest empty maps** — isolated or missing members report empty
  with the reason instead of a fake graph.
- **Zero private imports** — only shells out to public `agentia`
  commands.

## Installation

### Prerequisites

- Node 18 or newer.
- Agentia CLI beta: `npm install -g @copado/agentia-cli@beta`
- Authenticated machine plus credential, org and pipeline IDs.

### Install from source

```sh
git clone https://github.com/devkdas/agentia-org-graph.git
cd agentia-org-graph
npm install
npm run build
agentia plugins link .
```

Re-run `npm run build` after every change to the TypeScript files.

## Quick Start

### 1. Map a class

```sh
agentia graph blast --type ApexClass --name CopadoTrailHelper \
  --source-credential-id a11 --source-org-id 00D --pipeline-id a0W
```

### 2. Save the diagram plus JSON

```sh
agentia graph blast --type ApexClass --name CopadoTrailHelper \
  --source-credential-id a11 --source-org-id 00D --pipeline-id a0W \
  --format mermaid --output blast.mmd --json
```

## Live Demo Workflow

Verified live on a real class:

```text
1. agentia graph blast (AccountHelper, unknown member)
   -> empty with honest note, no fake graph
2. agentia graph blast (CopadoTrailHelper, real member)
   -> mapped: 0 upstream, 2 downstream
      (CustomObject copado__Org__c plus Attachment)
3. Mermaid file renders the center node highlighted with edges
```

## Command Reference

### `agentia graph blast`

| Flag | Description |
|---|---|
| `-t, --type <type>` | Metadata type, for example ApexClass (required) |
| `-n, --name <name>` | Metadata API name (required) |
| `--source-credential-id` | Org credential ID (required) |
| `--source-org-id` | Org ID (required) |
| `--pipeline-id` | Pipeline ID scoping the call (required) |
| `--format mermaid\|json` | Artifact format (default `mermaid`) |
| `-o, --output <path>` | File path for the artifact |
| `-j, --json` | Machine readable JSON summary |

## Configuration

Scope flags only. Node IDs sanitize to safe characters with capped
lists at 25 per side so diagrams stay readable.

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Empty map | Member missing or isolated | Verify the name via metadata list first |
| Missing flag errors | Three scope IDs required | Pass credential, org and pipeline together |
| ESM auto-transpile warning | Linked ESM plugin notice | Benign, compiled output is used |

## How It Works

```text
agentia graph blast
  -> metadata dependency list (scoped)
  -> upstream plus downstream split
  -> mermaid flowchart or JSON artifact
```

## Security

Read only by design. Nothing is written to orgs. Only artifact files
the user names are created locally.

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript on Node 18+ |
| CLI Framework | oclif v4 (ESM, matching the host CLI) |
| Runtime calls | `node:child_process` to public `agentia` commands |

## Architecture

```text
Developer / Reviewer
       |
agentia graph blast --type --name (scoped)
       |
Org Graph (this plugin)
  |- lookup  -> dependency list
  |- split   -> upstream vs downstream
  |- render  -> mermaid or JSON artifact
       |
Diagram file plus summary
```

## Hackathon Fit

Improves reliability plus developer experience by making impact visible
before deploy instead of after breakage, with an artifact reviewers can
read at a glance.

## License

MIT License — see [LICENSE](LICENSE) for details.
