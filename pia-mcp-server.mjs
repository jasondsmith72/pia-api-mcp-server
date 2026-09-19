#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as path from "node:path";
import {
  writeExportToFiles,
  readImportFromFiles,
  scanPackageRefs,
  listLocalPackages,
  listLocalActivities,
  listLocalForms,
  DEFAULT_AUTOMATIONS_FOLDER,
} from "./sourceSync.mjs";

const BASE_URL = process.env.PIA_BASE_URL;
const API_KEY = process.env.PIA_API_KEY;
const WORKSPACE_ROOT = process.env.PIA_WORKSPACE_ROOT || process.cwd();

if (!BASE_URL) {
  console.error("PIA_BASE_URL environment variable is required (e.g. https://yourtenant.pia.ai/api)");
  process.exit(1);
}
if (!API_KEY) {
  console.error("PIA_API_KEY environment variable is required");
  process.exit(1);
}

const headers = {
  Authorization: `api ${API_KEY}`,
  "Content-Type": "application/json",
  Accept: "application/json",
};

async function piaFetch(path, method = "GET", body = null, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  const opts = { method, headers };
  if (body && method !== "GET") opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  const text = await res.text();
  if (!res.ok) {
    return { error: true, status: res.status, statusText: res.statusText, body: text };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const server = new McpServer({
  name: "pia-api",
  version: "1.3.0",
});

// ============================================================
// CONFIGURE API - Agents
// ============================================================

server.tool("pia_list_agents", "List all PIA agents with optional pagination", {
  top: z.number().optional().describe("Max results to return"),
  skip: z.number().optional().describe("Results to skip"),
}, async ({ top, skip }) => {
  const data = await piaFetch("/config/agents", "GET", null, { $top: top, $skip: skip });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_get_agent", "Get detailed info for a specific PIA agent", {
  agentId: z.number().describe("Agent ID"),
}, async ({ agentId }) => {
  const data = await piaFetch(`/config/agents/${agentId}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_activate_agent", "Activate a PIA agent", {
  agentId: z.number().describe("Agent ID to activate"),
}, async ({ agentId }) => {
  const data = await piaFetch(`/config/agents/${agentId}/activate`, "PUT");
  return { content: [{ type: "text", text: JSON.stringify(data ?? { success: true }, null, 2) }] };
});

server.tool("pia_deactivate_agent", "Deactivate a PIA agent", {
  agentId: z.number().describe("Agent ID to deactivate"),
}, async ({ agentId }) => {
  const data = await piaFetch(`/config/agents/${agentId}/deactivate`, "PUT");
  return { content: [{ type: "text", text: JSON.stringify(data ?? { success: true }, null, 2) }] };
});

server.tool("pia_uninstall_agent", "Uninstall a PIA agent", {
  agentId: z.number().describe("Agent ID to uninstall"),
}, async ({ agentId }) => {
  const data = await piaFetch(`/config/agents/${agentId}/uninstall`, "PUT");
  return { content: [{ type: "text", text: JSON.stringify(data ?? { success: true }, null, 2) }] };
});

// ============================================================
// CONFIGURE API - Clients
// ============================================================

server.tool("pia_list_clients", "List all PIA clients with optional pagination", {
  top: z.number().optional().describe("Max results to return"),
  skip: z.number().optional().describe("Results to skip"),
}, async ({ top, skip }) => {
  const data = await piaFetch("/config/clients", "GET", null, { $top: top, $skip: skip });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_get_client", "Get detailed info for a specific PIA client", {
  clientId: z.number().describe("Client ID"),
}, async ({ clientId }) => {
  const data = await piaFetch(`/config/clients/${clientId}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// ============================================================
// AUTOMATE API - Discover
// ============================================================

server.tool("pia_list_smartforms", "List all PIA SmartForms", {
  filter: z.string().optional().describe("Filter expression"),
  automationName: z.string().optional().describe("Filter by automation name"),
  title: z.string().optional().describe("Filter by title"),
  description: z.string().optional().describe("Filter by description"),
  top: z.number().optional().describe("Max results"),
  skip: z.number().optional().describe("Results to skip"),
}, async ({ filter, automationName, title, description, top, skip }) => {
  const data = await piaFetch("/automate/discover/smartforms/all", "GET", null, {
    Filter: filter, AutomationName: automationName, Title: title, Description: description, $top: top, $skip: skip,
  });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_smartforms_by_client", "Get SmartForms for a specific PIA client", {
  clientId: z.number().describe("PIA Client ID"),
  top: z.number().optional(),
  skip: z.number().optional(),
}, async ({ clientId, top, skip }) => {
  const data = await piaFetch(`/automate/discover/smartforms/piaclient/${clientId}`, "GET", null, { $top: top, $skip: skip });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_smartforms_by_psa_company", "Get SmartForms for a PSA company", {
  companyId: z.number().describe("PSA Company ID"),
  top: z.number().optional(),
  skip: z.number().optional(),
}, async ({ companyId, top, skip }) => {
  const data = await piaFetch(`/automate/discover/smartforms/psacompany/${companyId}`, "GET", null, { $top: top, $skip: skip });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_list_techassist", "List all TechAssist automations", {
  sandboxId: z.string().optional().describe("Sandbox ID filter"),
  top: z.number().optional(),
  skip: z.number().optional(),
}, async ({ sandboxId, top, skip }) => {
  const data = await piaFetch("/automate/discover/techassist/all", "GET", null, { SandboxId: sandboxId, $top: top, $skip: skip });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_techassist_by_client", "Get TechAssist automations for a PIA client", {
  clientId: z.number().describe("PIA Client ID"),
  sandboxId: z.string().optional(),
  top: z.number().optional(),
  skip: z.number().optional(),
}, async ({ clientId, sandboxId, top, skip }) => {
  const data = await piaFetch(`/automate/discover/techassist/piaclient/${clientId}`, "GET", null, { SandboxId: sandboxId, $top: top, $skip: skip });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_techassist_by_psa_company", "Get TechAssist automations for a PSA company", {
  companyId: z.number().describe("PSA Company ID"),
  sandboxId: z.string().optional(),
  top: z.number().optional(),
  skip: z.number().optional(),
}, async ({ companyId, sandboxId, top, skip }) => {
  const data = await piaFetch(`/automate/discover/techassist/psacompany/${companyId}`, "GET", null, { SandboxId: sandboxId, $top: top, $skip: skip });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// ============================================================
// AUTOMATE API - Monitor
// ============================================================

server.tool("pia_execution_status", "Get execution status of a package instance", {
  packageInstanceId: z.number().describe("Package Instance ID"),
}, async ({ packageInstanceId }) => {
  const data = await piaFetch(`/automate/monitor/execution/${packageInstanceId}/status`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_event_status", "Get execution status by event correlation ID", {
  eventCorrelationId: z.string().describe("Event Correlation ID (GUID)"),
}, async ({ eventCorrelationId }) => {
  const data = await piaFetch(`/automate/monitor/event/${eventCorrelationId}/status`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_execution_logs", "Get activity logs for a package execution", {
  packageInstanceId: z.number().describe("Package Instance ID"),
}, async ({ packageInstanceId }) => {
  const data = await piaFetch(`/automate/monitor/execution/${packageInstanceId}/activitylogs`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_event_logs", "Get activity logs by event correlation ID", {
  eventCorrelationId: z.string().describe("Event Correlation ID (GUID)"),
}, async ({ eventCorrelationId }) => {
  const data = await piaFetch(`/automate/monitor/event/${eventCorrelationId}/activitylogs`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_running_executions", "List all currently running PIA automations", {}, async () => {
  const data = await piaFetch("/automate/monitor/execution/running");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// ============================================================
// AUTOMATE API - Trigger
// ============================================================

server.tool("pia_trigger_automation", "Trigger a PIA automation package", {
  packageId: z.string().describe("Package ID (GUID)"),
  sandboxId: z.string().optional().describe("Sandbox ID (optional)"),
  variableInputs: z.array(z.object({
    key: z.string(),
    value: z.string(),
  })).optional().describe("Variable inputs as key-value pairs"),
}, async ({ packageId, sandboxId, variableInputs }) => {
  const body = variableInputs ? { variableInputs } : {};
  const data = await piaFetch(`/automate/trigger/${packageId}`, "POST", body, { sandboxId });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_trigger_for_client", "Trigger automation with PIA client context", {
  packageId: z.string().describe("Package ID (GUID)"),
  clientId: z.number().describe("PIA Client ID"),
  sandboxId: z.string().optional(),
  variableInputs: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
}, async ({ packageId, clientId, sandboxId, variableInputs }) => {
  const body = variableInputs ? { variableInputs } : {};
  const data = await piaFetch(`/automate/trigger/${packageId}/piaclient/${clientId}`, "POST", body, { sandboxId });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_trigger_for_psa_company", "Trigger automation with PSA company context", {
  packageId: z.string().describe("Package ID (GUID)"),
  psaCompanyId: z.number().describe("PSA Company ID"),
  sandboxId: z.string().optional(),
  variableInputs: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
}, async ({ packageId, psaCompanyId, sandboxId, variableInputs }) => {
  const body = variableInputs ? { variableInputs } : {};
  const data = await piaFetch(`/automate/trigger/${packageId}/psacompany/${psaCompanyId}`, "POST", body, { sandboxId });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_trigger_with_ticket", "Trigger automation with ticket context", {
  packageId: z.string().describe("Package ID (GUID)"),
  ticketId: z.number().describe("Ticket ID"),
  sandboxId: z.string().optional(),
  variableInputs: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
}, async ({ packageId, ticketId, sandboxId, variableInputs }) => {
  const body = variableInputs ? { variableInputs } : {};
  const data = await piaFetch(`/automate/trigger/${packageId}/withTicket/${ticketId}`, "POST", body, { sandboxId });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// ============================================================
// BUILD API - Source Control
// ============================================================

server.tool("pia_list_repositories", "List all PIA source repositories", {
  top: z.number().optional(),
  skip: z.number().optional(),
}, async ({ top, skip }) => {
  const data = await piaFetch("/build/source/repositories", "GET", null, { $top: top, $skip: skip });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_get_repository", "Get a specific PIA source repository", {
  repositoryId: z.string().describe("Repository ID"),
}, async ({ repositoryId }) => {
  const data = await piaFetch(`/build/source/repositories/${repositoryId}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_push_source", "Push/import source to a PIA repository", {
  repositoryId: z.string().describe("Repository ID"),
  sourceData: z.string().describe("JSON string of SourceImportInputModel: {packages: [], activities: [], forms: [], globalVariables: [], branch?}"),
}, async ({ repositoryId, sourceData }) => {
  const body = JSON.parse(sourceData);
  const data = await piaFetch(`/build/source/push/${repositoryId}`, "POST", body);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_pull_source", "Pull/export source from a PIA repository", {
  repositoryId: z.string().describe("Repository ID"),
  exportFilter: z.string().describe("JSON string of SourceExportInputModel: {activityStaticNames: [], formStaticNames: [], packageInternalIds: []}"),
}, async ({ repositoryId, exportFilter }) => {
  const body = JSON.parse(exportFilter);
  const data = await piaFetch(`/build/source/pull/${repositoryId}`, "POST", body);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_store_repo_config", "Store configuration for a PIA repository", {
  repositoryId: z.string().describe("Repository ID"),
  configData: z.string().describe("JSON string of StoreRepositoryConfigModel"),
}, async ({ repositoryId, configData }) => {
  const body = JSON.parse(configData);
  const data = await piaFetch(`/build/source/repositories/${repositoryId}/config`, "POST", body);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// ============================================================
// BUILD API - File-tree sync (Pia.Automations layout)
// ============================================================
//
// These tools implement the same on-disk layout used by the Pia VS Code
// extension so you can pull source into a git-tracked directory, edit it
// as files, and push it back. Layout:
//   <root>/Pia.Automations/Activities/<staticName>/{activity.ps1, *.json}
//   <root>/Pia.Automations/Forms/<staticName>/{form_template.json, *.json}
//   <root>/Pia.Automations/Packages/<name>_<internalId>/{package.yaml, *.json}
// `workspaceRoot` defaults to $PIA_WORKSPACE_ROOT or the process cwd.

const workspaceSchema = z.string().optional().describe(
  "Absolute path to the workspace root (parent of Pia.Automations). Defaults to PIA_WORKSPACE_ROOT or cwd."
);
const automationsFolderSchema = z.string().optional().describe(
  `Name of the automations root folder (default "${DEFAULT_AUTOMATIONS_FOLDER}")`
);

function resolveRoot(workspaceRoot) {
  const root = workspaceRoot ?? WORKSPACE_ROOT;
  return path.isAbsolute(root) ? root : path.resolve(root);
}

server.tool("pia_pull_to_files", "Pull source from a PIA repository and write it to the local Pia.Automations file tree (activity.ps1 + *.json + package.yaml). Same layout as the Pia VS Code extension.", {
  repositoryId: z.string().describe("Repository ID (e.g. Sandbox_3)"),
  activityStaticNames: z.array(z.string()).optional().describe("Activity static names to include"),
  formStaticNames: z.array(z.string()).optional().describe("Form static names to include"),
  packageInternalIds: z.array(z.string()).optional().describe("Package internal IDs to include"),
  workspaceRoot: workspaceSchema,
  automationsFolder: automationsFolderSchema,
}, async ({ repositoryId, activityStaticNames, formStaticNames, packageInternalIds, workspaceRoot, automationsFolder }) => {
  const filter = {
    activityStaticNames: activityStaticNames ?? [],
    formStaticNames: formStaticNames ?? [],
    packageInternalIds: packageInternalIds ?? [],
  };
  const data = await piaFetch(`/build/source/pull/${repositoryId}`, "POST", filter);
  if (data?.error) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
  const root = resolveRoot(workspaceRoot);
  const result = await writeExportToFiles(data, root, { automationsFolder });
  return { content: [{ type: "text", text: JSON.stringify({ pulledFrom: repositoryId, ...result }, null, 2) }] };
});

server.tool("pia_push_from_files", "Read the local Pia.Automations file tree and push selected packages/activities/forms to a PIA repository. Set autoScanRefs=true (default) to auto-include activities/forms referenced by the chosen packages' YAML.", {
  repositoryId: z.string().describe("Repository ID (e.g. sandbox_123)"),
  packageInternalIds: z.array(z.string()).optional().describe("Package internal IDs to push"),
  activityStaticNames: z.array(z.string()).optional().describe("Extra activity static names to include (in addition to auto-scan)"),
  formStaticNames: z.array(z.string()).optional().describe("Extra form static names to include (in addition to auto-scan)"),
  autoScanRefs: z.boolean().optional().default(true).describe("Scan package YAML and auto-include referenced activities/forms"),
  branch: z.string().optional().describe("Optional branch name for the push"),
  workspaceRoot: workspaceSchema,
  automationsFolder: automationsFolderSchema,
}, async ({ repositoryId, packageInternalIds, activityStaticNames, formStaticNames, autoScanRefs, branch, workspaceRoot, automationsFolder }) => {
  const root = resolveRoot(workspaceRoot);
  const pkgIds = packageInternalIds ?? [];
  let activities = new Set(activityStaticNames ?? []);
  let forms = new Set(formStaticNames ?? []);

  if (autoScanRefs && pkgIds.length > 0) {
    const scan = await scanPackageRefs(root, pkgIds, { automationsFolder });
    for (const a of scan.activityStaticNames) activities.add(a);
    for (const f of scan.formStaticNames) forms.add(f);
  }

  const importPayload = await readImportFromFiles(root, {
    activityStaticNames: [...activities],
    formStaticNames: [...forms],
    packageInternalIds: pkgIds,
  }, { automationsFolder });

  if (branch) importPayload.branch = branch;

  const data = await piaFetch(`/build/source/push/${repositoryId}`, "POST", importPayload);
  const summary = {
    pushedTo: repositoryId,
    counts: {
      packages: importPayload.packages.length,
      activities: importPayload.activities.length,
      forms: importPayload.forms.length,
    },
    result: data,
  };
  return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
});

server.tool("pia_scan_package_refs", "Scan local package YAML to resolve referenced activity/form static names. Useful for previewing what pia_push_from_files will include.", {
  packageInternalIds: z.array(z.string()).describe("Package internal IDs to scan"),
  workspaceRoot: workspaceSchema,
  automationsFolder: automationsFolderSchema,
}, async ({ packageInternalIds, workspaceRoot, automationsFolder }) => {
  const root = resolveRoot(workspaceRoot);
  const result = await scanPackageRefs(root, packageInternalIds, { automationsFolder });
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

server.tool("pia_list_local_packages", "List packages present in the local Pia.Automations/Packages directory (name, internalId, folder, deleted flag).", {
  workspaceRoot: workspaceSchema,
  automationsFolder: automationsFolderSchema,
}, async ({ workspaceRoot, automationsFolder }) => {
  const root = resolveRoot(workspaceRoot);
  const data = await listLocalPackages(root, { automationsFolder });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_list_local_activities_forms", "List the activity and form staticName folders present locally.", {
  workspaceRoot: workspaceSchema,
  automationsFolder: automationsFolderSchema,
}, async ({ workspaceRoot, automationsFolder }) => {
  const root = resolveRoot(workspaceRoot);
  const [activities, forms] = await Promise.all([
    listLocalActivities(root, { automationsFolder }),
    listLocalForms(root, { automationsFolder }),
  ]);
  return { content: [{ type: "text", text: JSON.stringify({ activities, forms }, null, 2) }] };
});

// ============================================================
// EXTENSIONS (scopes: Extensions.Read / Extensions.Write)
// ============================================================
//
// Extension automations are packages that hook into "extension points" of a
// host automation (e.g. Staff Onboarding). Configuration is per client:
// client + host package + extension point -> ordered list of extension packages.

server.tool("pia_list_extensions", "List all published extension automations (packages that can be attached to another automation's extension point). Scope: Extensions.Read", {
  top: z.number().optional().describe("Max results"),
  skip: z.number().optional().describe("Results to skip"),
}, async ({ top, skip }) => {
  const data = await piaFetch("/automate/discover/extensions/all", "GET", null, { $top: top, $skip: skip });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_list_extendable_automations", "List automations that expose extension points, with each point's id, name and sample data schema. Scope: Extensions.Read", {
  top: z.number().optional().describe("Max results"),
  skip: z.number().optional().describe("Results to skip"),
}, async ({ top, skip }) => {
  const data = await piaFetch("/automate/discover/with-extension-points", "GET", null, { $top: top, $skip: skip });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_get_extension_points", "Get the available extension points (uniqueId, description, dataSchema) for a host package. Scope: Extensions.Read", {
  packageId: z.string().describe("Host package ID (GUID)"),
}, async ({ packageId }) => {
  const data = await piaFetch(`/config/extensions/${packageId}/extension-points`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_get_extension_config", "Get the extensions configured for a client on a host package. Omit extensionPointId to get every extension point on the package; supply it to get that point's extension list only. Scope: Extensions.Read", {
  clientId: z.number().describe("PIA Client ID"),
  packageId: z.string().describe("Host package ID (GUID)"),
  extensionPointId: z.string().optional().describe("Extension point ID (GUID). Optional."),
}, async ({ clientId, packageId, extensionPointId }) => {
  const path = extensionPointId
    ? `/config/extensions/${clientId}/${packageId}/${extensionPointId}`
    : `/config/extensions/${clientId}/${packageId}`;
  const data = await piaFetch(path);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_get_triage_extensions", "Get the extension configuration for ticket Triage (Before Dispatch / After Dispatch extension points). Scope: Extensions.Read", {}, async () => {
  const data = await piaFetch("/config/extensions/triage");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_add_extension", "Attach (or re-order) an extension package on a host package's extension point for a client. Scope: Extensions.Write", {
  clientId: z.number().describe("PIA Client ID"),
  packageId: z.string().describe("Host package ID (GUID)"),
  extensionPointId: z.string().describe("Extension point ID (GUID) — from pia_get_extension_points"),
  extensionPackageId: z.string().describe("Extension package ID (GUID) — from pia_list_extensions"),
  executeOrder: z.number().int().optional().default(1).describe("Execution order among extensions on this point (1 = first)"),
}, async ({ clientId, packageId, extensionPointId, extensionPackageId, executeOrder }) => {
  const data = await piaFetch(`/config/extensions/${clientId}/${packageId}/${extensionPointId}`, "POST", { extensionPackageId, executeOrder });
  return { content: [{ type: "text", text: JSON.stringify(data ?? { success: true }, null, 2) }] };
});

server.tool("pia_remove_extension", "Detach an extension package from a host package's extension point for a client. Scope: Extensions.Write", {
  clientId: z.number().describe("PIA Client ID"),
  packageId: z.string().describe("Host package ID (GUID)"),
  extensionPointId: z.string().describe("Extension point ID (GUID)"),
  extensionPackageId: z.string().describe("Extension package ID (GUID) to remove"),
}, async ({ clientId, packageId, extensionPointId, extensionPackageId }) => {
  const data = await piaFetch(`/config/extensions/${clientId}/${packageId}/${extensionPointId}/${extensionPackageId}`, "DELETE");
  return { content: [{ type: "text", text: JSON.stringify(data ?? { success: true }, null, 2) }] };
});

// ============================================================
// INTEGRATIONS (scope: Integrations.Read or PiaSource.ReadWrite)
// ============================================================
//
// Read-only. The Integrations.Write scope exists but the current API spec
// exposes no write endpoints for it yet; use pia_raw_request when they appear.

server.tool("pia_list_integrations", "List configured integrations (name, category, type, auth definition and field list). Scope: Integrations.Read", {
  top: z.number().optional().describe("Max results"),
  skip: z.number().optional().describe("Results to skip"),
}, async ({ top, skip }) => {
  const data = await piaFetch("/config/integrations", "GET", null, { $top: top, $skip: skip });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_get_integration", "Get one integration's detail including its definition (prefix, authType, fields, retry/proxy flags). Scope: Integrations.Read", {
  integrationId: z.number().describe("Integration ID"),
}, async ({ integrationId }) => {
  const data = await piaFetch(`/config/integrations/${integrationId}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_integration_configurations", "List the configuration profiles for an integration (id, name, isDefault, postfix). Scope: Integrations.Read", {
  integrationId: z.number().describe("Integration ID"),
  top: z.number().optional(),
  skip: z.number().optional(),
}, async ({ integrationId, top, skip }) => {
  const data = await piaFetch(`/config/integrations/${integrationId}/configurations`, "GET", null, { $top: top, $skip: skip });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("pia_integration_client_configurations", "List per-client configurations for an integration (clientId, prefix/postfix, serviceValues). Secret values are not returned. Scope: Integrations.Read", {
  integrationId: z.number().describe("Integration ID"),
  top: z.number().optional(),
  skip: z.number().optional(),
}, async ({ integrationId, top, skip }) => {
  const data = await piaFetch(`/config/integrations/${integrationId}/clientconfigurations`, "GET", null, { $top: top, $skip: skip });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// ============================================================
// Generic / Escape Hatch
// ============================================================

server.tool("pia_raw_request", "Make a raw PIA API request (for endpoints not covered by other tools)", {
  path: z.string().describe("API path starting with / (e.g. /config/agents)"),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
  body: z.string().optional().describe("JSON request body string"),
  queryParams: z.string().optional().describe("JSON object of query parameters"),
}, async ({ path, method, body, queryParams }) => {
  const params = queryParams ? JSON.parse(queryParams) : {};
  const bodyObj = body ? JSON.parse(body) : null;
  const data = await piaFetch(path, method, bodyObj, params);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
