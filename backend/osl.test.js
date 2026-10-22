const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, spawn } = require("node:child_process");
const osl = require("./osl");

const board = {
  columns: ["00-inbox", "10-next", "10-waiting", "20-week", "90-archive"],
  spaces: ["home", "work"], captureColumn: "00-inbox", defaultSpace: "home", archiveColumn: "90-archive",
};

function initialize(root, config = board) {
  fs.writeFileSync(path.join(root, ".board.json"), JSON.stringify(config));
  osl.init(root);
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "osl-test-"));
  initialize(root);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("identity survives rename, lane move, Space change and archive; allocator never reuses", (t) => {
  const root = fixture(t);
  const first = osl.capture(root, { title: "Первая задача", space: "home" });
  const second = osl.capture(root, { title: "Related", space: "work", tags: ["priority::high"], body: `[first](osl:${first.id})` });
  const moved = path.join(root, "90-archive", "renamed file.md");
  fs.renameSync(first.path, moved);
  fs.writeFileSync(moved, fs.readFileSync(moved, "utf8").replace("space::home", "space::work").replace("# Первая задача", "# Новое название"));
  assert.equal(osl.lookup(root, first.reference), moved);
  assert.equal(osl.lookup(root, first.id), moved);
  assert.equal(osl.snapshot(root).issues.length, 0);
  assert.equal(osl.snapshot(root).tasks.find((task) => task.id === first.id).space, "work");
  fs.unlinkSync(second.path);
  assert.equal(osl.capture(root, { title: "Next" }).id, "3");
  for (const reference of ["", "0", "01", "osl:01", "-1", "1x", " 1", "osl:1/2"]) {
    assert.throws(() => osl.lookup(root, reference), /positive OSL number or reference/);
  }
  assert.throws(() => osl.lookup(root, "999"), /Unknown/);
  assert.throws(() => osl.lookup(root, "osl:999"), /Unknown/);
});

test("handwritten tasks need no timestamps; board configuration controls capture, order, Spaces and archive", (t) => {
  const root = fixture(t);
  const config = { ...board, columns: ["1 Incoming", "2 Focus", "2 Waiting", "9 Closed"],
    spaces: ["personal", "job"], captureColumn: "1 Incoming", defaultSpace: "personal", archiveColumn: "9 Closed" };
  fs.writeFileSync(path.join(root, ".board.json"), JSON.stringify(config));
  osl.init(root);
  const task = osl.capture(root, { title: "Configuration defaults" });
  assert.equal(path.dirname(task.path), path.join(root, "1 Incoming"));
  assert.doesNotMatch(fs.readFileSync(task.path, "utf8"), /created:|updated:/);
  fs.writeFileSync(path.join(root, "9 Closed", "human-slug.md"), "[id:2]\n[tag:space::job] [tag:closure::cancelled]\n\n# Handwritten\n");
  fs.writeFileSync(path.join(root, ".next-id"), "3\n");
  const view = osl.snapshot(root);
  assert.deepEqual(view.states, config.columns);
  assert.deepEqual(view.spaces, config.spaces);
  assert.equal(view.archiveState, "9 Closed");
  assert.equal(view.issues.length, 0);
  assert.equal(osl.lookup(root, "osl:2"), path.join(root, "9 Closed", "human-slug.md"));
  assert.throws(() => osl.capture(root, { title: "Wrong Space", space: "home" }), /Unconfigured/);
  fs.writeFileSync(path.join(root, ".board.json"), JSON.stringify({ ...config, columns: ["../outside"] }));
  assert.equal(osl.snapshot(root).allocationSafe, false);
  assert.ok(osl.snapshot(root).issues.some((issue) => issue.path === ".board.json"));
  assert.throws(() => osl.capture(root, { title: "Unsafe config" }), /directory names/);
});

