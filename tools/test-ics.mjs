#!/usr/bin/env node
// The subscription feed. A calendar app is unforgiving about iCalendar, so the
// shape is pinned here: all-day dates, the exclusive DTEND, escaping, stable
// UIDs and the 75 octet fold.
import { toICS } from "../netlify/src/content.mjs";

let pass = 0, fail = 0;
const ok = (name, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); g ? pass++ : fail++; console.log(`${g ? "PASS" : "FAIL"}  ${name}${g ? "" : "  got " + JSON.stringify(got)}`); };

const events = [
  { date: "2027-05-14", endDate: "2027-05-16", title: "County Shield", section: "scouts", location: "Ruan", details: "Camp; bring\nboots", time: "18:00", countyId: "ev_1" },
  { date: "2026-12-05", title: "Beavers, party", section: "beavers" },
  { date: "2026-11-01", title: "A".repeat(200) },
  { title: "No date" }, null,
];
// Times, which a subscribed calendar needs if the event is to land at the right
// hour rather than sitting across the whole day.
const timed = [
  { date: "2026-09-17", title: "First meeting", startTime: "18:00", endTime: "19:30" },
  { date: "2026-09-19", endDate: "2026-09-21", title: "Autumn camp", startTime: "18:30", endTime: "14:00" },
  { date: "2026-10-01", title: "Talk", startTime: "19:00" },
  { date: "2026-10-02", title: "Late one", startTime: "23:30" },
  { date: "2026-10-03", title: "Back to front", startTime: "18:00", endTime: "17:00" },
  { date: "2026-10-04", title: "Not a time", startTime: "half six", time: "half six" },
];
const out = toICS(events, "7th Clare Scouts: All sections", "7thclarescouts.ie");
const lines = out.split("\r\n");

ok("wrapped in VCALENDAR", [lines[0], lines[lines.length - 2]], ["BEGIN:VCALENDAR", "END:VCALENDAR"]);
ok("one VEVENT per usable event, junk skipped", lines.filter((l) => l === "BEGIN:VEVENT").length, 3);
ok("all-day DTSTART", lines.includes("DTSTART;VALUE=DATE:20270514"), true);
ok("DTEND is the day after the last day, as iCalendar requires", lines.includes("DTEND;VALUE=DATE:20270517"), true);
ok("a single-day event ends the next day", lines.includes("DTEND;VALUE=DATE:20261206"), true);
ok("commas in a title are escaped", lines.some((l) => l === "SUMMARY:Beavers\\, party"), true);
ok("semicolons and newlines in details are escaped", lines.some((l) => l.startsWith(String.raw`DESCRIPTION:Camp\; bring\nboots`)), true);
ok("the time is carried into the description", out.includes("Time: 18:00"), true);
ok("a county event keeps its id as the UID, so edits do not duplicate", lines.includes("UID:ev_1@7thclarescouts.ie"), true);
ok("a local event gets a stable UID from its date and title", lines.includes("UID:2026-12-05-beavers-party@7thclarescouts.ie"), true);
ok("every line is within the 75 octet fold", lines.every((l) => Buffer.byteLength(l, "utf8") <= 75), true);
ok("a folded line continues with a space", lines.some((l) => l.startsWith(" ")), true);
ok("unfolding puts the long title back together", out.replace(/\r\n /g, "").includes("SUMMARY:" + "A".repeat(200)), true);
ok("CRLF throughout", !/[^\r]\n/.test(out), true);
ok("the calendar is named", lines.includes("X-WR-CALNAME:7th Clare Scouts: All sections"), true);

{
  const t = toICS(timed, "7th Clare Scouts", "7thclarescouts.ie");
  const l = t.split("\r\n");
  ok("a timed event starts at its hour, in Irish time", l.includes("DTSTART;TZID=Europe/Dublin:20260917T180000"), true);
  ok("and ends at the hour given", l.includes("DTEND;TZID=Europe/Dublin:20260917T193000"), true);
  ok("the zone is defined in the file, so it is not read as the reader's own", [l.includes("BEGIN:VTIMEZONE"), l.includes("TZID:Europe/Dublin"), l.filter((x) => x === "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU").length], [true, true, 1]);
  ok("a camp runs from the first evening to the last afternoon", [l.includes("DTSTART;TZID=Europe/Dublin:20260919T183000"), l.includes("DTEND;TZID=Europe/Dublin:20260921T140000")], [true, true]);
  ok("a start with no end runs an hour", l.includes("DTEND;TZID=Europe/Dublin:20261001T200000"), true);
  ok("and one late at night stops before midnight rather than the day before", l.includes("DTEND;TZID=Europe/Dublin:20261002T235900"), true);
  ok("an end before the start on the same day is ignored", l.includes("DTEND;TZID=Europe/Dublin:20261003T190000"), true);
  ok("anything that is not a time leaves the event all day", [l.includes("DTSTART;VALUE=DATE:20261004"), t.includes("Time: half six")], [true, true]);
  ok("an all-day feed carries no timezone block", toICS(events, "x", "y").includes("VTIMEZONE"), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
