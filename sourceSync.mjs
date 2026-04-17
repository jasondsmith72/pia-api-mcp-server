// Bidirectional source ↔ filesystem sync for PIA repositories.
// Ported from the Pia VS Code extension's VSCodeFileSyncService so the MCP
// server can pull/push source in the same on-disk layout that Pia Source uses.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import sanitize from "sanitize-filename";
import stringify from "json-stable-stringify";
import { parseDocument } from "yaml";

export const DEFAULT_AUTOMATIONS_FOLDER = "Pia.Automations";
export const DEFAULT_ACTIVITIES_FOLDER = "Activities";
export const DEFAULT_FORMS_FOLDER = "Forms";
export const DEFAULT_PACKAGES_FOLDER = "Packages";

const FILES = {
  packageYaml: "package.yaml",
  packageProps: "package_props.json",
  packageVariables: "package_variables.json",
  activitySource: "activity.ps1",
  activityProps: "activity_props.json",
  activityVariables: "activity_variables.json",
  formTemplate: "form_template.json",
  formProps: "form_props.json",
  formDefaults: "form_defaults.json",
};

function safe(name) {
  return sanitize(String(name ?? ""), { replacement: "_" });
}

function packageFolderName(name, internalId) {
  return safe(`${name}_${internalId}`);
}

function layout(root, opts = {}) {
  const automations = opts.automationsFolder ?? DEFAULT_AUTOMATIONS_FOLDER;
  const activities = opts.activitiesFolder ?? DEFAULT_ACTIVITIES_FOLDER;
  const forms = opts.formsFolder ?? DEFAULT_FORMS_FOLDER;
  const packages = opts.packagesFolder ?? DEFAULT_PACKAGES_FOLDER;
  const base = path.join(root, automations);
  return {
    base,
    activitiesDir: path.join(base, activities),
    formsDir: path.join(base, forms),
    packagesDir: path.join(base, packages),
  };
}

