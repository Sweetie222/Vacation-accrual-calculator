/**
 * Accrual maths — no DOM, no browser APIs, so it can be unit tested in Node.
 *
 * A "policy" object is: {stdAnnual, mgrAnnual, annualHours, hoursPerDay, flagDays,
 * accrHoliday, accrVacation, accrSick}. A "row" is: {type, hours, holiday, used,
 * leave, payRate} where any hour field may be NaN for "not supplied".
 *
 * The accrual rate is always the exact fraction (e.g. 80/2080), never a rounded
 * decimal, so a full-time year lands on the annual allowance to the cent.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Accrual = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var nf = function(n, d){
    if(!isFinite(n)) return "—";
    return n.toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d});
  };

  var trimNum = function(n){ return isFinite(n) ? String(parseFloat(n.toFixed(2))) : "—"; };

  var money = function(n){
    if(!isFinite(n)) return "—";
    return n.toLocaleString("en-US", {style:"currency", currency:"USD"});
  };

  var num = function(v){
    if(typeof v === "number") return isFinite(v) ? v : NaN;
    if(v == null) return NaN;
    var s = String(v).trim();
    if(s === "") return NaN;
    var neg = /^\(.*\)$/.test(s);
    s = s.replace(/[()]/g, "").replace(/[$,\s]/g, "").replace(/[^0-9.\-]/g, "");
    if(s === "" || s === "-" || s === ".") return NaN;
    var n = parseFloat(s);
    if(!isFinite(n)) return NaN;
    return neg ? -n : n;
  };

  function sameNum(a, b){ return (!isFinite(a) && !isFinite(b)) || a === b; }

  function policyProblems(p){
    var out = [];
    if(!isFinite(p.annualHours) || p.annualHours <= 0) out.push("Full-time hours per year must be more than 0 — the accrual rate is divided by it.");
    if(!isFinite(p.hoursPerDay) || p.hoursPerDay <= 0) out.push("Hours per vacation day must be more than 0 — days are accrued hours divided by it.");
    if(!isFinite(p.stdAnnual) || p.stdAnnual < 0) out.push("Standard vacation hours per year must be a number, 0 or more.");
    if(!isFinite(p.mgrAnnual) || p.mgrAnnual < 0) out.push("Manager vacation hours per year must be a number, 0 or more.");
    if(!isFinite(p.flagDays) || p.flagDays < 0) out.push("The flag threshold must be a number of days, 0 or more.");
    return out;
  }

  function rateFor(type, p){
    var annual = type === "manager" ? p.mgrAnnual : p.stdAnnual;
    if(!isFinite(annual) || !isFinite(p.annualHours) || p.annualHours <= 0) return NaN;
    return annual / p.annualHours;   // exact fraction, e.g. 80/2080
  }

  function accrualBase(row, p){
    var b = isFinite(row.hours) ? row.hours : 0;
    if(p.accrHoliday && isFinite(row.holiday)) b += row.holiday;
    if(p.accrVacation && isFinite(row.used)) b += row.used;
    if(p.accrSick && isFinite(row.leave)) b += row.leave;
    return b;
  }

  function basisWords(p){
    var parts = ["hours worked"];
    if(p.accrHoliday) parts.push("holiday");
    if(p.accrVacation) parts.push("vacation taken");
    if(p.accrSick) parts.push("sick / other paid leave");
    return parts.join(" + ");
  }

  function compute(row, p){
    var rate = rateFor(row.type, p);
    var used = isFinite(row.used) ? row.used : 0;
    var base = accrualBase(row, p);
    var accrued = base * rate;
    var balance = accrued - used;
    return {
      rate: rate,
      base: base,
      holiday: isFinite(row.holiday) ? row.holiday : NaN,
      leave: isFinite(row.leave) ? row.leave : NaN,
      accrued: accrued,
      accruedDays: accrued / p.hoursPerDay,
      used: used,
      balance: balance,
      balanceDays: balance / p.hoursPerDay,
      liability: isFinite(row.payRate) ? balance * row.payRate : NaN
    };
  }

  function nextDay(accrued, p, rate){
    if(!(rate > 0) || !(p.hoursPerDay > 0) || !isFinite(accrued)) return null;
    var days = accrued / p.hoursPerDay;
    var whole = Math.floor(days + 1e-9);
    var target = whole + 1;
    var vacHoursToGo = target * p.hoursPerDay - accrued;
    return {target:target, workNeeded: vacHoursToGo / rate, frac: Math.max(0, Math.min(1, days - whole))};
  }

  var TOTAL_KEYS = ["hours","holiday","used","leave","base","accrued","accruedDays","balance","balanceDays","liability"];

  function totals(list){
    var t = {}, any = {};
    TOTAL_KEYS.forEach(function(k){ t[k] = 0; any[k] = false; });
    list.forEach(function(r){
      TOTAL_KEYS.forEach(function(k){ if(isFinite(r[k])){ t[k] += r[k]; any[k] = true; } });
    });
    TOTAL_KEYS.forEach(function(k){ if(!any[k]) t[k] = NaN; });
    return t;
  }

  return {
    nf: nf,
    trimNum: trimNum,
    money: money,
    num: num,
    sameNum: sameNum,
    policyProblems: policyProblems,
    rateFor: rateFor,
    accrualBase: accrualBase,
    basisWords: basisWords,
    compute: compute,
    nextDay: nextDay,
    TOTAL_KEYS: TOTAL_KEYS,
    totals: totals
  };
});
