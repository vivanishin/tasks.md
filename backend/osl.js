const fs = require("node:fs");
const path = require("node:path");

const ID = /^[1-9][0-9]*$/;
const dateValid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value))
  && new Date(value).toISOString().slice(0, 10) === value;
const timestampValid = (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

function validateWebDefaults(value, spaces) {
  if (!value || Array.isArray(value) || typeof value !== "object"
      || Object.keys(value).some((key) => !["timeZone", "rules"].includes(key))) {
    throw new Error("webDefaults must contain timeZone and rules");
  }
  if (typeof value.timeZone !== "string" || !value.timeZone) throw new Error("webDefaults.timeZone is required");
  try { new Intl.DateTimeFormat("en-US", { timeZone: value.timeZone }); }
  catch { throw new Error("Invalid webDefaults.timeZone"); }
  if (!Array.isArray(value.rules) || !value.rules.length) throw new Error("webDefaults.rules must be a nonempty array");
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  for (const [index, rule] of value.rules.entries()) {
    const prefix = `webDefaults.rules[${index}]`;
    if (!rule || Array.isArray(rule) || typeof rule !== "object"
        || Object.keys(rule).some((key) => !["days", "from", "before", "space"].includes(key))) {
      throw new Error(`${prefix}: expected a rule with days, from, before and space`);
    }
    if (!spaces.includes(rule.space)) throw new Error(`${prefix}: space must name a configured Space`);
    if ("days" in rule && (!Array.isArray(rule.days) || !rule.days.length
        || rule.days.some((day) => !days.includes(day)) || new Set(rule.days).size !== rule.days.length)) {
      throw new Error(`${prefix}: days must be distinct weekday names (mon through sun)`);
    }
    for (const key of ["from", "before"]) {
      if (key in rule && (typeof rule[key] !== "string" || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(rule[key]))) {
        throw new Error(`${prefix}: ${key} must be a time in HH:MM format`);
      }
    }
    if (rule.from && rule.before && rule.from >= rule.before) throw new Error(`${prefix}: from must precede before`);
    const unconditional = !["days", "from", "before"].some((key) => key in rule);
    if (unconditional !== (index === value.rules.length - 1)) {
      throw new Error(`${prefix}: only the final rule must be unconditional`);
    }
  }
}

function readConfig(root) {
  const filename = path.join(root, ".board.json");
  if (!fs.lstatSync(filename).isFile()) throw new Error(".board.json must be a regular file");
  const config = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(filename)));
  if (!config || Array.isArray(config) || typeof config !== "object") throw new Error("Expected a board configuration object");
  const keys = ["columns", "spaces", "captureColumn", "defaultSpace", "archiveColumn", "webDefaults"];
  if (Object.keys(config).some((key) => !keys.includes(key))) throw new Error("Unknown board configuration property");
  const valuesValid = (values, valid) => Array.isArray(values) && values.length > 0
    && values.every((value) => typeof value === "string" && valid(value))
    && new Set(values).size === values.length;
  if (!valuesValid(config.columns, (value) => value.trim() === value && value.length > 0
    && !value.startsWith(".") && !/[\\/\r\n]/.test(value))) throw new Error("Columns must be distinct directory names");
  if (!valuesValid(config.spaces, (value) => value.trim() === value && value.length > 0
    && !value.includes("::") && !/[\[\]\r\n]/.test(value))) throw new Error("Spaces must be distinct tag values");
  if (!config.columns.includes(config.captureColumn)) throw new Error("captureColumn must name a configured column");
  if (!config.columns.includes(config.archiveColumn)) throw new Error("archiveColumn must name a configured column");
  if (config.captureColumn === config.archiveColumn) throw new Error("Capture and archive columns must differ");
  if (!config.spaces.includes(config.defaultSpace)) throw new Error("defaultSpace must name a configured Space");
  validateWebDefaults(config.webDefaults, config.spaces);
  return config;
}