test("duplicate IDs are visible and cannot be resolved arbitrarily", (t) => {
  const root = fixture(t);
  const task = osl.capture(root, { title: "One" });
  fs.copyFileSync(task.path, path.join(root, "90-archive", "copy.md"));
  const view = osl.snapshot(root);
  assert.equal(view.tasks.length, 2);
  assert.equal(view.tasks.filter((item) => item.errors.some((message) => message.includes("Duplicate"))).length, 2);
  assert.throws(() => osl.lookup(root, task.reference), /Ambiguous/);
  assert.throws(() => osl.lookup(root, task.id), /Ambiguous/);
  assert.throws(() => osl.capture(root, { title: "Unsafe" }), /invalid/);
});

test("scopes use the last ::, Space is required, invalid cards stay visible", (t) => {
  const root = fixture(t);
  const task = osl.capture(root, { title: "Scoped", tags: ["priority::high", "team::topic::a", "plain", "other"] });
  assert.equal(osl.snapshot(root).issues.length, 0);
  let content = fs.readFileSync(task.path, "utf8");
  content = content.replace("[tag:space::home]", "[tag:space::home] [tag:space::work] [tag:team::topic::b]");
  fs.writeFileSync(task.path, content);
  let view = osl.snapshot(root);
  assert.equal(view.tasks.length, 1);
  assert.ok(view.issues.some((issue) => issue.message.includes("scope team::topic")));
  assert.ok(view.issues.some((issue) => issue.message.includes("one space")));
  fs.writeFileSync(task.path, content.replace(/\[tag:space::[^\]]+\]/g, ""));
  view = osl.snapshot(root);
  assert.equal(view.tasks[0].space, null);
  assert.ok(view.issues.some((issue) => issue.message.includes("one space")));
});

test("metadata is limited to the header; dates, Git conflicts and broken references are reported", (t) => {
  const root = fixture(t);
  const task = osl.capture(root, { title: "Metadata", body: "An example [id:999] and [tag:space::example]" });
  assert.equal(osl.snapshot(root).tasks[0].id, "1");
  assert.equal(osl.snapshot(root).issues.length, 0);
  fs.appendFileSync(task.path, "\n<<<<<<< HEAD\n[missing](osl:456)\n=======\nconflict\n>>>>>>> branch\n");
  fs.writeFileSync(task.path, fs.readFileSync(task.path, "utf8").replace("[id:1]", "[id:1]\n[due:2026-02-30]"));
  const issues = osl.snapshot(root).issues.map((issue) => issue.message);
  assert.ok(issues.includes("Invalid due date"));
  assert.ok(issues.includes("Unresolved Git conflict"));
  assert.ok(issues.includes("Broken reference osl:456"));
  assert.equal(osl.capture(root, { title: "Unaffected capture" }).id, "2");
});

test("symlinks and invalid UTF-8 cannot expose external task contents", (t) => {
  const root = fixture(t);
  osl.capture(root, { title: "Valid" });
  fs.symlinkSync("/etc/passwd", path.join(root, "00-inbox", "external.md"));
  fs.writeFileSync(path.join(root, "00-inbox", "bad.md"), Buffer.from([0xff, 0xfe]));
  const view = osl.snapshot(root);
  assert.equal(view.tasks.length, 1);
  assert.ok(view.issues.some((issue) => issue.message.includes("Symbolic")));
  assert.ok(view.issues.some((issue) => issue.message.includes("Cannot read task")));
});

test("regressed allocator, failed reservation and competing captures do not reuse IDs", async (t) => {
  const root = fixture(t);
  osl.capture(root, { title: "One" });
  fs.writeFileSync(path.join(root, ".next-id"), "1\n");
  assert.ok(osl.snapshot(root).issues.some((issue) => issue.path === ".next-id"));
  fs.writeFileSync(path.join(root, ".next-id"), "2\n");
  fs.mkdirSync(path.join(root, ".capture-lock"));
  assert.throws(() => osl.capture(root, { title: "Blocked" }), /reserve/);
  fs.rmdirSync(path.join(root, ".capture-lock"));
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, "osl.js"), "--root", root, "capture", "--title", `Capture ${i}`]);
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.on("close", (status) => resolve({ status, output }));
  })));
  const ids = results.filter((result) => result.status === 0).map((result) => JSON.parse(result.output).id);
  assert.ok(ids.length > 0);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(osl.snapshot(root).issues.length, 0);
});

