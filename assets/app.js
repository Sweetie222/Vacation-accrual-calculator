/**
 * Interface layer: wiring, rendering and file handling.
 * The calculations it calls live in accrual.js and payroll.js.
 */
(function(){
  "use strict";

  /* Logic lives in accrual.js and payroll.js; bind it into scope here.
     Everything below this block is interface: DOM, events and rendering. */
  var A = window.Accrual, P = window.Payroll;
  var nf = A.nf, trimNum = A.trimNum, money = A.money, num = A.num, sameNum = A.sameNum;
  var policyProblems = A.policyProblems, rateFor = A.rateFor, accrualBase = A.accrualBase;
  var basisWords = A.basisWords, compute = A.compute, nextDay = A.nextDay, totals = A.totals;
  var detectDelimiter = P.detectDelimiter, parseDelimited = P.parseDelimited;
  var guessHeaderRow = P.guessHeaderRow, guessMap = P.guessMap, normType = P.normType;
  var csvCell = P.csvCell;

  /* ---------- helpers ---------- */
  var $ = function(id){ return document.getElementById(id); };
  // Drop trailing zeros on settings-style numbers: 8 -> "8", 7.5 -> "7.5".
  var esc = function(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c];
    });
  };
  // Parse a human-typed number: "$1,040.50" -> 1040.5. NaN when nothing numeric.

  /* ---------- policy ---------- */
  var DEFAULTS = {stdAnnual:80, mgrAnnual:120, annualHours:2080, hoursPerDay:8, flagDays:15};
  var policyIds = ["stdAnnual","mgrAnnual","annualHours","hoursPerDay","flagDays"];

  function policy(){
    var p = {};
    policyIds.forEach(function(k){ p[k] = num($(k).value); });
    p.accrHoliday = $("accrHoliday").checked;
    p.accrVacation = $("accrVacation").checked;
    p.accrSick = $("accrSick").checked;
    return p;
  }
  // Every hour type the policy counts, added to the hours actually worked.

  function renderPolicy(){
    var p = policy();
    var problems = policyProblems(p);
    var ok = problems.length === 0;
    var rs = rateFor("standard", p), rm = rateFor("manager", p);

    $("rateInline").innerHTML = ok
      ? '<span>Standard <b>' + nf(rs,5) + '</b>/h</span><span>Manager <b>' + nf(rm,5) + '</b>/h</span><span><b>' + trimNum(p.hoursPerDay) + '</b> h per day</span><span>on <b>' + esc(basisWords(p)) + '</b></span>'
      : '<span style="color:var(--neg)">Settings need a fix</span>';

    var cards = [
      {k:"Standard accrual", annual:p.stdAnnual, rate:rs},
      {k:"Manager accrual", annual:p.mgrAnnual, rate:rm}
    ].map(function(c){
      var per = (isFinite(c.rate) && c.rate > 0) ? ("1 vacation hour per " + nf(1/c.rate, 1) + " hours worked") : "No accrual at this setting";
      return '<div class="derived-card"><div class="dk">' + c.k + '</div>' +
             '<div class="dv">' + (isFinite(c.rate) ? nf(c.rate,6) : "—") + ' <span>hrs / hr worked</span></div>' +
             '<div class="dsub">' + nf(c.annual,0) + ' ÷ ' + nf(p.annualHours,0) + ' &nbsp;·&nbsp; ' + per + '</div></div>';
    }).join("");
    var dayCard = '<div class="derived-card"><div class="dk">Full year, full time</div>' +
      '<div class="dv">' + (isFinite(p.stdAnnual/p.hoursPerDay) ? nf(p.stdAnnual/p.hoursPerDay,2) : "—") + ' <span>days standard</span></div>' +
      '<div class="dsub">' + (isFinite(p.mgrAnnual/p.hoursPerDay) ? nf(p.mgrAnnual/p.hoursPerDay,2) : "—") + ' days for a manager, at ' + trimNum(p.hoursPerDay) + ' h per day</div></div>';
    $("derived").innerHTML = ok ? (cards + dayCard) : "";

    $("policyNotices").innerHTML = problems.map(function(m){
      return '<div class="notice err">' + esc(m) + '</div>';
    }).join("");

    policyIds.forEach(function(k){
      var bad = (k === "annualHours" && (!isFinite(p.annualHours) || p.annualHours <= 0)) ||
                (k === "hoursPerDay" && (!isFinite(p.hoursPerDay) || p.hoursPerDay <= 0)) ||
                (!isFinite(p[k]) || p[k] < 0);
      $(k).setAttribute("aria-invalid", bad ? "true" : "false");
    });
    return ok;
  }

  /* ---------- core calculation ---------- */
  // Work still needed to reach the next whole vacation day.

  /* ---------- quick calculate ---------- */
  var qType = "standard";

  function quickInput(){
    return {
      name: $("qName").value.trim(),
      type: qType,
      hours: num($("qHours").value),
      holiday: num($("qHoliday").value),
      used: num($("qUsed").value),
      leave: num($("qLeave").value),
      payRate: num($("qRate").value)
    };
  }

  function renderQuick(){
    var p = policy(), ok = policyProblems(p).length === 0;
    var hoursRaw = $("qHours").value.trim();
    var q = quickInput();
    var badHours = hoursRaw !== "" && !isFinite(q.hours);
    var negHours = isFinite(q.hours) && q.hours < 0;
    var msg = $("qHoursMsg");

    if(badHours){
      msg.textContent = '"' + hoursRaw + '" is not a number of hours. Enter digits only, like 1040 or 1,040.5.';
      msg.hidden = false;
    } else if(negHours){
      msg.textContent = "Hours worked cannot be negative.";
      msg.hidden = false;
    } else {
      msg.hidden = true;
    }
    $("qHours").setAttribute("aria-invalid", (badHours || negHours) ? "true" : "false");

    var usable = ok && isFinite(q.hours) && q.hours >= 0;
    $("addBtn").disabled = !usable;

    var ov = $("overview");
    if(!usable){
      ov.innerHTML = '<p class="ov-empty">' +
        (ok ? "Enter the hours worked and this overview fills in."
            : "Fix the policy settings above and this overview fills in.") + "</p>";
      return;
    }

    var c = compute(q, p);
    var typeWord = q.type === "manager" ? "Manager" : "Standard";
    var baseDiffers = Math.abs(c.base - q.hours) > 1e-9;
    var hoursWord = "<b>" + esc(Number(baseDiffers ? c.base : q.hours).toLocaleString("en-US", {maximumFractionDigits:2})) + "</b> " +
                    (baseDiffers ? "accruing hours" : "hours worked");
    var who = q.name ? "<b>" + esc(q.name) + "</b>, a <b>" + typeWord + "</b> employee with " + hoursWord
                     : "a <b>" + typeWord + "</b> employee with " + hoursWord;

    var rows = [["Hours worked:", nf(q.hours,2) + " hours"]];
    if(isFinite(q.holiday)) rows.push(["Holiday:", nf(q.holiday,2) + " hours" + (p.accrHoliday ? "" : " — not counted")]);
    if(isFinite(q.used)) rows.push(["Vacation used:", nf(q.used,2) + " hours" + (p.accrVacation ? "" : " — not counted")]);
    if(isFinite(q.leave)) rows.push(["Sick / other leave:", nf(q.leave,2) + " hours" + (p.accrSick ? "" : " — not counted")]);
    if(Math.abs(c.base - q.hours) > 1e-9) rows.push(["Accrual base:", nf(c.base,2) + " hours"]);
    rows.push(["Accrual rate:", nf(c.rate,6) + " per hour"]);
    rows.push(["Accrued:", nf(c.accrued,2) + " hours"]);
    rows.push(["In days:", nf(c.accruedDays,2) + " days"]);
    if(isFinite(q.payRate)) rows.push(["Hourly rate:", money(q.payRate)]);

    var html = '<p class="ov-intro">For ' + who + ', this is the vacation accrued:</p>' +
      '<dl class="ov-list">' + rows.map(function(r){
        return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>";
      }).join("") + "</dl>" +
      '<p class="ov-lead">' + (c.balance < 0 ? "This employee has over-used by:" : "Balance owed:") + "</p>" +
      '<div class="ov-hero' + (c.balance < 0 ? " neg" : "") + '">' + nf(Math.abs(c.balance),2) + "</div>" +
      '<div class="ov-sub">hours &nbsp;·&nbsp; ' + nf(Math.abs(c.balanceDays),2) + " days" +
        (isFinite(c.liability) ? " &nbsp;·&nbsp; " + money(c.liability) + " liability" : "") + "</div>";

    var nd = nextDay(c.accrued, p, c.rate);
    html += '<div class="progress-box">';
    if(nd){
      html += '<div class="progress-head"><span class="ph-k">Work still needed for vacation day #' + nd.target + '</span>' +
              '<span class="ph-v">' + nf(nd.workNeeded,1) + " hours</span></div>" +
              '<div class="bar"><i style="width:' + (nd.frac*100).toFixed(1) + '%"></i></div>' +
              '<p class="progress-sub">Currently ' + nf(c.accruedDays,2) + " days accrued — " + (nd.frac*100).toFixed(0) +
              "% of the way to day " + nd.target + ". Measured on hours accrued, before any time used.</p>";
    } else {
      html += '<div class="progress-head"><span class="ph-k">Work still needed for the next full vacation day</span><span class="ph-v">—</span></div>' +
              '<div class="bar"><i style="width:0%"></i></div>' +
              '<p class="progress-sub">This type accrues nothing at the current policy settings.</p>';
    }
    html += "</div>";
    ov.innerHTML = html;
  }

  /* ---------- tabs ---------- */
  function setTab(which){
    var quick = which === "quick";
    $("tab-quick").setAttribute("aria-selected", quick ? "true" : "false");
    $("tab-upload").setAttribute("aria-selected", quick ? "false" : "true");
    $("panel-quick").hidden = !quick;
    $("panel-upload").hidden = quick;
  }

  /* ---------- file parsing ---------- */
  // RFC4180-ish: quoted fields, embedded delimiters and newlines, doubled quotes.
  // The header is the first of the opening rows that is as wide as the widest of them.

  /* ---------- column guessing ---------- */

  /* ---------- type normalisation ---------- */

  /* ---------- state ---------- */
  var state = {
    source: null, fileName: "", sheets: null, sheetName: "",
    grid: [], headerRow: 0, headers: [],
    map: {name:-1, hours:-1, type:-1, holiday:-1, used:-1, leave:-1, payRate:-1},
    rows: [],            // from a file or the sample
    manual: [],          // added one at a time from Quick calculate
    manualSeq: 0,
    edits: {},           // id -> changed fields, from the Type dropdown or the edit dialog
    deleted: {},         // id -> true, recoverable until the rows are rebuilt
    pendingNotices: [],
    sortKey: "balanceDays", sortDir: -1, query: ""
  };
  function allRowsRaw(){ return state.rows.concat(state.manual); }

  // File rows are keyed by position, so their edits cannot survive a re-map; added rows ("m") can.
  function clearFileEdits(){
    var hadAny = false;
    [state.edits, state.deleted].forEach(function(bag){
      Object.keys(bag).forEach(function(k){ if(k.charAt(0) === "r"){ delete bag[k]; hadAny = true; } });
    });
    return hadAny;
  }
  function baseById(id){
    var hit = null;
    allRowsRaw().forEach(function(r){ if(r.id === id) hit = r; });
    return hit;
  }
  // Rows as the user has left them: edits applied, removals taken out.
  function effectiveRows(){
    return allRowsRaw().filter(function(r){ return !state.deleted[r.id]; }).map(function(r){
      var e = state.edits[r.id];
      if(!e) return r;
      var out = {};
      Object.keys(r).forEach(function(k){ out[k] = r[k]; });
      if(e.name !== undefined) out.name = e.name;
      if(e.type !== undefined) out.type = e.type;
      if(e.hours !== undefined){ out.hours = e.hours; out.hoursOk = true; }
      if(e.holiday !== undefined) out.holiday = e.holiday;
      if(e.used !== undefined) out.used = e.used;
      if(e.leave !== undefined) out.leave = e.leave;
      if(e.payRate !== undefined) out.payRate = e.payRate;
      out.edited = true;
      return out;
    });
  }
  function effectiveById(id){
    var hit = null;
    effectiveRows().forEach(function(r){ if(r.id === id) hit = r; });
    return hit;
  }

  function notice(kind, html){ return '<div class="notice ' + kind + '">' + html + "</div>"; }
  function setNotices(id, list){ $(id).innerHTML = list.join(""); }

  /* ---------- file ingestion ---------- */
  function ingestFile(file){
    state.source = "file";
    state.fileName = file.name;
    state.sheets = null;
    state.sheetName = "";
    clearFileEdits();
    setNotices("uploadNotices", []);

    var isExcel = /\.(xlsx|xlsm|xls)$/.test(file.name.toLowerCase());
    var reader = new FileReader();
    reader.onerror = function(){
      setNotices("uploadNotices", [notice("err", "<b>That file could not be read.</b> It may be open in another program, or the browser was denied access. Try again, or save a fresh copy.")]);
    };

    if(isExcel){
      if(typeof XLSX === "undefined"){
        setNotices("uploadNotices", [notice("err", "<b>Excel support did not load</b> (the spreadsheet reader is fetched from a CDN). Open the file in Excel and use <b>File → Save As → CSV</b>, then drop the CSV here.")]);
        return;
      }
      reader.onload = function(e){
        var wb;
        try { wb = XLSX.read(new Uint8Array(e.target.result), {type:"array"}); }
        catch(err){
          setNotices("uploadNotices", [notice("err", "<b>That .xlsx could not be opened.</b> If it is password-protected or an older .xls, save it again as .xlsx or CSV.")]);
          return;
        }
        if(!wb.SheetNames || !wb.SheetNames.length){
          setNotices("uploadNotices", [notice("err", "<b>That workbook has no sheets.</b>")]);
          return;
        }
        state.sheets = wb;
        state.sheetName = wb.SheetNames[0];
        loadSheet();
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = function(e){
        var text = String(e.target.result || "");
        if(text.trim() === ""){
          setNotices("uploadNotices", [notice("err", "<b>That file is empty.</b> It has no rows to read.")]);
          return;
        }
        afterGrid(parseDelimited(text, detectDelimiter(text)));
      };
      reader.readAsText(file);
    }
  }

  function loadSheet(){
    var ws = state.sheets.Sheets[state.sheetName];
    var grid = XLSX.utils.sheet_to_json(ws, {header:1, blankrows:false, raw:true, defval:""});
    grid = grid.filter(function(r){ return r.some(function(c){ return String(c == null ? "" : c).trim() !== ""; }); });
    afterGrid(grid);
  }

  function afterGrid(grid){
    if(!grid.length){
      setNotices("uploadNotices", [notice("err", "<b>No rows found.</b> The file opened but every row was blank.")]);
      $("mapPanel").hidden = true;
      state.rows = [];
      renderResults();
      return;
    }
    var width = grid.reduce(function(m, r){ return Math.max(m, r.length); }, 0);
    grid = grid.map(function(r){
      var out = r.slice();
      while(out.length < width) out.push("");
      return out;
    });
    state.grid = grid;
    state.headerRow = guessHeaderRow(grid);
    state.headers = grid[state.headerRow].map(function(h, i){
      var s = String(h == null ? "" : h).trim();
      return s === "" ? ("Column " + (i + 1)) : s;
    });
    state.map = guessMap(state.headers);
    renderMapPanel();
    buildRows();
  }

  /* ---------- mapping UI ---------- */
  var MAP_FIELDS = [
    {key:"name",    label:"Employee name:", required:true},
    {key:"hours",   label:"Hours worked:",  required:true},
    {key:"type",    label:"Employee type:", note:"optional"},
    {key:"holiday", label:"Holiday hours:", note:"optional"},
    {key:"used",    label:"Vacation used:", note:"optional"},
    {key:"leave",   label:"Sick / other leave:", note:"optional"},
    {key:"payRate", label:"Hourly rate:",   note:"optional"}
  ];

  function renderMapPanel(){
    $("mapPanel").hidden = false;
    var dataRows = state.grid.length - state.headerRow - 1;
    $("fileChip").textContent = (state.source === "sample" ? "Sample data" : state.fileName) + " · " + dataRows + " rows";

    var html = MAP_FIELDS.map(function(f){
      var opts = '<option value="-1">' + (f.required ? "— choose a column —" : "— not in this file —") + "</option>";
      opts += state.headers.map(function(h, i){
        return '<option value="' + i + '"' + (state.map[f.key] === i ? " selected" : "") + ">" + esc(h) + "</option>";
      }).join("");
      return '<label class="fld"><span class="fld-label">' + esc(f.label) +
             (f.note ? ' <span class="fld-note">' + f.note + "</span>" : "") +
             '</span><select data-map="' + f.key + '">' + opts + "</select></label>";
    }).join("");

    var hrOpts = "";
    for(var i = 0; i < Math.min(10, state.grid.length); i++){
      var preview = state.grid[i].filter(function(c){ return String(c).trim() !== ""; }).slice(0,3).join(" | ");
      hrOpts += '<option value="' + i + '"' + (state.headerRow === i ? " selected" : "") + ">Row " + (i+1) + " — " + esc(preview.slice(0,40)) + "</option>";
    }
    html += '<label class="fld"><span class="fld-label">Header row:</span><select id="headerRowSel">' + hrOpts + "</select></label>";

    if(state.sheets && state.sheets.SheetNames.length > 1){
      var shOpts = state.sheets.SheetNames.map(function(n){
        return '<option value="' + esc(n) + '"' + (state.sheetName === n ? " selected" : "") + ">" + esc(n) + "</option>";
      }).join("");
      html += '<label class="fld"><span class="fld-label">Sheet:</span><select id="sheetSel">' + shOpts + "</select></label>";
    }

    $("mapGrid").innerHTML = html;

    $("mapGrid").querySelectorAll("select[data-map]").forEach(function(sel){
      sel.addEventListener("change", function(){
        state.map[sel.getAttribute("data-map")] = parseInt(sel.value, 10);
        buildRows();
      });
    });
    var hrSel = $("headerRowSel");
    if(hrSel) hrSel.addEventListener("change", function(){
      state.headerRow = parseInt(hrSel.value, 10);
      state.headers = state.grid[state.headerRow].map(function(h, i){
        var s = String(h == null ? "" : h).trim();
        return s === "" ? ("Column " + (i + 1)) : s;
      });
      state.map = guessMap(state.headers);
      renderMapPanel();
      buildRows();
    });
    var shSel = $("sheetSel");
    if(shSel) shSel.addEventListener("change", function(){
      state.sheetName = shSel.value;
      loadSheet();
    });
  }

  /* ---------- build rows from grid + mapping ---------- */
  function buildRows(){
    var m = state.map;
    var notices = [];

    if(m.name < 0 || m.hours < 0){
      state.rows = [];
      state.pendingNotices = [];
      var missing = [];
      if(m.name < 0) missing.push("employee name");
      if(m.hours < 0) missing.push("hours worked");
      setNotices("uploadNotices", [notice("info", "Choose which column holds the <b>" + missing.join("</b> and the <b>") + "</b> above, and the results appear below.")]);
      renderResults();
      return;
    }

    var body = state.grid.slice(state.headerRow + 1);
    var raw = [], badHours = [], unknownTypes = {}, blankNames = 0;

    body.forEach(function(r, idx){
      var name = String(r[m.name] == null ? "" : r[m.name]).trim();
      if(name === ""){ blankNames++; name = "(no name, row " + (state.headerRow + 2 + idx) + ")"; }

      var hoursCell = r[m.hours];
      var hours = num(hoursCell);
      var hoursOk = isFinite(hours);
      if(!hoursOk){
        var shown = String(hoursCell == null ? "" : hoursCell).trim();
        badHours.push(name + (shown === "" ? " (blank)" : ' ("' + shown + '")'));
      }

      var t = normType(m.type >= 0 ? r[m.type] : "");
      if(!t.recognised) unknownTypes[t.raw] = (unknownTypes[t.raw] || 0) + 1;

      raw.push({
        name: name, hours: hoursOk ? hours : 0, hoursOk: hoursOk,
        type: t.type, typeRaw: t.raw, typeRecognised: t.recognised,
        holiday: m.holiday >= 0 ? num(r[m.holiday]) : NaN,
        used: m.used >= 0 ? num(r[m.used]) : NaN,
        leave: m.leave >= 0 ? num(r[m.leave]) : NaN,
        payRate: m.payRate >= 0 ? num(r[m.payRate]) : NaN
      });
    });

    if(!raw.length){
      state.rows = [];
      state.pendingNotices = [];
      setNotices("uploadNotices", [notice("err", "<b>No data rows below the header.</b> Pick a different header row, or check the file.")]);
      renderResults();
      return;
    }

    var rows = raw;
    if($("combine").checked){
      var byName = {}, order = [];
      raw.forEach(function(r){
        var key = r.name.toLowerCase().replace(/\s+/g, " ");
        if(!byName[key]){
          byName[key] = {name:r.name, hours:0, hoursOk:true, type:r.type, typeRaw:r.typeRaw,
                         typeRecognised:r.typeRecognised, holiday:NaN, used:NaN, leave:NaN,
                         payRate:NaN, merged:0};
          order.push(key);
        }
        var a = byName[key];
        a.hours += r.hours;
        if(!r.hoursOk) a.hoursOk = false;
        if(isFinite(r.holiday)) a.holiday = (isFinite(a.holiday) ? a.holiday : 0) + r.holiday;
        if(isFinite(r.used)) a.used = (isFinite(a.used) ? a.used : 0) + r.used;
        if(isFinite(r.leave)) a.leave = (isFinite(a.leave) ? a.leave : 0) + r.leave;
        if(!isFinite(a.payRate) && isFinite(r.payRate)) a.payRate = r.payRate;
        if(a.typeRaw === "" && r.typeRaw !== ""){ a.type = r.type; a.typeRaw = r.typeRaw; a.typeRecognised = r.typeRecognised; }
        a.merged++;
      });
      rows = order.map(function(k){ return byName[k]; });
    }

    rows.forEach(function(r, i){ r.id = "r" + i; });
    state.rows = rows;

    // Row ids come from position in the file, so a re-map cannot carry edits across honestly.
    if(clearFileEdits()){
      notices.push(notice("warn", "<b>Edits and removals on the file's rows were cleared</b> because the columns or combining changed — the rows were rebuilt from the file. Rows you added by hand are untouched."));
    }

    // Report what actually happened to the data, row by row.
    if(badHours.length){
      notices.push(notice("warn", "<b>" + badHours.length + " row" + (badHours.length === 1 ? "" : "s") +
        " had hours we could not read</b> — counted as 0 hours: " + esc(badHours.slice(0,3).join(", ")) +
        (badHours.length > 3 ? " and " + (badHours.length - 3) + " more." : ".") +
        " Fix those cells in the file and drop it again."));
    }
    var unknownKeys = Object.keys(unknownTypes).filter(function(k){ return k !== ""; });
    if(unknownKeys.length){
      var total = unknownKeys.reduce(function(s,k){ return s + unknownTypes[k]; }, 0);
      notices.push(notice("warn", "<b>" + total + " row" + (total === 1 ? "" : "s") +
        " had an employee type we do not recognise</b> (" + esc(unknownKeys.slice(0,4).map(function(k){ return '"' + k + '"'; }).join(", ")) +
        ") — set to Standard. Change them in the Type column below."));
    }
    if(blankNames){
      notices.push(notice("warn", "<b>" + blankNames + " row" + (blankNames === 1 ? "" : "s") + " had no employee name</b> and are listed by their row number."));
    }
    if($("combine").checked){
      var mergedCount = rows.filter(function(r){ return r.merged > 1; }).length;
      notices.push(notice("info", mergedCount
        ? "<b>Combined by name:</b> " + raw.length + " rows became " + rows.length + " employees (" + mergedCount + " had more than one row)."
        : "<b>Combined by name:</b> every employee already had exactly one row — nothing was merged."));
    }
    if(state.source === "sample"){
      notices.unshift(notice("info", "<b>Sample data.</b> These four employees are invented — nothing here is from your practice. Drop a real file to replace them."));
    }

    setNotices("uploadNotices", []);
    state.pendingNotices = notices;
    renderResults();
  }

  /* ---------- results table ---------- */
  var COLS = [
    {key:"name",        label:"Employee",     kind:"text"},
    {key:"type",        label:"Type",         kind:"text"},
    {key:"hours",       label:"Worked hrs",   kind:"num", dp:2},
    {key:"holiday",     label:"Holiday hrs",  kind:"num", dp:2, when:"holiday"},
    {key:"used",        label:"Vac. used",    kind:"num", dp:2},
    {key:"leave",       label:"Other leave",  kind:"num", dp:2, when:"leave"},
    {key:"base",        label:"Accrual base", kind:"num", dp:2, when:"base"},
    {key:"accrued",     label:"Accrued hrs",  kind:"num", dp:2},
    {key:"accruedDays", label:"Accrued days", kind:"num", dp:2},
    {key:"balance",     label:"Balance hrs",  kind:"num", dp:2},
    {key:"balanceDays", label:"Balance days", kind:"num", dp:2},
    {key:"liability",   label:"Liability",    kind:"money", when:"rates"},
    {key:"actions",     label:"Actions",      kind:"actions"}
  ];
  // A column earns its width only when the data actually carries it.
  function activeCols(all){
    var has = {
      rates:   all.some(function(r){ return isFinite(r.payRate); }),
      holiday: all.some(function(r){ return isFinite(r.holiday) && r.holiday !== 0; }),
      leave:   all.some(function(r){ return isFinite(r.leave) && r.leave !== 0; }),
      base:    all.some(function(r){ return isFinite(r.base) && Math.abs(r.base - r.hours) > 1e-9; })
    };
    return COLS.filter(function(c){ return !c.when || has[c.when]; });
  }
  var ICON_EDIT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.6 2.4a1.4 1.4 0 0 1 2 2L6.2 11.8l-2.7.9.9-2.7 7.2-7.6z"/></svg>';
  var ICON_DEL = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.8 4.3h10.4M6.4 4.3V2.9h3.2v1.4M4.4 4.3l.6 8.8h6l.6-8.8M6.6 6.6v4.4M9.4 6.6v4.4"/></svg>';

  function decorate(){
    var p = policy();
    return effectiveRows().map(function(r){
      var c = compute(r, p);
      return {
        id:r.id, name:r.name, type:r.type, hours:r.hours, hoursOk:r.hoursOk !== false,
        merged:r.merged, added:!!r.added, edited:!!r.edited, payRate:r.payRate,
        holiday:c.holiday, leave:c.leave, base:c.base,
        accrued:c.accrued, accruedDays:c.accruedDays, used:c.used,
        balance:c.balance, balanceDays:c.balanceDays, liability:c.liability
      };
    });
  }

  function visibleRows(all){
    var q = state.query.trim().toLowerCase();
    var list = q ? all.filter(function(r){ return r.name.toLowerCase().indexOf(q) !== -1; }) : all.slice();
    var col = COLS.filter(function(c){ return c.key === state.sortKey; })[0] || COLS[0];
    list.sort(function(a, b){
      if(col.kind === "text") return String(a[col.key]).localeCompare(String(b[col.key])) * state.sortDir;
      var an = isFinite(a[col.key]) ? a[col.key] : -Infinity;
      var bn = isFinite(b[col.key]) ? b[col.key] : -Infinity;
      return (an - bn) * state.sortDir;
    });
    return list;
  }

  function renderResults(){
    saveState();
    if(!allRowsRaw().length){ $("resultsSection").hidden = true; return; }
    $("resultsSection").hidden = false;

    var p = policy(), ok = policyProblems(p).length === 0;
    var all = decorate();
    var cols = activeCols(all);

    var notices = (state.pendingNotices || []).slice();
    var delCount = 0;
    allRowsRaw().forEach(function(r){ if(state.deleted[r.id]) delCount++; });
    if(delCount){
      notices.push(notice("warn", "<b>" + delCount + " row" + (delCount === 1 ? "" : "s") +
        " removed from this report.</b> They are left out of the totals and the export. " +
        '<button type="button" class="link-btn" id="restoreBtn">Restore them</button>'));
    }
    if(!ok) notices.unshift(notice("err", "<b>Policy settings need a fix</b> — open <b>Policy settings</b> above. Until then these figures are not reliable."));
    setNotices("resultNotices", notices);
    if($("restoreBtn")) $("restoreBtn").addEventListener("click", function(){ state.deleted = {}; renderResults(); });

    $("thead").innerHTML = "<tr>" + cols.map(function(c){
      if(c.kind === "actions") return '<th data-key="actions" class="nosort" scope="col">' + esc(c.label) + "</th>";
      var active = state.sortKey === c.key;
      var arrow = active ? (state.sortDir === 1 ? "▲" : "▼") : "▲";
      return '<th data-key="' + c.key + '" scope="col"' + (active ? ' aria-sort="' + (state.sortDir === 1 ? "ascending" : "descending") + '"' : "") +
             ">" + esc(c.label) + '<span class="arrow">' + arrow + "</span></th>";
    }).join("") + "</tr>";

    var list = visibleRows(all);
    var flagAt = isFinite(p.flagDays) ? p.flagDays : Infinity;

    if(!list.length){
      var emptyMsg = all.length === 0
        ? "Every row has been removed from this report. Use “Restore them” above to bring them back."
        : "No employee matches “" + esc(state.query) + "”.";
      $("tbody").innerHTML = '<tr><td colspan="' + cols.length + '" class="empty">' + emptyMsg + "</td></tr>";
      $("tfoot").innerHTML = "";
    } else {
      $("tbody").innerHTML = list.map(function(r){
        var flagged = isFinite(r.balanceDays) && r.balanceDays > flagAt;
        var tds = cols.map(function(c){
          if(c.key === "name"){
            var pills = "";
            if(!r.hoursOk) pills += '<span class="pill">check hours</span>';
            if(r.merged > 1) pills += '<span class="pill added">' + r.merged + " rows</span>";
            if(r.added) pills += '<span class="pill added">added</span>';
            if(r.edited) pills += '<span class="pill added">edited</span>';
            return '<td class="name">' + esc(r.name) + pills + "</td>";
          }
          if(c.kind === "actions"){
            return '<td class="actions"><span class="row-actions">' +
              '<button type="button" class="icon-btn" data-edit="' + r.id + '" title="Edit ' + esc(r.name) + '" aria-label="Edit ' + esc(r.name) + '">' + ICON_EDIT + "</button>" +
              '<button type="button" class="icon-btn danger" data-del="' + r.id + '" title="Remove ' + esc(r.name) + ' from this report" aria-label="Remove ' + esc(r.name) + ' from this report">' + ICON_DEL + "</button>" +
              "</span></td>";
          }
          if(c.key === "type"){
            return '<td><select class="type-sel" data-id="' + r.id + '" aria-label="Employee type for ' + esc(r.name) + '">' +
                   '<option value="standard"' + (r.type === "standard" ? " selected" : "") + ">Standard</option>" +
                   '<option value="manager"' + (r.type === "manager" ? " selected" : "") + ">Manager</option></select></td>";
          }
          var v = r[c.key];
          var cls = (isFinite(v) && v < 0) ? "neg" : (!isFinite(v) ? "muted" : "");
          var text = c.kind === "money" ? (isFinite(v) ? money(v) : "—") : (isFinite(v) ? nf(v, c.dp) : "—");
          return '<td class="' + cls + '">' + esc(text) + "</td>";
        }).join("");
        return '<tr class="' + (flagged ? "flagged" : "") + '">' + tds + "</tr>";
      }).join("");

      var tot = totals(list);
      $("tfoot").innerHTML = "<tr>" + cols.map(function(c){
        if(c.key === "name") return "<td>Total — " + list.length + " employee" + (list.length === 1 ? "" : "s") + "</td>";
        if(c.key === "type" || c.kind === "actions") return "<td></td>";
        var v = tot[c.key];
        if(v == null || !isFinite(v)) return "<td></td>";
        return '<td class="' + (v < 0 ? "neg" : "") + '">' + esc(c.kind === "money" ? money(v) : nf(v, c.dp)) + "</td>";
      }).join("") + "</tr>";
    }

    $("tableWrap").classList.toggle("tall", list.length > 12);

    var totAll = totals(all);
    var flaggedCount = all.filter(function(r){ return isFinite(r.balanceDays) && r.balanceDays > flagAt; }).length;
    var stats = [
      {k:"Employees", v:String(all.length)},
      {k:"Accrued days", v:nf(totAll.accruedDays, 2)},
      {k:"Balance days owed", v:nf(totAll.balanceDays, 2)},
      {k:"Over " + trimNum(flagAt) + " days", v:String(flaggedCount)}
    ];
    if(isFinite(totAll.liability)) stats.push({k:"Dollar liability", v:money(totAll.liability)});
    $("stats").innerHTML = stats.map(function(s){
      return '<div class="stat"><div class="sk">' + esc(s.k) + '</div><div class="sv">' + esc(s.v) + "</div></div>";
    }).join("");

    $("rowCount").textContent = state.query.trim()
      ? list.length + " of " + all.length + " shown"
      : all.length + " employee" + (all.length === 1 ? "" : "s");
    $("resultsSub").textContent = "Standard " + nf(rateFor("standard", p), 5) + " · Manager " + nf(rateFor("manager", p), 5) +
      " per accruing hour · " + trimNum(p.hoursPerDay) + " h per day · accrues on " + basisWords(p);
    $("resultsTitle").textContent = (state.source === "sample" && !state.manual.length) ? "Results — sample data" : "Results";
    $("clearAddedBtn").hidden = !state.manual.length;

    $("tbody").querySelectorAll("select.type-sel").forEach(function(sel){
      sel.addEventListener("change", function(){
        var id = sel.getAttribute("data-id");
        var base = baseById(id);
        if(base){
          if(sel.value === base.type){ if(state.edits[id]) delete state.edits[id].type; }
          else { if(!state.edits[id]) state.edits[id] = {}; state.edits[id].type = sel.value; }
          if(state.edits[id] && !Object.keys(state.edits[id]).length) delete state.edits[id];
        }
        renderResults();
      });
    });
    $("tbody").querySelectorAll("button[data-edit]").forEach(function(b){
      b.addEventListener("click", function(){ openEdit(b.getAttribute("data-edit")); });
    });
    $("tbody").querySelectorAll("button[data-del]").forEach(function(b){
      b.addEventListener("click", function(){ state.deleted[b.getAttribute("data-del")] = true; renderResults(); });
    });
  }

  /* ---------- edit one row ---------- */
  var editingId = null, eType = "standard";
  function paintEType(){
    $("eStd").setAttribute("aria-pressed", eType === "standard" ? "true" : "false");
    $("eMgr").setAttribute("aria-pressed", eType === "manager" ? "true" : "false");
  }
  function showEMsg(text){ var m = $("eMsg"); m.textContent = text; m.hidden = false; }
  function closeEdit(){
    var d = $("editDlg");
    if(d.open){ try { d.close(); } catch(err){ d.removeAttribute("open"); } }
    editingId = null;
  }
  function openEdit(id){
    var r = effectiveById(id);
    if(!r) return;
    editingId = id;
    eType = r.type;
    $("eName").value = r.name;
    $("eHours").value = isFinite(r.hours) ? String(r.hours) : "";
    $("eHoliday").value = isFinite(r.holiday) ? String(r.holiday) : "";
    $("eUsed").value = isFinite(r.used) ? String(r.used) : "";
    $("eLeave").value = isFinite(r.leave) ? String(r.leave) : "";
    $("eRate").value = isFinite(r.payRate) ? String(r.payRate) : "";
    $("editDlgWho").textContent = r.added ? "Added by hand" : "From " + (state.source === "sample" ? "the sample data" : state.fileName);
    paintEType();
    $("eMsg").hidden = true;
    var d = $("editDlg");
    if(typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
    $("eName").focus();
  }
  function saveEdit(){
    var id = editingId;
    if(!id) return;
    var base = baseById(id);
    if(!base){ closeEdit(); return; }

    var hoursRaw = $("eHours").value.trim();
    var hours = num(hoursRaw);
    if(!isFinite(hours) || hours < 0){
      showEMsg(hoursRaw === "" ? "Enter the hours worked." : '"' + hoursRaw + '" is not a number of hours.');
      return;
    }
    var holidayRaw = $("eHoliday").value.trim();
    var holiday = holidayRaw === "" ? NaN : num(holidayRaw);
    if(holidayRaw !== "" && !isFinite(holiday)){ showEMsg('"' + holidayRaw + '" is not a number of holiday hours.'); return; }
    var usedRaw = $("eUsed").value.trim();
    var used = usedRaw === "" ? NaN : num(usedRaw);
    if(usedRaw !== "" && !isFinite(used)){ showEMsg('"' + usedRaw + '" is not a number of vacation hours.'); return; }
    var leaveRaw = $("eLeave").value.trim();
    var leave = leaveRaw === "" ? NaN : num(leaveRaw);
    if(leaveRaw !== "" && !isFinite(leave)){ showEMsg('"' + leaveRaw + '" is not a number of leave hours.'); return; }
    var rateRaw = $("eRate").value.trim();
    var rate = rateRaw === "" ? NaN : num(rateRaw);
    if(rateRaw !== "" && !isFinite(rate)){ showEMsg('"' + rateRaw + '" is not an hourly rate.'); return; }

    var name = $("eName").value.trim() || base.name;
    var e = {};
    if(name !== base.name) e.name = name;
    if(eType !== base.type) e.type = eType;
    if(hours !== base.hours) e.hours = hours;
    if(!sameNum(holiday, base.holiday)) e.holiday = holiday;
    if(!sameNum(used, base.used)) e.used = used;
    if(!sameNum(leave, base.leave)) e.leave = leave;
    if(!sameNum(rate, base.payRate)) e.payRate = rate;

    if(Object.keys(e).length) state.edits[id] = e; else delete state.edits[id];
    closeEdit();
    renderResults();
  }

  /* ---------- add one employee from Quick calculate ---------- */
  function addToTable(){
    var p = policy();
    if(policyProblems(p).length) return;
    var q = quickInput();
    if(!isFinite(q.hours) || q.hours < 0) return;

    state.manualSeq++;
    var name = q.name || ("Employee " + state.manualSeq);
    state.manual.push({
      id: "m" + state.manualSeq, name: name, hours: q.hours, hoursOk: true,
      type: q.type, holiday: q.holiday, used: q.used, leave: q.leave,
      payRate: q.payRate, added: true
    });
    renderResults();

    var msg = $("qAddMsg");
    msg.textContent = "Added " + name + " to the results table below.";
    msg.hidden = false;
    $("resultsSection").scrollIntoView({behavior:"smooth", block:"start"});
  }


  /* ---------- keeping the table between visits ----------
     Everything here stays on this computer. It is written to this browser's
     localStorage and read back on the next visit; it is never transmitted. */
  var STORE_KEY = "vacation-accrual-v1";
  var saveTimer = null, restoredAt = null;

  var CAN_STORE = (function(){
    try { localStorage.setItem("__probe", "1"); localStorage.removeItem("__probe"); return true; }
    catch(e){ return false; }   // private window, blocked site data, embedded frame
  })();

  // JSON turns NaN into null, and isFinite(null) is true — which would silently
  // convert "this column was not supplied" into a real zero. Tag it instead.
  function encNaN(k, v){ return (typeof v === "number" && !isFinite(v)) ? "__NaN__" : v; }
  function decNaN(k, v){ return v === "__NaN__" ? NaN : v; }

  function snapshot(){
    var pol = {};
    policyIds.forEach(function(k){ pol[k] = $(k).value; });
    return {
      v: 1, at: Date.now(),
      policy: pol,
      basis: { accrHoliday: $("accrHoliday").checked, accrVacation: $("accrVacation").checked, accrSick: $("accrSick").checked },
      combine: $("combine").checked,
      source: state.source, fileName: state.fileName,
      grid: state.grid, headerRow: state.headerRow, headers: state.headers, map: state.map,
      rows: state.rows, manual: state.manual, manualSeq: state.manualSeq,
      edits: state.edits, deleted: state.deleted
    };
  }

  function setSaveNote(text, bad){
    var el = $("saveNote");
    if(!el) return;
    el.textContent = text;
    el.style.color = bad ? "var(--neg)" : "var(--muted)";
  }

  function saveState(){
    if(!CAN_STORE) return;
    if(!$("keepData").checked) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){
      try {
        var json = JSON.stringify(snapshot(), encNaN);
        localStorage.setItem(STORE_KEY, json);
        setSaveNote("Kept on this computer · saved " + new Date().toLocaleTimeString() +
                    " · " + Math.round(json.length / 1024) + " KB");
      } catch(e){
        // QuotaExceededError on a very large payroll, or storage switched off mid-session
        setSaveNote("Could not save on this computer (" + ((e && e.name) || "error") +
                    "). Use Export CSV to keep this.", true);
      }
    }, 300);
  }

  function clearSaved(){
    try { localStorage.removeItem(STORE_KEY); } catch(e){}
  }

  function restoreState(){
    if(!CAN_STORE) return false;
    var json = null;
    try { json = localStorage.getItem(STORE_KEY); } catch(e){ return false; }
    if(!json) return false;
    var s;
    try { s = JSON.parse(json, decNaN); } catch(e){ clearSaved(); return false; }
    if(!s || s.v !== 1 || !s.rows) { clearSaved(); return false; }
    try {
      policyIds.forEach(function(k){ if(s.policy && s.policy[k] !== undefined) $(k).value = s.policy[k]; });
      if(s.basis){
        $("accrHoliday").checked = !!s.basis.accrHoliday;
        $("accrVacation").checked = !!s.basis.accrVacation;
        $("accrSick").checked = !!s.basis.accrSick;
      }
      $("combine").checked = !!s.combine;
      state.source = s.source; state.fileName = s.fileName || "";
      state.grid = s.grid || []; state.headerRow = s.headerRow || 0;
      state.headers = s.headers || [];
      if(s.map) state.map = s.map;
      state.rows = s.rows || []; state.manual = s.manual || []; state.manualSeq = s.manualSeq || 0;
      state.edits = s.edits || {}; state.deleted = s.deleted || {};
      restoredAt = s.at || null;
      if(state.grid.length) renderMapPanel();
      return (state.rows.length + state.manual.length) > 0;
    } catch(e){
      clearSaved();
      return false;
    }
  }

  /* ---------- export ---------- */
  function buildCSV(){
    var all = decorate();
    var hasRates = all.some(function(r){ return isFinite(r.payRate); });
    var cols = activeCols(all).filter(function(c){ return c.kind !== "actions"; });
    var list = visibleRows(all);
    var p = policy();

    var lines = [cols.map(function(c){ return csvCell(c.label); }).join(",")];
    list.forEach(function(r){
      lines.push(cols.map(function(c){
        if(c.key === "name") return csvCell(r.name);
        if(c.key === "type") return csvCell(r.type === "manager" ? "Manager" : "Standard");
        var v = r[c.key];
        return isFinite(v) ? v.toFixed(2) : "";
      }).join(","));
    });
    var tot = totals(list);
    lines.push(cols.map(function(c){
      if(c.key === "name") return csvCell("Total (" + list.length + " employees)");
      if(c.key === "type") return "";
      var v = tot[c.key];
      return (v == null || !isFinite(v)) ? "" : v.toFixed(2);
    }).join(","));

    lines.push("");
    lines.push(csvCell("Policy used"));
    lines.push([csvCell("Standard vacation hrs per year"), p.stdAnnual].join(","));
    lines.push([csvCell("Manager vacation hrs per year"), p.mgrAnnual].join(","));
    lines.push([csvCell("Full-time hrs per year"), p.annualHours].join(","));
    lines.push([csvCell("Hours per vacation day"), p.hoursPerDay].join(","));
    lines.push([csvCell("Hours that earn accrual"), csvCell(basisWords(p))].join(","));
    lines.push([csvCell("Standard accrual per hour worked"), rateFor("standard", p).toFixed(6)].join(","));
    lines.push([csvCell("Manager accrual per hour worked"), rateFor("manager", p).toFixed(6)].join(","));
    lines.push([csvCell("Generated"), csvCell(new Date().toLocaleString())].join(","));
    return lines.join("\r\n");
  }
  function stamp(){
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function showExportMsg(text, bad){
    var el = $("exportMsg");
    el.textContent = text;
    el.style.color = bad ? "var(--neg)" : "var(--muted)";
    el.hidden = false;
  }

  function doExport(){
    var csv = buildCSV();
    var filename = "vacation-accrual-" + stamp() + ".csv";
    var p = (window.claude && typeof window.claude.use === "function") ? window.claude.use("downloads") : Promise.resolve(null);
    Promise.resolve(p).then(function(dl){
      if(dl && typeof dl.save === "function"){
        return dl.save({filename:filename, data:csv}).then(function(){
          showExportMsg("Saved " + filename + ".", false);
        }, function(err){
          var code = err && err.code;
          if(code === "declined") showExportMsg("Export cancelled — nothing was saved.", false);
          else showExportMsg("The file could not be saved (" + (code || "unknown") + "). Use “Copy as CSV” and paste into a spreadsheet instead.", true);
        });
      }
      // Local / standalone copy of this page: fall back to an ordinary browser download.
      try {
        var blob = new Blob(["﻿" + csv], {type:"text/csv;charset=utf-8"});
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
        showExportMsg("Downloading " + filename + ". If nothing appeared, use “Copy as CSV”.", false);
      } catch(e){
        showExportMsg("Downloads are blocked here. Use “Copy as CSV” and paste into a spreadsheet.", true);
      }
    });
  }

  function doCopy(){
    var csv = buildCSV();
    var done = function(){ showExportMsg("Copied. Paste into a blank spreadsheet, then use Data → Text to Columns if it lands in one column.", false); };
    var fail = function(){ showExportMsg("The browser would not let the page copy. Select the table and copy it by hand.", true); };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(csv).then(done, fail);
    } else {
      try {
        var ta = document.createElement("textarea");
        ta.value = csv; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy") ? done() : fail();
        ta.remove();
      } catch(e){ fail(); }
    }
  }

  /* ---------- sample data ---------- */
  function loadSample(){
    state.source = "sample";
    state.fileName = "sample-payroll.csv";
    state.sheets = null;
    clearFileEdits();
    $("combine").checked = false;
    afterGrid([
      ["Employee", "Employee type", "Position", "Hours worked", "Holiday hours", "Vacation used", "Sick hours", "Hourly rate"],
      ["Dana Whitfield",  "Standard", "Front desk",         "1040", "64", "16",  "8", "21.50"],
      ["Marcus Oyelaran", "Standard", "Medical assistant",  "1872", "48", "40", "16", "24.75"],
      ["Priya Raman",     "Standard", "Billing specialist", "3460",  "0",  "0",  "0", "26.00"],
      ["Tomas Bergeron",  "Manager",  "Practice manager",   "2080", "64", "24",  "0", "38.00"]
    ]);
  }

  /* ---------- wiring ---------- */
  policyIds.forEach(function(k){
    $(k).addEventListener("input", function(){
      renderPolicy(); renderQuick(); renderResults(); saveState();
    });
  });
  ["accrHoliday","accrVacation","accrSick"].forEach(function(k){
    $(k).addEventListener("change", function(){
      renderPolicy(); renderQuick(); renderResults();
    });
  });
  $("resetPolicy").addEventListener("click", function(){
    policyIds.forEach(function(k){ $(k).value = DEFAULTS[k]; });
    ["accrHoliday","accrVacation","accrSick"].forEach(function(k){ $(k).checked = true; });
    renderPolicy(); renderQuick(); renderResults();
  });

  ["qName","qHours","qHoliday","qUsed","qLeave","qRate"].forEach(function(k){
    $(k).addEventListener("input", function(){ $("qAddMsg").hidden = true; renderQuick(); });
  });
  $("qStd").addEventListener("click", function(){ qType = "standard"; $("qStd").setAttribute("aria-pressed","true"); $("qMgr").setAttribute("aria-pressed","false"); renderQuick(); });
  $("qMgr").addEventListener("click", function(){ qType = "manager"; $("qMgr").setAttribute("aria-pressed","true"); $("qStd").setAttribute("aria-pressed","false"); renderQuick(); });
  $("addBtn").addEventListener("click", addToTable);
  $("clearAddedBtn").addEventListener("click", function(){
    state.manual.forEach(function(r){ delete state.edits[r.id]; delete state.deleted[r.id]; });
    state.manual = [];
    $("qAddMsg").hidden = true;
    renderResults();
  });

  $("tab-quick").addEventListener("click", function(){ setTab("quick"); });
  $("tab-upload").addEventListener("click", function(){ setTab("upload"); });

  var drop = $("drop");
  ["dragenter","dragover"].forEach(function(ev){
    drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.add("over"); });
  });
  ["dragleave","dragend","drop"].forEach(function(ev){
    drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.remove("over"); });
  });
  drop.addEventListener("drop", function(e){
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if(f) ingestFile(f);
  });
  $("browseBtn").addEventListener("click", function(){ $("fileInput").click(); });
  $("fileInput").addEventListener("change", function(e){
    var f = e.target.files && e.target.files[0];
    if(f) ingestFile(f);
    e.target.value = "";
  });
  $("sampleBtn").addEventListener("click", loadSample);
  $("combine").addEventListener("change", buildRows);

  $("search").addEventListener("input", function(e){ state.query = e.target.value; renderResults(); });
  $("thead").addEventListener("click", function(e){
    var th = e.target.closest("th");
    if(!th) return;
    var key = th.getAttribute("data-key");
    if(!key || key === "actions") return;
    if(state.sortKey === key) state.sortDir = -state.sortDir;
    else { state.sortKey = key; state.sortDir = (key === "name" || key === "type") ? 1 : -1; }
    renderResults();
  });
  $("exportBtn").addEventListener("click", doExport);
  $("copyBtn").addEventListener("click", doCopy);

  $("eStd").addEventListener("click", function(){ eType = "standard"; paintEType(); });
  $("eMgr").addEventListener("click", function(){ eType = "manager"; paintEType(); });
  $("eSave").addEventListener("click", saveEdit);
  $("eCancel").addEventListener("click", closeEdit);
  $("eDelete").addEventListener("click", function(){
    if(!editingId) return;
    state.deleted[editingId] = true;
    closeEdit();
    renderResults();
  });
  $("editDlg").addEventListener("cancel", function(){ editingId = null; });
  $("editDlg").addEventListener("click", function(e){ if(e.target === $("editDlg")) closeEdit(); });
  ["eName","eHoliday","eHours","eUsed","eLeave","eRate"].forEach(function(k){
    $(k).addEventListener("keydown", function(e){ if(e.key === "Enter"){ e.preventDefault(); saveEdit(); } });
  });

  $("keepData").addEventListener("change", function(){
    if($("keepData").checked){ saveState(); }
    else { clearSaved(); setSaveNote("Not kept — this table is gone when you reload."); }
  });
  $("clearSaved").addEventListener("click", function(){
    clearSaved();
    $("keepData").checked = false;
    setSaveNote("Saved copy deleted. What is on screen stays until you reload.");
  });

  // Theme: the chosen theme is not stored; it follows the system on each visit.
  var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  function paintThemeBtn(){ $("themeBtn").textContent = dark ? "Light mode" : "Dark mode"; }
  $("themeBtn").addEventListener("click", function(){
    dark = !dark;
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    paintThemeBtn();
  });
  paintThemeBtn();

  if(!CAN_STORE){
    $("keepData").checked = false;
    $("keepData").disabled = true;
    setSaveNote("This browser is blocking local storage, so nothing can be kept here.");
  }

  var restored = restoreState();
  renderPolicy();
  renderQuick();
  if(restored){
    state.pendingNotices = [notice("info",
      "<b>Picked up where you left off.</b> This table was restored from this computer" +
      (restoredAt ? ", saved " + new Date(restoredAt).toLocaleString() : "") +
      ". It has never left your browser.")];
  }
  renderResults();
})();