async function writeJsonStable(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function writeJsonSortedFromString(filePath, jsonString) {
  // Form template/defaults arrive as JSON-encoded strings; we re-serialize
  // with json-stable-stringify so diffs stay stable across pulls.
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const parsed = jsonString && jsonString.trim() !== "" ? JSON.parse(jsonString) : {};
  await fs.writeFile(filePath, stringify(parsed, { space: 2 }), "utf8");
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text ?? "", "utf8");
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function readJson(filePath) {
  const text = await readText(filePath);
  return text.trim() === "" ? null : JSON.parse(text);
}

async function listDirs(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Write (pull): export payload -> filesystem
// ---------------------------------------------------------------------------

export async function writeExportToFiles(exportModel, root, opts = {}) {
  const L = layout(root, opts);
  const written = { activities: [], forms: [], packages: [] };

  for (const activity of exportModel.activities ?? []) {
    const dir = path.join(L.activitiesDir, safe(activity.staticName));
    await writeText(path.join(dir, FILES.activitySource), activity.powerShellCode ?? "");
    await writeJsonStable(path.join(dir, FILES.activityProps), {
      staticName: activity.staticName,
      name: activity.name,
      description: activity.description,
      imageBlob: activity.imageBlob,
      tags: activity.tags ?? [],
    });
    await writeJsonStable(path.join(dir, FILES.activityVariables), activity.activityVariables ?? []);
    written.activities.push(activity.staticName);
  }

  for (const form of exportModel.forms ?? []) {
    const dir = path.join(L.formsDir, safe(form.staticName));
    await writeJsonSortedFromString(path.join(dir, FILES.formTemplate), form.formJson);
    await writeJsonStable(path.join(dir, FILES.formProps), {
      staticName: form.staticName,
      displayName: form.name,
      displayGoButton: form.displayGoButton,
      isReadOnly: form.isReadOnly,
      tags: form.tags ?? [],
    });
    await writeJsonSortedFromString(path.join(dir, FILES.formDefaults), form.formData);
    written.forms.push(form.staticName);
  }

  for (const pkg of exportModel.packages ?? []) {
    const dir = path.join(L.packagesDir, packageFolderName(pkg.name, pkg.internalId));

    // Preserve the local `deleted` flag if one already exists, matching the
    // extension's behavior — the API never returns it, so we inherit it.
    let existingDeleted;
    try {
      const existingProps = await readJson(path.join(dir, FILES.packageProps));
      if (existingProps && typeof existingProps.deleted === "boolean") {
        existingDeleted = existingProps.deleted;
      }
    } catch { /* no existing file */ }

    const props = {
      internalId: pkg.internalId,
      name: pkg.name,
      description: pkg.description,
      definitionVersion: 1,
      tags: pkg.tags ?? [],
    };
    if (typeof existingDeleted === "boolean") props.deleted = existingDeleted;

    await writeText(path.join(dir, FILES.packageYaml), pkg.yamlCode ?? "");
    await writeJsonStable(path.join(dir, FILES.packageProps), props);
    await writeJsonStable(path.join(dir, FILES.packageVariables), pkg.variables ?? []);
    written.packages.push({ name: pkg.name, internalId: pkg.internalId });
  }

  return { root: L.base, ...written };
}

// ---------------------------------------------------------------------------
// Read (push): filesystem -> import payload
// ---------------------------------------------------------------------------

async function readActivity(L, staticName) {
  const dir = path.join(L.activitiesDir, safe(staticName));
  const [ps, propsRaw, varsRaw] = await Promise.all([
    readText(path.join(dir, FILES.activitySource)),
    readText(path.join(dir, FILES.activityProps)),
    readText(path.join(dir, FILES.activityVariables)).catch(() => ""),
  ]);
  const props = JSON.parse(propsRaw);
  return {
    staticName: props.staticName,
    name: props.name,
    description: props.description ?? "",
    imageBlob: props.imageBlob ?? "",
    powerShellCode: ps,
    activityVariables: varsRaw.trim() === "" ? [] : JSON.parse(varsRaw),
    tags: props.tags ?? [],
  };
}

async function readForm(L, staticName) {
  const dir = path.join(L.formsDir, safe(staticName));
  const [tpl, propsRaw, defaults] = await Promise.all([
    readText(path.join(dir, FILES.formTemplate)),
    readText(path.join(dir, FILES.formProps)),
    readText(path.join(dir, FILES.formDefaults)),
  ]);
  const props = JSON.parse(propsRaw);
  return {
    staticName: props.staticName,
    name: props.displayName,
    displayGoButton: props.displayGoButton,
    isReadOnly: props.isReadOnly,
    description: "",
    formJson: tpl,
    formData: defaults,
    tags: props.tags ?? [],
  };
}

async function findPackageFolder(L, internalId) {
  const suffix = `_${internalId}`.toLowerCase();
  const names = await listDirs(L.packagesDir);
  return names.find((n) => n.toLowerCase().endsWith(suffix));
}

async function readPackage(L, internalId) {
  const folder = await findPackageFolder(L, internalId);
  if (!folder) throw new Error(`Package folder for internalId ${internalId} not found under ${L.packagesDir}`);
  const dir = path.join(L.packagesDir, folder);
  const [yamlCode, propsRaw, varsRaw] = await Promise.all([
    readText(path.join(dir, FILES.packageYaml)),
    readText(path.join(dir, FILES.packageProps)),
    readText(path.join(dir, FILES.packageVariables)).catch(() => ""),
  ]);
  const props = JSON.parse(propsRaw);
  return {
    internalId: props.internalId,
    name: props.name,
    description: props.description ?? "",
    yamlCode,
    variables: varsRaw.trim() === "" ? [] : JSON.parse(varsRaw),
    tags: props.tags ?? [],
    deleted: typeof props.deleted === "boolean" ? props.deleted : undefined,
  };
}

export async function readImportFromFiles(root, importModel, opts = {}) {
  const L = layout(root, opts);
  const source = { activities: [], forms: [], packages: [], globalVariables: [] };

  for (const staticName of importModel.activityStaticNames ?? []) {
    source.activities.push(await readActivity(L, staticName));
  }
  for (const staticName of importModel.formStaticNames ?? []) {
    source.forms.push(await readForm(L, staticName));
  }
  for (const internalId of importModel.packageInternalIds ?? []) {
    source.packages.push(await readPackage(L, internalId));
  }

  return source;
}

// ---------------------------------------------------------------------------
// Package YAML scan: resolve activity/form references for a set of packages
// ---------------------------------------------------------------------------

function extractRefsFromYaml(yamlCode) {
  const activities = [];
  const forms = [];

  const doc = parseDocument(yamlCode);
  const steps = doc.get("steps");
  if (steps && typeof steps.toJSON === "function") {
    const stepsJson = steps.toJSON();
    // steps may come back as either an array or a keyed map; handle both
    const iterable = Array.isArray(stepsJson) ? stepsJson : Object.values(stepsJson ?? {});
    for (const step of iterable) {
      if (!step || typeof step !== "object") continue;
      if (step.task) activities.push(step.task);
      if (step.inputs?.form_name) forms.push(step.inputs.form_name);
    }
  }

  const conditions = doc.get("conditions");
  if (conditions && typeof conditions.toJSON === "function") {
    const condJson = conditions.toJSON();
    const iterable = Array.isArray(condJson) ? condJson : Object.values(condJson ?? {});
    for (const cond of iterable) {
      if (cond?.variables_form) forms.push(cond.variables_form);
    }
  }

  return { activities, forms };
}

export async function scanPackageRefs(root, packageInternalIds, opts = {}) {
  const L = layout(root, opts);
  const allActivityFolders = new Set(await listDirs(L.activitiesDir));
  const allFormFolders = new Set(await listDirs(L.formsDir));
  const packageFolders = await listDirs(L.packagesDir);

  const activitySet = new Set();
  const formSet = new Set();
  const missing = [];

  for (const internalId of packageInternalIds) {
    const suffix = `_${internalId}`.toLowerCase();
    const folder = packageFolders.find((n) => n.toLowerCase().endsWith(suffix));
    if (!folder) {
      missing.push(internalId);
      continue;
    }
    const yamlPath = path.join(L.packagesDir, folder, FILES.packageYaml);
    let yamlCode;
    try {
      yamlCode = await readText(yamlPath);
    } catch {
      missing.push(internalId);
      continue;
    }
    const refs = extractRefsFromYaml(yamlCode);
    for (const a of refs.activities) {
      if (allActivityFolders.has(safe(a))) activitySet.add(a);
    }
    for (const f of refs.forms) {
      if (allFormFolders.has(safe(f))) formSet.add(f);
    }
  }

  return {
    activityStaticNames: [...activitySet],
    formStaticNames: [...formSet],
    packageInternalIds,
    missingPackageFolders: missing,
  };
}

// ---------------------------------------------------------------------------
// Local inventory helpers
// ---------------------------------------------------------------------------

export async function listLocalPackages(root, opts = {}) {
  const L = layout(root, opts);
  const folders = await listDirs(L.packagesDir);
  const results = [];
  for (const folder of folders) {
    const propsPath = path.join(L.packagesDir, folder, FILES.packageProps);
    try {
      const props = await readJson(propsPath);
      if (props) {
        results.push({
          folder,
          name: props.name,
          internalId: props.internalId,
          description: props.description ?? "",
          deleted: props.deleted ?? false,
        });
      }
    } catch { /* skip folders without readable props */ }
  }
  results.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return results;
}

export async function listLocalActivities(root, opts = {}) {
  const L = layout(root, opts);
  return (await listDirs(L.activitiesDir)).sort();
}

export async function listLocalForms(root, opts = {}) {
  const L = layout(root, opts);
  return (await listDirs(L.formsDir)).sort();
}
