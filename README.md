# PIA MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude (or any MCP client) full access to the [PIA](https://pia.ai) REST API — agents, clients, SmartForms, TechAssist, execution monitoring, automation triggers, and source control — plus bidirectional **file-tree sync** that mirrors the layout used by the Pia VS Code extension so you can edit PIA automations as code.

**33 tools total** across 7 categories. Works on any computer with Node ≥ 18.

---

## Table of contents

- [What this is for](#what-this-is-for)
- [Installation](#installation)
- [Configuration](#configuration)
- [File layout](#file-layout)
- [Typical workflows](#typical-workflows)
- [Tool reference](#tool-reference)
  - [Configure — Agents](#configure--agents)
  - [Configure — Clients](#configure--clients)
  - [Automate — Discover](#automate--discover)
  - [Automate — Monitor](#automate--monitor)
  - [Automate — Trigger](#automate--trigger)
  - [Build — Source control (raw)](#build--source-control-raw)
  - [Build — File-tree sync](#build--file-tree-sync)
  - [Escape hatch](#escape-hatch)
- [Compatibility with the Pia VS Code extension](#compatibility-with-the-pia-vs-code-extension)
- [Troubleshooting](#troubleshooting)
- [Changelog](#changelog)

---

## What this is for

If you are a PIA customer and you want an AI coding agent to:

- **Read** the state of your tenant (which agents are installed, what SmartForms exist, what's currently executing, what the logs say)
- **Trigger** automations programmatically (with or without a PSA ticket, client, or PSA company context)
- **Edit** your automation packages like source code — pull source into a git repo, have the agent modify `package.yaml` / `activity.ps1` / form templates, push it back
- **Activate / deactivate / uninstall** agents
- **Monitor** running automations and drill into activity-level logs

…this MCP wires all of that into any tool that speaks MCP (Claude Code, Claude Desktop, Cursor, etc.). The file-tree sync in particular produces a working directory that's **byte-for-byte identical** to what the official Pia VS Code extension writes, so the two tools share a repo cleanly.

---

## Installation

```bash
git clone https://github.com/jasondsmith72/pia-api-mcp-server.git
cd pia-api-mcp-server
npm install
```

Then point your MCP client at `pia-mcp-server.mjs`. Examples below.

### Claude Code — project-scoped (`.mcp.json` in the project root)

```json
{
  "mcpServers": {
    "pia-api": {
      "command": "node",
      "args": ["C:\\path\\to\\pia-api-mcp-server\\pia-mcp-server.mjs"],
      "env": {
        "PIA_API_KEY": "YOUR_PIA_API_KEY_HERE",
        "PIA_BASE_URL": "https://yourtenant.pia.ai/api"
      }
    }
  }
}
```

### Claude Code — user-scoped (works in every project)

Put the same block in `~/.claude/mcp.json` (or equivalent on Windows: `%USERPROFILE%\.claude\mcp.json`). The MCP will spawn with whatever project you have Claude Code open in as its working directory, which is exactly what the file-sync tools want.

### Claude Desktop

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "pia-api": {
      "command": "node",
      "args": ["/absolute/path/to/pia-mcp-server.mjs"],
      "env": {
        "PIA_API_KEY": "...",
        "PIA_BASE_URL": "https://yourtenant.pia.ai/api"
      }
    }
  }
}
```

Claude Desktop spawns MCPs with its own cwd, so for Desktop you probably *do* want to set `PIA_WORKSPACE_ROOT` explicitly (see below).

---

## Configuration

All config is via environment variables.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PIA_API_KEY` | **Yes** | — | Your PIA API key. Needs the `PiaSource.ReadWrite` scope for source-control tools; `Automate.*` scopes for trigger/monitor tools. |
| `PIA_BASE_URL` | **Yes** | — | Your PIA tenant's API root, e.g. `https://yourtenant.pia.ai/api`. The server fails fast if this is unset. |
| `PIA_WORKSPACE_ROOT` | No | `process.cwd()` | Where the `Pia.Automations/` folder lives (or will be created). Leave unset in Claude Code — it inherits your current project dir automatically. Set it explicitly for clients like Claude Desktop that don't launch from a project directory. |

Every file-sync tool also takes a `workspaceRoot` arg per-call, which overrides the env var.

---

## File layout

The file-sync tools use this exact on-disk layout — the same one the [Pia VS Code extension](https://marketplace.visualstudio.com/) uses:

```
<workspaceRoot>/
└── Pia.Automations/
    ├── Activities/
    │   └── <staticName>/
    │       ├── activity.ps1          # PowerShell source
    │       ├── activity_props.json   # staticName, name, description, imageBlob, tags
    │       └── activity_variables.json
    ├── Forms/
    │   └── <staticName>/
    │       ├── form_template.json    # form definition (stable-key-sorted)
    │       ├── form_props.json       # staticName, displayName, displayGoButton, isReadOnly, tags
    │       └── form_defaults.json    # default form data (stable-key-sorted)
    └── Packages/
        └── <name>_<internalId>/
            ├── package.yaml          # package definition
            ├── package_props.json    # internalId, name, description, definitionVersion, tags, [deleted]
            └── package_variables.json
```

Both JSON and YAML are written with deterministic ordering so diffs stay clean across pulls.

---

## Typical workflows

### 1. Pull a package into a git repo, let the agent edit it, push it back

```
# List what's available on a sandbox
pia_list_repositories
pia_get_repository { repositoryId: "Sandbox_3" }

# Pull one package plus its referenced activities/forms
pia_pull_to_files {
  repositoryId: "Sandbox_3",
  packageInternalIds: ["10101a99-b062-47de-8b05-d10d966de428"],
  activityStaticNames: ["docusign_api_test"],
  formStaticNames: ["cw_select_template"]
}

# Agent now edits package.yaml / activity.ps1 / form_template.json …
# (commit to git between edits if you want history)

# Preview what the push will include (auto-scans YAML refs)
pia_scan_package_refs { packageInternalIds: ["10101a99-b062-47de-8b05-d10d966de428"] }

# Push back — autoScanRefs defaults to true, so linked activities/forms
# are included automatically.
pia_push_from_files {
  repositoryId: "Sandbox_3",
  packageInternalIds: ["10101a99-b062-47de-8b05-d10d966de428"]
}
```

### 2. Trigger an automation and watch it run

```
pia_list_techassist                                   # find packageId
pia_trigger_with_ticket {
  packageId: "<guid>",
  ticketId: 12345
}
# → returns { packageInstanceId, eventCorrelationId, ... }

pia_execution_status { packageInstanceId: 9876 }
pia_execution_logs   { packageInstanceId: 9876 }
```

### 3. Audit installed agents

```
pia_list_agents
pia_get_agent        { agentId: 42 }
pia_deactivate_agent { agentId: 42 }    # e.g. during an incident
```

---

## Tool reference

All tools return JSON text. Pagination params (`top`, `skip`) map to the OData `$top`/`$skip` query string on the underlying REST endpoint.

### Configure — Agents

| Tool | Args | Description |
|---|---|---|
| `pia_list_agents` | `top?`, `skip?` | List all agents with optional pagination. |
| `pia_get_agent` | `agentId` | Get detailed info for one agent. |
| `pia_activate_agent` | `agentId` | Activate an agent. |
| `pia_deactivate_agent` | `agentId` | Deactivate an agent. |
| `pia_uninstall_agent` | `agentId` | Uninstall an agent. |

### Configure — Clients

| Tool | Args | Description |
|---|---|---|
| `pia_list_clients` | `top?`, `skip?` | List all PIA clients. |
| `pia_get_client` | `clientId` | Get one client's detail. |

### Automate — Discover

| Tool | Args | Description |
|---|---|---|
| `pia_list_smartforms` | `filter?`, `automationName?`, `title?`, `description?`, `top?`, `skip?` | List all SmartForms with optional filters. |
| `pia_smartforms_by_client` | `clientId`, `top?`, `skip?` | SmartForms scoped to a PIA client. |
| `pia_smartforms_by_psa_company` | `companyId`, `top?`, `skip?` | SmartForms scoped to a PSA company. |
| `pia_list_techassist` | `sandboxId?`, `top?`, `skip?` | All TechAssist automations (optionally filter by sandbox). |
| `pia_techassist_by_client` | `clientId`, `sandboxId?`, `top?`, `skip?` | TechAssist for a PIA client. |
| `pia_techassist_by_psa_company` | `companyId`, `sandboxId?`, `top?`, `skip?` | TechAssist for a PSA company. |

### Automate — Monitor

| Tool | Args | Description |
|---|---|---|
| `pia_execution_status` | `packageInstanceId` | Current status of an execution. |
| `pia_event_status` | `eventCorrelationId` (GUID) | Status by event correlation ID. |
| `pia_execution_logs` | `packageInstanceId` | Full activity logs for an execution. |
| `pia_event_logs` | `eventCorrelationId` (GUID) | Logs by event correlation ID. |
| `pia_running_executions` | — | List every automation currently running. |

### Automate — Trigger

All `pia_trigger_*` tools accept an optional `variableInputs` array of `{key, value}` pairs for passing variables into the automation.

| Tool | Args | Description |
|---|---|---|
| `pia_trigger_automation` | `packageId`, `sandboxId?`, `variableInputs?` | Fire a package with no context. |
| `pia_trigger_for_client` | `packageId`, `clientId`, `sandboxId?`, `variableInputs?` | Fire with a PIA client context. |
| `pia_trigger_for_psa_company` | `packageId`, `psaCompanyId`, `sandboxId?`, `variableInputs?` | Fire with a PSA company context. |
| `pia_trigger_with_ticket` | `packageId`, `ticketId`, `sandboxId?`, `variableInputs?` | Fire with a PSA ticket context (recommended for TechAssist). |

### Build — Source control (raw)

Low-level passthroughs. Prefer the file-tree sync tools below unless you need to skip the filesystem.

| Tool | Args | Description |
|---|---|---|
| `pia_list_repositories` | `top?`, `skip?` | All source repositories (sandboxes). |
| `pia_get_repository` | `repositoryId` (e.g. `Sandbox_3`) | Repo detail including linked packages/activities/forms. |
| `pia_pull_source` | `repositoryId`, `exportFilter` (JSON string) | Raw pull. `exportFilter` shape: `{"activityStaticNames":[],"formStaticNames":[],"packageInternalIds":[]}`. Returns the full export payload as JSON. |
| `pia_push_source` | `repositoryId`, `sourceData` (JSON string) | Raw push. `sourceData` shape: `{"packages":[],"activities":[],"forms":[],"globalVariables":[],"branch"?:"..."}`. |
| `pia_store_repo_config` | `repositoryId`, `configData` (JSON string) | Store a `StoreRepositoryConfigModel`. |

### Build — File-tree sync

The recommended way to work with source. Every tool accepts `workspaceRoot?` and `automationsFolder?` (default `"Pia.Automations"`) to override the defaults.

#### `pia_pull_to_files`

Pull source from a PIA repository and materialize it as files on disk using the layout above.

| Arg | Type | Required | Notes |
|---|---|---|---|
| `repositoryId` | string | yes | e.g. `"Sandbox_3"` |
| `activityStaticNames` | string[] | no | Which activities to pull |
| `formStaticNames` | string[] | no | Which forms to pull |
| `packageInternalIds` | string[] | no | Which packages to pull |
| `workspaceRoot` | string | no | Overrides `PIA_WORKSPACE_ROOT` / cwd |
| `automationsFolder` | string | no | Defaults to `Pia.Automations` |

Returns a summary of what got written.

#### `pia_push_from_files`

Read the local file tree and push selected packages/activities/forms to a PIA repository.

| Arg | Type | Required | Notes |
|---|---|---|---|
| `repositoryId` | string | yes | Target repo |
| `packageInternalIds` | string[] | no | Packages to push |
| `activityStaticNames` | string[] | no | Extra activities to include beyond auto-scan |
| `formStaticNames` | string[] | no | Extra forms to include beyond auto-scan |
| `autoScanRefs` | boolean | no | Default `true`. Scans each selected package's `package.yaml` for referenced `task:` activities and `form_name:` forms, and auto-includes any that exist locally. |
| `branch` | string | no | Target branch name |
| `workspaceRoot` | string | no | Overrides env / cwd |
| `automationsFolder` | string | no | Defaults to `Pia.Automations` |

Returns `{ pushedTo, counts: { packages, activities, forms }, result }`.

#### `pia_scan_package_refs`

Preview which activities/forms a push will include — same scan `pia_push_from_files` runs internally when `autoScanRefs=true`. Use this to inspect before pushing.

| Arg | Type | Required |
|---|---|---|
| `packageInternalIds` | string[] | yes |
| `workspaceRoot` | string | no |
| `automationsFolder` | string | no |

Returns `{ activityStaticNames, formStaticNames, packageInternalIds, missingPackageFolders }`.

#### `pia_list_local_packages`

Enumerate every package folder under `Pia.Automations/Packages/`. Useful for agents that need to pick something to push.

Returns `[{ folder, name, internalId, description, deleted }, ...]` sorted by name.

#### `pia_list_local_activities_forms`

Returns `{ activities: string[], forms: string[] }` — the staticName folders present locally.

### Escape hatch

#### `pia_raw_request`

Hit any PIA REST endpoint that isn't covered above.

| Arg | Type | Required | Notes |
|---|---|---|---|
| `path` | string | yes | e.g. `/config/agents` |
| `method` | enum | no | `GET` \| `POST` \| `PUT` \| `DELETE` \| `PATCH`, default `GET` |
| `body` | string | no | JSON-encoded request body |
| `queryParams` | string | no | JSON-encoded object of query params |

---

## Compatibility with the Pia VS Code extension

The file layout, filenames, and content shape produced by `pia_pull_to_files` match the [Pia VS Code extension](https://pia.ai) byte-for-byte (after line-ending normalization). That means:

- You can pull with the MCP and push with the extension (or vice versa)
- You can check in the `Pia.Automations/` folder to git and the two tools produce consistent diffs
- The `autoScanRefs` logic is a port of the extension's `scanFormsAndActivities` — same references resolve the same way

This is tested against a live PIA tenant on every release.

---

## Troubleshooting

**`PIA_API_KEY environment variable is required`** — set `PIA_API_KEY` in your MCP client config's `env` block.

**`PIA_BASE_URL environment variable is required`** — set `PIA_BASE_URL` in your MCP client config's `env` block, e.g. `https://yourtenant.pia.ai/api`.

**Pull returns empty `{ packages: [], activities: [], forms: [] }`** — you're almost certainly using the wrong field names in `exportFilter`. The API wants `activityStaticNames`, `formStaticNames`, `packageInternalIds` — *not* `activityNames`/`formNames`/`packageIds`. The file-sync tools handle this for you; only the raw `pia_pull_source` is a gotcha.

**`Could not authenticate`** — API key is bad or missing the `PiaSource.ReadWrite` scope. Check scopes under *Admin → API Keys* in your PIA tenant.

**`Package folder for internalId <guid> not found`** — `pia_push_from_files` couldn't find a folder under `Pia.Automations/Packages/` ending in `_<internalId>`. Pull the package first, or use `pia_list_local_packages` to verify what's on disk.

**File-sync tools write to the wrong directory** — check your MCP client's working directory. In Claude Code this is the project dir; in Claude Desktop it may be the Claude binary's directory. Set `PIA_WORKSPACE_ROOT` explicitly if in doubt, or pass `workspaceRoot` per call.

**`expected number, received string` from pagination args** — pass `top`/`skip` as numbers, not strings. Some MCP clients stringify numeric args; if yours does, that's a client bug, not an MCP bug.

---

## Changelog

### 1.2.0

- **Breaking**: `PIA_BASE_URL` is now required; the server fails fast if it's not set. Previously fell back to a hardcoded default. Set `PIA_BASE_URL=https://yourtenant.pia.ai/api` in your MCP client config.

### 1.1.0

- **New**: `pia_pull_to_files` / `pia_push_from_files` / `pia_scan_package_refs` / `pia_list_local_packages` / `pia_list_local_activities_forms` — bidirectional file-tree sync matching the Pia VS Code extension layout.
- **Fixed**: wrong field-name documentation on `pia_pull_source` and `pia_push_source` (were documented as `activityNames`/`formNames`/`packageIds`, actually `activityStaticNames`/`formStaticNames`/`packageInternalIds`).
- **Added**: `PIA_WORKSPACE_ROOT` env var, falling back to `process.cwd()`.
- **Verified**: output byte-for-byte identical to the VS Code extension's file writes.

### 1.0.0

- Initial release. 28 tools covering agents, clients, SmartForms, TechAssist, execution monitoring, triggers, and raw source push/pull.

---

## License

MIT
