import test from "node:test";
import assert from "node:assert/strict";
import { defaultSpaceFor } from "./osl-default-space.mjs";

const defaults = {
  timeZone: "Europe/Moscow",
  rules: [
    { days: ["sat"], before: "13:30", space: "household" },
    { days: ["sat"], space: "digital" },
    { days: ["sun"], before: "13:30", space: "career" },
    { days: ["sun"], space: "body" },
    { from: "20:30", space: "household" },
    { space: "work" },
  ],
};

test("weekday evenings and weekend halves include their starting boundary", () => {
  for (const [local, expected] of [
    ["2026-10-23T13:30", "work"],
    ["2026-10-23T20:29", "work"],
    ["2026-10-23T20:30", "household"],
    ["2026-10-23T23:59", "household"],
    ["2026-10-24T00:00", "household"],
    ["2026-10-24T13:29", "household"],
    ["2026-10-24T13:30", "digital"],
    ["2026-10-24T20:30", "digital"],
    ["2026-10-24T23:59", "digital"],
    ["2026-10-25T00:00", "career"],
    ["2026-10-25T13:29", "career"],
    ["2026-10-25T13:30", "body"],
    ["2026-10-25T20:30", "body"],
    ["2026-10-25T23:59", "body"],
    ["2026-10-26T00:00", "work"],
  ]) {
    assert.equal(defaultSpaceFor(defaults, new Date(`${local}:00+03:00`)), expected, local);
  }
});

test("the configured timezone determines both day and time", () => {
  const instant = new Date("2026-10-23T22:00:00Z");
  assert.equal(defaultSpaceFor(defaults, instant), "household");
  assert.equal(defaultSpaceFor({ ...defaults, timeZone: "UTC" }, instant), "household");
  const sunday = new Date("2026-10-24T22:00:00Z");
  assert.equal(defaultSpaceFor(defaults, sunday), "career");
  assert.equal(defaultSpaceFor({ ...defaults, timeZone: "UTC" }, sunday), "digital");
  const afternoon = new Date("2026-10-24T10:30:00Z");
  assert.equal(defaultSpaceFor(defaults, afternoon), "digital");
  assert.equal(defaultSpaceFor({ ...defaults, timeZone: "UTC" }, afternoon), "household");
});

test("conditions within a rule are ANDed and before excludes its boundary", () => {
  const bounded = { timeZone: "UTC", rules: [
    { days: ["mon", "fri"], from: "09:00", before: "17:00", space: "work" },
    { space: "household" },
  ] };
  for (const [instant, expected] of [
    ["2026-10-23T08:59:00Z", "household"],
    ["2026-10-23T09:00:00Z", "work"],
    ["2026-10-23T16:59:00Z", "work"],
    ["2026-10-23T17:00:00Z", "household"],
    ["2026-10-24T10:00:00Z", "household"],
    ["2026-10-26T10:00:00Z", "work"],
  ]) assert.equal(defaultSpaceFor(bounded, new Date(instant)), expected, instant);
});

test("the first matching rule wins without a fixed weekday or time priority", () => {
  const instant = new Date("2026-10-24T21:00:00+03:00");
  const eveningFirst = { ...defaults, rules: [defaults.rules[4], ...defaults.rules.slice(0, 4), defaults.rules[5]] };
  assert.equal(defaultSpaceFor(defaults, instant), "digital");
  assert.equal(defaultSpaceFor(eveningFirst, instant), "household");
  assert.equal(defaultSpaceFor({ ...defaults, rules: [{ space: "career" }] }, instant), "career");
});

test("an invalid board snapshot without defaults still allows displaying validation issues", () => {
  assert.equal(defaultSpaceFor(null), "");
});
