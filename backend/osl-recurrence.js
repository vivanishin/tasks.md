const fs = require("node:fs");
const path = require("node:path");

function interval(value) {
  const match = /^([1-9][0-9]*)(d|w)$/.exec(value || "");
  const milliseconds = match && Number(match[1]) * (match[2] === "w" ? 7 : 1) * 86400000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) throw new Error("Repeat must be a positive interval such as 7d or 2w");
  return milliseconds;
}

function isDue(task, now = Date.now()) {
  if (task.tags.includes("closure::cancelled")) return false;
  if (task.reopen) {
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(now);
    return task.reopen <= today;
  }
  const last = task.occurrences?.at(-1);
  return task.tags.includes("recurring") && Boolean(task.repeat)
    && last?.event === "closed" && Date.parse(last.at) + interval(task.repeat) <= now;
}

function transition(root, task, state, archive, now = new Date()) {
  const reopening = task.state === archive;
  const repeating = task.tags.includes("recurring") && task.repeat;
  if ((!repeating && !task.reopen) || task.state === state
      || ![task.state, state].includes(archive)) return null;
  const content = fs.readFileSync(path.join(root, task.path), "utf8");
  const heading = /^# /m.exec(content).index;
  let header = content.slice(0, heading).trimEnd();
  if (reopening) header = header.replace(/\[(?:tag:closure::|reopen:)[^\]\r\n]*\][ \t]*/g, "").trimEnd();
  const event = state === archive ? "closed" : "opened";
  return `${header}\n[${event}:${now.toISOString()}]\n\n${content.slice(heading)}`;
}

module.exports = { interval, isDue, transition };
