const fs = require("node:fs");
const path = require("node:path");
const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" });

function interval(value) {
  const match = /^([1-9][0-9]*)(d|w)$/.exec(value || "");
  const milliseconds = match && Number(match[1]) * (match[2] === "w" ? 7 : 1) * 86400000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) throw new Error("Repeat must be a positive interval such as 7d or 2w");
  return milliseconds;
}

function repeatAt(task) {
  const last = task.occurrences?.at(-1);
  return task.repeat && last?.event === "closed" ? Date.parse(last.at) + interval(task.repeat) : null;
}

function nextDate(task) {
  if (task.tags.includes("closure::cancelled")) return null;
  if (task.reopen) return task.reopen;
  const at = repeatAt(task);
  return at === null || Number.isNaN(new Date(at).getTime()) ? null : day.format(at);
}

function isDue(task, now = Date.now()) {
  if (task.tags.includes("closure::cancelled")) return false;
  if (task.reopen) {
    return task.reopen <= day.format(now);
  }
  const at = repeatAt(task);
  return at !== null && at <= now;
}

function isReady(task, board, now = Date.now()) {
  return (task.state === board.archiveState || (Boolean(task.reopen) && board.reopenStates.includes(task.state)))
    && isDue(task, now);
}

function transition(root, task, state, config, reopen, now = new Date()) {
  const archive = config.archiveColumn;
  const deferred = config.reopenColumns || [];
  const crossing = task.state !== state && [task.state, state].includes(archive);
  const event = crossing && (task.repeat || task.reopen || reopen)
    ? state === archive ? "closed" : "opened" : null;
  const consume = task.reopen && !deferred.includes(state)
    && (deferred.includes(task.state) || (task.state === archive && state !== archive));
  const nextDate = reopen ?? (consume ? null : task.reopen);
  if (!event && nextDate === task.reopen) return null;
  const content = fs.readFileSync(path.join(root, task.path), "utf8");
  const heading = /^# /m.exec(content).index;
  let header = content.slice(0, heading).trimEnd();
  if (nextDate !== task.reopen) {
    header = header.replace(/\[recur::reopen:[^\]\r\n]*\][ \t]*/g, "").trimEnd();
    if (nextDate) header += `\n[recur::reopen:${nextDate}]`;
  }
  if (event === "opened") header = header.replace(/\[tag:closure::[^\]\r\n]*\][ \t]*/g, "").trimEnd();
  if (event) header += `\n[recur::${event}:${now.toISOString()}]`;
  return `${header}\n\n${content.slice(heading)}`;
}

module.exports = { interval, isDue, isReady, nextDate, transition };
