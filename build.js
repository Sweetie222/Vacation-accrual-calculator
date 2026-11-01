#!/usr/bin/env node
"use strict";
/**
 * Inlines the stylesheet and scripts into one self-contained HTML file in dist/.
 *
 * The split source is what you edit; the single file is what you hand to someone
 * who just wants to double-click it or keep a copy on a shared drive. Only the
 * two CDN tags (the web font and the .xlsx reader) stay external.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const read = p => fs.readFileSync(path.join(root, p), "utf8");

let html = read("index.html");

html = html.replace(
  '<link rel="stylesheet" href="assets/styles.css">',
  "<style>\n" + read("assets/styles.css").trim() + "\n</style>"
);

for (const file of ["assets/accrual.js", "assets/payroll.js", "assets/app.js"]) {
  const tag = '<script src="' + file + '"></script>';
  if (!html.includes(tag)) throw new Error("no script tag for " + file + " in index.html");
  html = html.replace(tag, "<script>\n" + read(file).trim() + "\n</script>");
}

if (html.includes('src="assets/') || html.includes('href="assets/')) {
  throw new Error("a local asset was left un-inlined");
}

const outDir = path.join(root, "dist");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "vacation-accrual-calculator.html");
fs.writeFileSync(out, html);
console.log("wrote " + path.relative(root, out) + "  (" + (html.length / 1024).toFixed(1) + " KB)");