test("read-only HTTP rejects all mutation routes and uploads without touching data or config", async (t) => {
  const root = fixture(t);
  const task = osl.capture(root, { title: "HTTP", state: "90-archive" });
  const config = path.join(root, ".absent-config");
  process.env.OSL_READ_ONLY = "true";
  process.env.TASKS_DIR = root;
  process.env.CONFIG_DIR = config;
  process.env.BASE_PATH = "/osl";
  const app = require("./server");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const before = JSON.stringify(osl.snapshot(root));
  for (const method of ["POST", "PATCH", "PUT", "DELETE", "OPTIONS"]) {
    for (const route of ["/osl/_api/resource/00-inbox/test.md", "/osl/_api/tags", "/osl/_api/sort", "/osl/_api/image", "/_api/resource", "/osl/anything"]) {
      const response = await fetch(`${base}${route}`, { method, body: "malformed request" });
      assert.equal(response.status, 405, `${method} ${route}`);
      assert.equal(response.headers.get("allow"), "GET, HEAD");
    }
  }
  const response = await fetch(`${base}/osl/_api/osl`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).tasks[0].id, task.id);
  assert.equal((await fetch(`${base}/osl/_api/resource/%2e%2e/%2e%2e/etc`)).status, 404);
  assert.equal((await fetch(`${base}/osl/_api/image/anything`)).status, 404);
  assert.equal((await fetch(`${base}/osl/_api/osl`, { method: "HEAD" })).status, 200);
  assert.equal(JSON.stringify(osl.snapshot(root)), before);
  assert.equal(fs.existsSync(config), false);
  fs.appendFileSync(task.path, "\nText edited in Emacs\n");
  assert.match((await (await fetch(`${base}/osl/_api/osl`)).json()).tasks[0].body, /edited in Emacs/);
});

test("scoped commit excludes unrelated staged files; a failed push retains the local commit", (t) => {
  const helper = process.env.OSL_HELPER;
  if (!helper) return t.skip("Set OSL_HELPER to test the notes commit helper");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "osl-publication "));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.name", "OSL test");
  git("config", "user.email", "osl-test@example.invalid");
  fs.writeFileSync(path.join(repo, "unrelated.txt"), "original\n");
  git("add", "unrelated.txt");
  git("commit", "-qm", "Initial test repository");
  const root = path.join(repo, "tasks");
  fs.mkdirSync(root);
  initialize(root);
  osl.capture(root, { title: "Commit only this" });
  fs.writeFileSync(path.join(repo, "unrelated.txt"), "unrelated staged change\n");
  git("add", "unrelated.txt");
  const env = { ...process.env, OSL_NODE: process.execPath, OSL_APP: path.dirname(__dirname), OSL_TASKS: root };
  let result = spawnSync("bash", [helper, "commit"], { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const committed = git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n");
  assert.ok(committed.every((filename) => filename.startsWith("tasks/")));
  assert.equal(git("diff", "--cached", "--name-only"), "unrelated.txt");
  fs.appendFileSync(path.join(root, "00-inbox", "1.md"), "\nAnother accepted local change\n");
  git("remote", "add", "origin", path.join(repo, "absent-remote.git"));
  result = spawnSync("bash", [helper, "commit", "--push"], { env, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /retained.*pending synchronization/);
  assert.match(git("show", "HEAD:tasks/00-inbox/1.md"), /accepted local change/);
  assert.equal(git("diff", "--cached", "--name-only"), "unrelated.txt");
});
