# PIA MCP Server

MCP server for the PIA API — manages agents, automations, clients, source control, and bidirectional file-tree sync of PIA source (same layout as the Pia VS Code extension).

## Setup

```bash
npm install
```

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "pia-api": {
      "command": "node",
      "args": ["pia-mcp-server.mjs"],
      "env": {
        "PIA_API_KEY": "YOUR_PIA_API_KEY_HERE",
        "PIA_BASE_URL": "https://yourtenant.pia.ai/api",
        "PIA_WORKSPACE_ROOT": "C:/path/to/your/pia-source-repo"
      }
    }
  }
}
```

`PIA_WORKSPACE_ROOT` is the parent directory of `Pia.Automations/` — defaults to the process cwd. Every file-sync tool also accepts a `workspaceRoot` argument to override per call.

## Available Tools

### Configure API
- `pia_list_agents` / `pia_get_agent` / `pia_activate_agent` / `pia_deactivate_agent` / `pia_uninstall_agent`
- `pia_list_clients` / `pia_get_client`

### Automate API — Discover
- `pia_list_smartforms` / `pia_smartforms_by_client` / `pia_smartforms_by_psa_company`
- `pia_list_techassist` / `pia_techassist_by_client` / `pia_techassist_by_psa_company`

### Automate API — Monitor
- `pia_execution_status` / `pia_event_status` / `pia_execution_logs` / `pia_event_logs` / `pia_running_executions`

### Automate API — Trigger
- `pia_trigger_automation` / `pia_trigger_for_client` / `pia_trigger_for_psa_company` / `pia_trigger_with_ticket`

### Build API — Raw
- `pia_list_repositories` / `pia_get_repository`
- `pia_push_source` / `pia_pull_source` — raw JSON passthrough
- `pia_store_repo_config`

### Build API — File-tree sync (new in 1.1.0)
- `pia_pull_to_files` — pull source and write the `Pia.Automations/` file tree
- `pia_push_from_files` — read the file tree and push to PIA; auto-scans package YAML for referenced activities/forms
- `pia_scan_package_refs` — preview which activities/forms a set of packages reference
- `pia_list_local_packages` — enumerate local package folders (name, internalId, deleted flag)
- `pia_list_local_activities_forms` — list local activity/form staticName folders

### Escape Hatch
- `pia_raw_request`

## File layout

File-sync tools use the same on-disk layout as the [Pia VS Code extension](https://marketplace.visualstudio.com/) so the two can share a repo:

```
<workspaceRoot>/
  Pia.Automations/
    Activities/
      <staticName>/
        activity.ps1
        activity_props.json
        activity_variables.json
    Forms/
      <staticName>/
        form_template.json
        form_props.json
        form_defaults.json
    Packages/
      <name>_<internalId>/
        package.yaml
        package_props.json
        package_variables.json
```

Form JSON is serialized with stable key sorting so pulls produce diff-friendly output.

## Typical workflow

```
# 1. See what's on the sandbox
pia_list_repositories

# 2. Pull everything (or a filtered subset) to disk
pia_pull_to_files { repositoryId: "sandbox_123" }

# 3. Edit files with your editor / commit to git / let Claude modify them

# 4. See what a push will include
pia_scan_package_refs { packageInternalIds: ["<guid>"] }

# 5. Push back (auto-scans referenced activities/forms by default)
pia_push_from_files { repositoryId: "sandbox_123", packageInternalIds: ["<guid>"] }
```
