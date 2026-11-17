const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const osl = require("./osl");

test("concurrent board reads reopen due recurring and scheduled cards once", async (t) => {
  if (!process.env.OSL_HELPER) return t.skip("Set OSL_HELPER to test automatic reopening");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "osl-recur-http-"));
  const root = path.join(repo, "tasks");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, ".board.json"), JSON.stringify({ columns: ["inbox", "archive"],
    spaces: ["home"], captureColumn: "inbox", defaultSpace: "home", archiveColumn: "archive",
    webDefaults: { timeZone: "Europe/Moscow", rules: [{ space: "home" }] } }));
  osl.init(root);
  const task = osl.capture(root, { title: "Recurring", state: "archive", tags: ["recurring"], body: "Instructions" });
  fs.writeFileSync(task.path, fs.readFileSync(task.path, "utf8")
    .replace("# Recurring", "[repeat:1d]\n[closed:2020-01-01T00:00:00.000Z]\n\n# Recurring"));
  const scheduled = osl.capture(root, { title: "Scheduled", state: "archive", body: "One-time instructions" });
  fs.writeFileSync(scheduled.path, fs.readFileSync(scheduled.path, "utf8")
    .replace("# Scheduled", "[reopen:2020-01-01]\n\n# Scheduled"));
  const git = (...args) => {
    const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q"); git("config", "user.name", "Check"); git("config", "user.email", "check@example.invalid");
  git("add", "."); git("commit", "-qm", "Initial");
  const settings = { OSL_READ_ONLY: "true", TASKS_DIR: root, BASE_PATH: "", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const server = require("./server").listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(repo, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const url = `http://127.0.0.1:${server.address().port}/_api/osl`;
  await Promise.all([fetch(url), fetch(url)]);
  const current = await (await fetch(url)).json();
  assert.equal(current.tasks.length, 2);
  const oneTime = current.tasks.find((task) => task.id === scheduled.id);
  assert.equal(oneTime.state, "inbox");
  assert.equal(oneTime.reopen, null);
  assert.deepEqual(oneTime.occurrences.map((entry) => entry.event), ["opened"]);
  const repeated = current.tasks.find((item) => item.id === task.id);
  assert.equal(repeated.state, "inbox");
  assert.deepEqual(repeated.occurrences.map((entry) => entry.event), ["closed", "opened"]);
  assert.match(repeated.body, /Instructions/);
  assert.equal(git("rev-list", "--count", "HEAD"), "3");
  const head = git("rev-parse", "HEAD");
  await fetch(url);
  assert.equal(git("rev-parse", "HEAD"), head);
});
