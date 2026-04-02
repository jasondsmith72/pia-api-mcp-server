# PIA MCP Server

MCP server for the PIA API - manages agents, automations, clients, and source control.

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
        "PIA_BASE_URL": "https://yourtenant.pia.ai/api"
      }
    }
  }
}
```

## Available Tools (27)

### Configure API
- `pia_list_agents` / `pia_get_agent` / `pia_activate_agent` / `pia_deactivate_agent` / `pia_uninstall_agent`
- `pia_list_clients` / `pia_get_client`

### Automate API - Discover
- `pia_list_smartforms` / `pia_smartforms_by_client` / `pia_smartforms_by_psa_company`
- `pia_list_techassist` / `pia_techassist_by_client` / `pia_techassist_by_psa_company`

### Automate API - Monitor
- `pia_execution_status` / `pia_event_status` / `pia_execution_logs` / `pia_event_logs` / `pia_running_executions`

### Automate API - Trigger
- `pia_trigger_automation` / `pia_trigger_for_client` / `pia_trigger_for_psa_company` / `pia_trigger_with_ticket`

### Build API
- `pia_list_repositories` / `pia_get_repository` / `pia_push_source` / `pia_pull_source` / `pia_store_repo_config`

### Escape Hatch
- `pia_raw_request`
