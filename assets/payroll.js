/**
 * Reading a payroll export — delimited parsing, header detection, column guessing
 * and employee-type normalisation. No DOM, so it can be unit tested in Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Payroll = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function detectDelimiter(text){
    var line = text.split(/\r\n|\n|\r/).find(function(l){ return l.trim() !== ""; }) || "";
    var counts = [[",", (line.match(/,/g)||[]).length], ["\t", (line.match(/\t/g)||[]).length], [";", (line.match(/;/g)||[]).length]];
    counts.sort(function(a,b){ return b[1]-a[1]; });
    return counts[0][1] > 0 ? counts[0][0] : ",";
  }

  function parseDelimited(text, delim){
    if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], row = [], field = "", inQ = false, i = 0;
    while(i < text.length){
      var ch = text[i];
      if(inQ){
        if(ch === '"'){
          if(text[i+1] === '"'){ field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if(ch === '"'){ inQ = true; i++; continue; }
      if(ch === delim){ row.push(field); field = ""; i++; continue; }
      if(ch === "\r"){ i++; continue; }
      if(ch === "\n"){ row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += ch; i++;
    }
    row.push(field);
    rows.push(row);
    return rows.filter(function(r){ return r.some(function(c){ return String(c).trim() !== ""; }); });
  }

  function guessHeaderRow(rows){
    var look = Math.min(8, rows.length), best = 0, bestCount = -1;
    for(var i = 0; i < look; i++){
      var count = rows[i].filter(function(c){ return String(c).trim() !== ""; }).length;
      if(count > bestCount){ bestCount = count; best = i; }
    }
    return best;
  }

  var GUESS = {
    used:    /(vac|pto|annual ?leave).*(used|taken|hrs|hours)?|^(used|taken)$|hours? ?used|used ?hours?/i,
    holiday: /holiday|stat(utory)? ?pay|^hol$/i,
    leave:   /sick|personal ?(day|hour|leave)|bereav|jury|other ?(paid )?leave|paid ?leave/i,
    payRate: /hourly|pay ?rate|^rate$|wage|per ?hour/i,
    type:    /type|role|class|category|position|title|level|status|exempt/i,
    name:    /employee|name|staff|worker|person|full ?name/i,
    hours:   /hours? ?worked|worked|total ?hours|^hours?$|^hrs$|reg(ular)? ?hours|paid ?hours/i
  };

  function guessMap(headers){
    var taken = {}, map = {name:-1, hours:-1, type:-1, holiday:-1, used:-1, leave:-1, payRate:-1};
    ["used","holiday","leave","payRate","type","name","hours"].forEach(function(key){
      for(var i = 0; i < headers.length; i++){
        if(taken[i]) continue;
        if(GUESS[key].test(String(headers[i]))){ map[key] = i; taken[i] = true; return; }
      }
    });
    return map;
  }

  var MANAGER_WORDS = /^(m|mgr|manager|management|supervisor|super|lead|director|admin(istrator)?|practice ?manager|office ?manager|exempt)$/i;

  var STANDARD_WORDS = /^(s|std|standard|staff|employee|emp|regular|reg|non-?exempt|hourly|full-?time|ft|part-?time|pt)$/i;

  function normType(raw){
    var s = String(raw == null ? "" : raw).trim();
    if(s === "") return {type:"standard", recognised:true, raw:s};
    if(MANAGER_WORDS.test(s)) return {type:"manager", recognised:true, raw:s};
    if(STANDARD_WORDS.test(s)) return {type:"standard", recognised:true, raw:s};
    return {type:"standard", recognised:false, raw:s};
  }

  function csvCell(v){
    var s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  return {
    detectDelimiter: detectDelimiter,
    parseDelimited: parseDelimited,
    guessHeaderRow: guessHeaderRow,
    GUESS: GUESS,
    guessMap: guessMap,
    MANAGER_WORDS: MANAGER_WORDS,
    STANDARD_WORDS: STANDARD_WORDS,
    normType: normType,
    csvCell: csvCell
  };
});
