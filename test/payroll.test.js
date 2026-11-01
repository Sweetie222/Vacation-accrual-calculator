"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../assets/payroll.js");

test("parses quoted fields, embedded commas and doubled quotes", () => {
  const rows = P.parseDelimited('Name,Hours\n"Whitfield, Dana",1040\n"She said ""hi""",8\n', ",");
  assert.deepEqual(rows, [["Name", "Hours"], ["Whitfield, Dana", "1040"], ['She said "hi"', "8"]]);
});

test("handles a newline inside a quoted field, CRLF and a BOM", () => {
  const rows = P.parseDelimited('﻿Name,Note\r\n"Dana","line1\nline2"\r\n', ",");
  assert.deepEqual(rows, [["Name", "Note"], ["Dana", "line1\nline2"]]);
});

test("blank rows are dropped", () => {
  assert.equal(P.parseDelimited("a,b\n\n,\nc,d\n", ",").length, 2);
});

test("detects the delimiter from the first non-empty line", () => {
  assert.equal(P.detectDelimiter("a,b,c\n1,2,3"), ",");
  assert.equal(P.detectDelimiter("a\tb\tc\n1\t2\t3"), "\t");
  assert.equal(P.detectDelimiter("a;b;c\n1;2;3"), ";");
  assert.equal(P.detectDelimiter("single"), ",");
});

test("finds the header row below a title and a blank row", () => {
  const grid = [["ACME Payroll Q3"], [""], ["Employee", "Hours worked", "Rate"], ["Dana", "1040", "21.5"]];
  assert.equal(P.guessHeaderRow(grid), 2);
});

test("guesses the columns of a typical payroll export", () => {
  const m = P.guessMap(["Employee", "Employee type", "Position",
    "Hours worked", "Holiday hours", "Vacation used", "Sick hours", "Hourly rate"]);
  assert.deepEqual(m, { name: 0, type: 1, hours: 3, holiday: 4, used: 5, leave: 6, payRate: 7 });
});

test("unmatched optional columns come back as -1 rather than a wrong guess", () => {
  const m = P.guessMap(["Employee", "Hours worked"]);
  assert.equal(m.name, 0);
  assert.equal(m.hours, 1);
  assert.equal(m.holiday, -1);
  assert.equal(m.used, -1);
  assert.equal(m.leave, -1);
  assert.equal(m.payRate, -1);
});

test("employee type is normalised, and anything unrecognised is flagged not guessed", () => {
  for (const word of ["Manager", "mgr", "Practice Manager", "supervisor", "exempt"]) {
    assert.deepEqual([word, P.normType(word).type, P.normType(word).recognised], [word, "manager", true]);
  }
  for (const word of ["Standard", "staff", "FT", "non-exempt", ""]) {
    assert.deepEqual([word, P.normType(word).type, P.normType(word).recognised], [word, "standard", true]);
  }
  // a job title is not an employee type: default to Standard, but say it was not understood
  const odd = P.normType("Medical Assistant");
  assert.equal(odd.type, "standard");
  assert.equal(odd.recognised, false);
  assert.equal(odd.raw, "Medical Assistant");
});

test("csvCell quotes only what needs quoting", () => {
  assert.equal(P.csvCell("Dana"), "Dana");
  assert.equal(P.csvCell("Whitfield, Dana"), '"Whitfield, Dana"');
  assert.equal(P.csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(P.csvCell(null), "");
});
