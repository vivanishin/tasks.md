const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const osl = require("./osl");

test("Web editing preserves Markdown, scopes commits and rejects concurrent changes", async (t) => {
  const helper = process.env.OSL_HELPER;
  if (!helper) return t.skip("Set OSL_HELPER to test Web editing");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "osl-web-edit "));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const settings = { OSL_READ_ONLY: "true", TASKS_DIR: path.join(repo, "tasks"), BASE_PATH: "/osl",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const git = (...args) => {
    const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.name", "OSL test");
  git("config", "user.email", "osl-test@example.invalid");
  const root = settings.TASKS_DIR;
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, ".board.json"), JSON.stringify({ columns: ["inbox", "done"],
    spaces: ["home"], captureColumn: "inbox", defaultSpace: "home", archiveColumn: "done",
    webDefaults: { timeZone: "Europe/Moscow", rules: [{ space: "home" }] } }));
  osl.init(root);
  const original = osl.capture(root, { title: "Edit me", tags: ["source::kaiten"],
    body: "<!-- service comment -->\n\n- [ ] Checklist\n\n<details>\n<summary>Original</summary>\n\n```json\n{}\n```\n\n</details>\n\n[Self](osl:1)" });
  const other = osl.capture(root, { title: "Other" });
  fs.writeFileSync(path.join(repo, "note"), "Original");
  git("add", "."); git("commit", "-qm", "Initial");
  const remote = path.join(repo, "remote.git");
  git("init", "--bare", "-q", remote);
  git("remote", "add", "origin", remote);
  git("push", "-u", "origin", "HEAD");
  const initial = git("rev-parse", "HEAD");
  fs.appendFileSync(other.path, "\nUnrelated task edit\n");
  fs.writeFileSync(path.join(repo, "note"), "Unrelated staged edit");
  git("add", "note", other.path);
  const index = git("diff", "--cached");
  const fileBefore = fs.readFileSync(original.path, "utf8");
  delete require.cache[require.resolve("./server")];
  const server = require("./server").listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve("./server")];
  });
  const base = `http://127.0.0.1:${server.address().port}/osl/_api`;
  const read = async () => (await (await fetch(`${base}/osl`)).json()).tasks.find((task) => task.id === "1");
  const save = (task, overrides = {}) => fetch(`${base}/resource/${task.path}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: task.revision, title: task.title, body: task.body, ...overrides }),
  });
  const firstTab = await read();
  const nextBody = `${firstTab.body}\nWeb edit\n`;
  let response = await save(firstTab, { title: "New title", body: nextBody });
  assert.equal(response.status, 204, await response.text());
  assert.equal(fs.readFileSync(original.path, "utf8"), fileBefore.replace("# Edit me", "# New title").replace(firstTab.body, nextBody));
  assert.deepEqual(git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n"), ["tasks/inbox/1-edit-me.md"]);
  assert.equal(git("diff", "--cached"), index);
  assert.equal(git("--git-dir", remote, "rev-parse", "HEAD"), initial);
  const head = git("rev-parse", "HEAD");
  const current = await read();
  response = await save(current);
  assert.equal(response.status, 204);
  assert.equal(git("rev-parse", "HEAD"), head, "unchanged card creates no commit");
  response = await save(firstTab, { body: "Stale tab" });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /changed since editing/);
  assert.equal((await read()).body, nextBody);

  fs.appendFileSync(original.path, "\nEmacs edit\n");
  const emacsContent = fs.readFileSync(original.path, "utf8");
  response = await save(current, { body: "Overwrite Emacs" });
  assert.equal(response.status, 409);
  assert.equal(fs.readFileSync(original.path, "utf8"), emacsContent);
  git("add", original.path); git("commit", "--only", "-qm", "Emacs", "--", original.path);
  response = await save(current, { body: "Overwrite committed Emacs" });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /changed since editing/);
  const latest = await read();
  fs.mkdirSync(path.join(root, ".move-lock"));
  response = await save(latest, { body: "Concurrent write".repeat(20000) });
  assert.equal(response.status, 409);
  fs.rmdirSync(path.join(root, ".move-lock"));
  assert.equal(fs.readFileSync(original.path, "utf8"), emacsContent);

  const moved = path.join(root, "done", path.basename(original.path));
  git("mv", original.path, moved); git("commit", "--only", "-qm", "Move", "--", original.path, moved);
  response = await save(latest, { body: "Old path" });
  assert.equal(response.status, 409);
  assert.equal(fs.existsSync(original.path), false);
  assert.equal(fs.readFileSync(moved, "utf8"), emacsContent);
  const movedTask = await read();
  for (const overrides of [{ title: "" }, { title: "Two\nlines" }, { revision: "bad" }, { extra: true }, { newPath: latest.path }]) {
    response = await save(movedTask, overrides);
    assert.ok([400, 409].includes(response.status));
    assert.equal(fs.readFileSync(moved, "utf8"), emacsContent);
  }

  const hooks = path.join(repo, "hooks");
  fs.mkdirSync(hooks);
  fs.writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\necho 'Rejected test commit' >&2\nexit 1\n", { mode: 0o755 });
  git("config", "core.hooksPath", hooks);
  const beforeFailure = git("rev-parse", "HEAD");
  response = await save(movedTask, { body: `${movedTask.body}\nRetained after failed commit\n` });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Card saved, but local commit failed/);
  assert.match(fs.readFileSync(moved, "utf8"), /Retained after failed commit/);
  assert.equal(git("rev-parse", "HEAD"), beforeFailure);
  assert.equal(fs.existsSync(path.join(root, ".move-lock")), false);
});
