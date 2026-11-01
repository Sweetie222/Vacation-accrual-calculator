"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../assets/accrual.js");

/** The defaults the app ships with: 80 h/yr standard, 120 h/yr manager, 2080 h/yr full time. */
const ALL_PAID = {
  stdAnnual: 80, mgrAnnual: 120, annualHours: 2080, hoursPerDay: 8, flagDays: 15,
  accrHoliday: true, accrVacation: true, accrSick: true
};
const WORKED_ONLY = Object.assign({}, ALL_PAID,
  { accrHoliday: false, accrVacation: false, accrSick: false });

const cents = n => Number(n.toFixed(2));

test("the rate is the exact fraction, never a rounded constant", () => {
  assert.equal(A.rateFor("standard", ALL_PAID), 80 / 2080);
  assert.equal(A.rateFor("manager", ALL_PAID), 120 / 2080);
  // the plain-English form the UI shows: 1 vacation hour per 26 hours worked
  assert.equal(1 / A.rateFor("standard", ALL_PAID), 26);
});

test("a full-time year earns exactly the annual allowance", () => {
  assert.equal(A.compute({ type: "standard", hours: 2080 }, WORKED_ONLY).accrued, 80);
  assert.equal(A.compute({ type: "manager", hours: 2080 }, WORKED_ONLY).accrued, 120);
  assert.equal(A.compute({ type: "standard", hours: 2080 }, WORKED_ONLY).accruedDays, 10);
});

test("a part-timer accrues at the same rate on fewer hours", () => {
  const full = A.compute({ type: "standard", hours: 2080 }, WORKED_ONLY);
  const half = A.compute({ type: "standard", hours: 1040 }, WORKED_ONLY);
  assert.equal(half.rate, full.rate);
  assert.equal(half.accrued, full.accrued / 2);
});

test("the accrual base adds only the hour types the policy counts", () => {
  const row = { type: "standard", hours: 1040, holiday: 64, used: 16, leave: 8 };
  assert.equal(A.accrualBase(row, ALL_PAID), 1128);
  assert.equal(A.accrualBase(row, WORKED_ONLY), 1040);
  assert.equal(A.accrualBase(row, Object.assign({}, ALL_PAID, { accrHoliday: false })), 1064);
  assert.equal(A.accrualBase(row, Object.assign({}, ALL_PAID, { accrVacation: false })), 1112);
});

test("a missing hour column is treated as absent, not as zero-that-breaks-the-sum", () => {
  const row = { type: "standard", hours: 1000, holiday: NaN, used: NaN, leave: NaN };
  assert.equal(A.accrualBase(row, ALL_PAID), 1000);
});

test("balance subtracts vacation used and may go negative when over-used", () => {
  const r = A.compute({ type: "standard", hours: 1040, used: 48 }, WORKED_ONLY);
  assert.equal(r.accrued, 40);
  assert.equal(r.balance, -8);
  assert.equal(r.balanceDays, -1);
});

test("dollar liability exists only when an hourly rate was supplied", () => {
  const withRate = A.compute({ type: "standard", hours: 1040, used: 16, payRate: 21.5 }, WORKED_ONLY);
  assert.equal(cents(withRate.liability), 516);
  assert.ok(Number.isNaN(A.compute({ type: "standard", hours: 1040 }, WORKED_ONLY).liability));
});

test("work still needed for the next whole vacation day", () => {
  const r = A.compute({ type: "standard", hours: 1320 }, WORKED_ONLY);
  const nd = A.nextDay(r.accrued, WORKED_ONLY, r.rate);
  assert.equal(nd.target, 7);                       // 6.35 days accrued -> day 7 next
  assert.equal(Number(nd.workNeeded.toFixed(1)), 136);
  // landing exactly on a whole day points at the following one, not the current one
  const exact = A.compute({ type: "standard", hours: 2080 }, WORKED_ONLY);
  assert.equal(A.nextDay(exact.accrued, WORKED_ONLY, exact.rate).target, 11);
});

test("policy problems catch the divide-by-zero settings", () => {
  assert.equal(A.policyProblems(ALL_PAID).length, 0);
  assert.ok(A.policyProblems(Object.assign({}, ALL_PAID, { annualHours: 0 })).length > 0);
  assert.ok(A.policyProblems(Object.assign({}, ALL_PAID, { hoursPerDay: 0 })).length > 0);
  assert.ok(A.policyProblems(Object.assign({}, ALL_PAID, { stdAnnual: -1 })).length > 0);
});

test("numbers are read the way payroll exports write them", () => {
  assert.equal(A.num("1,040.50"), 1040.5);
  assert.equal(A.num("$24.75"), 24.75);
  assert.equal(A.num(" 37.5 "), 37.5);
  assert.equal(A.num("(8)"), -8);
  assert.equal(A.num(40), 40);
  for (const bad of ["", "n/a", "—", null, undefined]) {
    assert.ok(Number.isNaN(A.num(bad)), JSON.stringify(bad) + " should not parse");
  }
});

test("basisWords names the hour types actually in force", () => {
  assert.equal(A.basisWords(WORKED_ONLY), "hours worked");
  assert.equal(A.basisWords(ALL_PAID),
    "hours worked + holiday + vacation taken + sick / other paid leave");
});

test("the sample payroll totals, end to end", () => {
  const staff = [
    { type: "standard", hours: 1040, holiday: 64, used: 16, leave: 8, payRate: 21.50 },
    { type: "standard", hours: 1872, holiday: 48, used: 40, leave: 16, payRate: 24.75 },
    { type: "standard", hours: 3460, holiday: 0, used: 0, leave: 0, payRate: 26.00 },
    { type: "manager", hours: 2080, holiday: 64, used: 24, leave: 0, payRate: 38.00 }
  ];
  const rows = staff.map(r => Object.assign({ hours: r.hours }, A.compute(r, ALL_PAID)));
  const t = A.totals(rows);
  assert.equal(t.base, 8732);
  assert.equal(cents(t.accrued), 377.54);
  assert.equal(cents(t.balance), 297.54);
  assert.equal(cents(t.balanceDays), 37.19);
  assert.equal(cents(t.liability), 8780.69);

  // the strict basis reproduces the hours-worked-only figures
  const strict = A.totals(staff.map(r => Object.assign({ hours: r.hours }, A.compute(r, WORKED_ONLY))));
  assert.equal(strict.base, 8452);
  assert.equal(cents(strict.accrued), 365.08);
  assert.equal(cents(strict.liability), 8416);
});

test("totals report NaN for a column no row supplied, not a misleading zero", () => {
  const rows = [Object.assign({ hours: 100 }, A.compute({ type: "standard", hours: 100 }, WORKED_ONLY))];
  assert.ok(Number.isNaN(A.totals(rows).liability));
});
