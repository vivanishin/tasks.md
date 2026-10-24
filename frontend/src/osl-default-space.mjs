export function defaultSpaceFor(webDefaults, now = new Date()) {
  if (!webDefaults) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: webDefaults.timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const day = values.weekday.toLowerCase();
  const time = `${values.hour}:${values.minute}`;
  return webDefaults.rules.find((rule) => (!rule.days || rule.days.includes(day))
    && (!rule.from || time >= rule.from) && (!rule.before || time < rule.before))?.space || "";
}
