const fs = require("node:fs");
const path = require("node:path");

function interval(value) {
  const match = /^([1-9][0-9]*)(d|w)$/.exec(value || "");
  const milliseconds = match && Number(match[1]) * (match[2] === "w" ? 7 : 1) * 86400000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) throw new Error("Repeat must be a positive interval such as 7d or 2w");
  return milliseconds;
}

function isDue(task, now = Date.now()) {
  const last = task.occurrences?.at(-1);
  return task.tags.includes("recurring") && !task.tags.includes("closure::cancelled") && Boolean(task.repeat)
    && last?.event === "closed" && Date.parse(last.at) + interval(task.repeat) <= now;
}

function transition(root, task, state, archive, now = new Date()) {
  if (!task.tags.includes("recurring") || !task.repeat || task.state === state
      || ![task.state, state].includes(archive)) return null;
  const content = fs.readFileSync(path.join(root, task.path), "utf8");
  const heading = /^# /m.exec(content).index;
  let header = content.slice(0, heading).trimEnd();
  if (task.state === archive) header = header.replace(/\[tag:closure::[^\]\r\n]*\][ \t]*/g, "").trimEnd();
  const event = state === archive ? "closed" : "opened";
  return `${header}\n[${event}:${now.toISOString()}]\n\n${content.slice(heading)}`;
}

module.exports = { interval, isDue, transition };