function parseTask(content, relativePath, config) {
  const errors = [];
  const heading = /^# (.+)\r?$/m.exec(content);
  const header = heading ? content.slice(0, heading.index) : content;
  const markers = [...header.matchAll(/\[([a-z-]+):([^\]\r\n]*)\]/g)];
  const fields = new Map();
  for (const [, key, value] of markers) {
    if (!fields.has(key)) fields.set(key, []);
    fields.get(key).push(value);
    if (!["id", "tag", "created", "updated", "due", "legacy"].includes(key)) {
      errors.push(`Unsupported metadata: ${key}`);
    }
  }
  if (header.replace(/\[([a-z-]+):([^\]\r\n]*)\]/g, "").trim()) {
    errors.push("Unrecognized text in metadata header");
  }
  const single = (key, required = false) => {
    const values = fields.get(key) || [];
    if (values.length > 1 || (required && values.length !== 1)) {
      errors.push(`Expected ${required ? "exactly" : "at most"} one ${key} marker`);
    }
    return values[0] || null;
  };
  const rawId = single("id", true);
  const id = fields.get("id")?.length === 1 ? rawId : null;
  if (!id || !ID.test(id)) errors.push("ID must be a canonical positive integer");
  const created = single("created");
  const updated = single("updated");
  for (const [key, value] of [["created", created], ["updated", updated]]) {
    if (fields.has(key) && !timestampValid(value || "")) errors.push(`Invalid ${key} UTC timestamp`);
  }
  if (timestampValid(created || "") && timestampValid(updated || "") && updated < created) {
    errors.push("Updated timestamp precedes creation");
  }
  const due = single("due");
  if (fields.has("due") && !dateValid(due || "")) errors.push("Invalid due date");
  const tags = fields.get("tag") || [];
  const scopes = new Map();
  for (const tag of tags) {
    if (!tag.trim() || tag.trim() !== tag) errors.push("Tag must be nonempty and trimmed");
    const separator = tag.lastIndexOf("::");
    if (separator < 0) continue;
    const scope = tag.slice(0, separator);
    const value = tag.slice(separator + 2);
    if (!scope || !value) errors.push(`Empty scoped-tag key or value: ${tag}`);
    if (!scopes.has(scope)) scopes.set(scope, []);
    scopes.get(scope).push(value);
  }
  for (const [scope, values] of scopes) {
    if (values.length > 1) errors.push(`Competing values in scope ${scope}`);
  }
  if ((scopes.get("space") || []).length !== 1) errors.push("Expected exactly one space tag");
  const space = scopes.get("space")?.length === 1 ? scopes.get("space")[0] : null;
  if (space && config && !config.spaces.includes(space)) errors.push(`Unconfigured Space: ${space}`);
  const parts = relativePath.split(path.sep);
  const state = parts[0];
  if (parts.length !== 2 || !config?.columns.includes(state)) errors.push("Unknown workflow directory");
  if (!heading || !heading[1].trim()) errors.push("Missing task title (# Title)");
  if (/^(<{7}|={7}|>{7})(?: |$)/m.test(content)) errors.push("Unresolved Git conflict");
  return {
    id: id && ID.test(id) ? id : null,
    title: heading ? heading[1].trim() : path.basename(relativePath, ".md"),
    state, tags, space,
    due, created, updated, path: relativePath.split(path.sep).join("/"),
    body: heading ? content.slice(heading.index + heading[0].length).replace(/^\r?\n/, "") : content,
    errors,
  };
}

function snapshot(root) {
  const tasks = [];
  const issues = [];
  let config = null;
  try { config = readConfig(root); }
  catch (error) { issues.push({ path: ".board.json", message: `Invalid board configuration: ${error.message}` }); }
  const walk = (directory) => {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch (error) {
      issues.push({ path: path.relative(root, directory) || ".", message: `Cannot read directory (${error.code})` });
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const filename = path.join(directory, entry.name);
      const relative = path.relative(root, filename);
      if (entry.isSymbolicLink()) {
        issues.push({ path: relative, message: "Symbolic links are unsupported" });
      } else if (entry.isDirectory()) {
        walk(filename);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        try {
          const content = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(filename));
          const task = parseTask(content, relative, config);
          task.references = [...new Set([...content.matchAll(/\bosl:([1-9][0-9]*)\b/g)].map((match) => match[1]))];
          tasks.push(task);
        } catch (error) {
          issues.push({ path: relative, message: `Cannot read task (${error.code || error.name})` });
        }
      }
    }
  };
  walk(root);
  const ids = new Map();
  for (const task of tasks) {
    if (!task.id) continue;
    if (!ids.has(task.id)) ids.set(task.id, []);
    ids.get(task.id).push(task);
  }
  for (const [id, matches] of ids) {
    if (matches.length > 1) matches.forEach((task) => task.errors.push(`Duplicate task ID osl:${id}`));
  }
  for (const task of tasks) {
    for (const reference of task.references) {
      if (!ids.has(reference)) task.errors.push(`Broken reference osl:${reference}`);
      else if (ids.get(reference).length > 1) task.errors.push(`Ambiguous reference osl:${reference}`);
    }
    task.errors.forEach((message) => issues.push({ path: task.path, message }));
  }
  let nextId = null;
  let allocatorValid = true;
  try {
    nextId = fs.readFileSync(path.join(root, ".next-id"), "utf8").trim();
    if (!ID.test(nextId)) throw new Error("invalid");
    if ([...ids.keys()].some((id) => BigInt(id) >= BigInt(nextId))) throw new Error("behind");
  } catch {
    allocatorValid = false;
    issues.push({ path: ".next-id", message: "Missing, invalid, or regressed allocator; restore its high-water mark from Git" });
  }
  const allocationSafe = Boolean(config) && allocatorValid
    && tasks.every((task) => task.id && ids.get(task.id).length === 1)
    && !issues.some((issue) => /^(Cannot read|Symbolic links)/.test(issue.message));
  return { schemaVersion: 1, states: config?.columns || [], spaces: config?.spaces || [],
    defaultSpace: config?.defaultSpace || null,
    webDefaults: config?.webDefaults || null,
    archiveState: config?.archiveColumn || null, nextId, allocationSafe, tasks, issues };
}

