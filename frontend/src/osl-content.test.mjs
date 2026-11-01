import test from "node:test";
import assert from "node:assert/strict";
import { visibleTags, markdownLink, taskFilePath } from "./osl-content.mjs";

test("only the selected Space and provenance labels are hidden", () => {
  const tags = ["space::digital", "project::osl", "kaiten", "source::telegram", "source:kaiten", "books"];
  assert.deepEqual(visibleTags(tags, "digital", false), ["project::osl", "books"]);
  assert.deepEqual(visibleTags(tags, "", false), ["space::digital", "project::osl", "books"]);
  assert.deepEqual(visibleTags(tags, "digital", true), tags);
});

test("copied Markdown links preserve arbitrary titles and file paths", () => {
  const task = { id: "280", title: "Task [label] \\ path", path: "4-in-progress/280-meta-osl-tasks.md" };
  assert.equal(markdownLink(task), "[Task \\[label\\] \\\\ path](osl:280)");
  assert.equal(taskFilePath("/my tasks/", task), "/my tasks/4-in-progress/280-meta-osl-tasks.md");
});