function lookup(root, reference) {
  const match = /^(?:osl:)?([1-9][0-9]*)$/.exec(reference);
  if (!match) throw new Error("Expected a positive OSL number or reference such as 1234 or osl:1234");
  const matches = snapshot(root).tasks.filter((task) => task.id === match[1]);
  if (matches.length !== 1) throw new Error(matches.length ? `Ambiguous reference ${reference}` : `Unknown reference ${reference}`);
  return path.join(root, matches[0].path);
}

function init(root) {
  fs.mkdirSync(root, { recursive: true });
  const config = readConfig(root);
  const counter = path.join(root, ".next-id");
  if (!fs.existsSync(counter)) {
    const files = fs.readdirSync(root);
    if (files.some((entry) => ![".gitignore", ".board.json"].includes(entry))) throw new Error("Initialize an empty directory; restore a missing allocator from Git");
    fs.writeFileSync(counter, "1\n", { flag: "wx" });
  }
  for (const state of config.columns) {
    fs.mkdirSync(path.join(root, state), { recursive: true });
    const keep = path.join(root, state, ".gitkeep");
    if (!fs.existsSync(keep)) fs.writeFileSync(keep, "", { flag: "wx" });
  }
}

function capture(root, { title, space, tags = [], body = "", state }) {
  const config = readConfig(root);
  space ??= config.defaultSpace;
  state ??= config.captureColumn;
  if (!title || /[\r\n]/.test(title) || !title.trim()) throw new Error("A one-line title is required");
  if (!config.columns.includes(state)) throw new Error("Unknown workflow state");
  if (!space || /[\[\]\r\n]/.test(space) || space.includes("::") || space.trim() !== space) throw new Error("Invalid Space value");
  if (!config.spaces.includes(space)) throw new Error("Unconfigured Space");
  if (tags.some((tag) => !tag || /[\[\]\r\n]/.test(tag))) throw new Error("Invalid tag");
  const lock = path.join(root, ".capture-lock");
  try { fs.mkdirSync(lock); }
  catch (error) { throw new Error(`Cannot reserve an ID (${error.code}); check whether another capture is running or a stale .capture-lock remains`); }
  try {
    const current = snapshot(root);
    if (!current.allocationSafe) throw new Error("Task identities or allocator are invalid; run validate before capture");
    const id = current.nextId;
    const filename = path.join(root, state, `${id}.md`);
    const content = `[id:${id}]\n[tag:space::${space}]${tags.map((tag) => ` [tag:${tag}]`).join("")}\n\n# ${title.trim()}\n\n${body.trimEnd()}\n`;
    const parsed = parseTask(content, `${state}/${id}.md`, config);
    if (parsed.errors.length) throw new Error(parsed.errors.join("; "));
    // Reserve before writing the card: a failed capture may leave a gap, never reuse.
    const temporary = path.join(root, ".next-id.tmp");
    fs.writeFileSync(temporary, `${BigInt(id) + 1n}\n`, { flag: "wx" });
    fs.renameSync(temporary, path.join(root, ".next-id"));
    fs.writeFileSync(filename, content, { flag: "wx" });
    return { id, reference: `osl:${id}`, path: filename };
  } finally { fs.rmdirSync(lock); }
}

function main(args) {
  let root = process.env.TASKS_DIR;
  if (args[0] === "--root") { root = args[1]; args = args.slice(2); }
  if (!root) throw new Error("Specify --root TASKS_DIR");
  root = path.resolve(root);
  const command = args.shift();
  if (command === "config" && !args.length) return process.stdout.write(`${JSON.stringify(readConfig(root))}\n`);
  if (command === "init" && !args.length) return init(root);
  if (command === "validate" && !args.length) {
    const result = snapshot(root);
    result.issues.forEach((issue) => process.stderr.write(`${issue.path}: ${issue.message}\n`));
    process.stdout.write(`${result.tasks.length} tasks; ${result.issues.length} validation issues\n`);
    if (result.issues.length) process.exitCode = 1;
    return;
  }
  if (command === "lookup" && args.length === 1) return process.stdout.write(`${lookup(root, args[0])}\n`);
  if (command === "snapshot" && !args.length) return process.stdout.write(`${JSON.stringify(snapshot(root))}\n`);
  if (command === "capture") {
    const options = { tags: [] };
    while (args.length) {
      const key = args.shift();
      const value = args.shift();
      if (!value || !["--title", "--space", "--tag", "--state", "--body"].includes(key)) throw new Error(`Invalid capture option ${key}`);
      if (key === "--tag") options.tags.push(value);
      else options[key.slice(2)] = value;
    }
    return process.stdout.write(`${JSON.stringify(capture(root, options))}\n`);
  }
  throw new Error("Usage: osl.js --root DIR init|config|validate|snapshot|lookup NUMBER_OR_REFERENCE|capture --title TITLE [--space SPACE] [--tag TAG] [--state STATE] [--body TEXT]");
}

module.exports = { readConfig, parseTask, snapshot, lookup, init, capture };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
