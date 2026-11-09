// i18n missing-key check (v2.1).
// Verifies, for public/shared.js (rider/driver/landing) and public/admin.js:
//  1. every STRINGS key exists in BOTH en and ur (no one-sided key),
//  2. NOTIF_TEMPLATES has the same types in en and ur, and the same types
//     in both files (rider/driver and admin render the same notification feed),
//  3. ERR_MAP keys are identical in both files (admin toasts translate
//     exactly like rider/driver toasts),
//  4. every data-i18n="key" used in an HTML page exists in that page's
//     dictionary, and every literal t("key") call in JS exists in the
//     file's dictionary.
// Exit 0 when zero missing keys, 1 otherwise (lists every gap).
import fs from "node:fs";
import vm from "node:vm";

function extractLiteral(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error("marker not found: " + marker);
  const brace = src.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(brace, i + 1); }
  }
  throw new Error("unbalanced braces after " + marker);
}

function evalObj(literal) {
  return vm.runInNewContext("(" + literal + ")");
}

function keysOf(obj) { return new Set(Object.keys(obj || {})); }

const failures = [];
function fail(msg) { failures.push(msg); }

const sharedSrc = fs.readFileSync("public/shared.js", "utf8");
const adminSrc = fs.readFileSync("public/admin.js", "utf8");

const sharedStrings = evalObj(extractLiteral(sharedSrc, "const STRINGS = "));
const adminStrings = evalObj(extractLiteral(adminSrc, "const STRINGS = "));
const sharedNotif = evalObj(extractLiteral(sharedSrc, "const NOTIF_TEMPLATES = "));
const adminNotif = evalObj(extractLiteral(adminSrc, "const NOTIF_TEMPLATES = "));
const sharedErr = evalObj(extractLiteral(sharedSrc, "const ERR_MAP = "));
const adminErr = evalObj(extractLiteral(adminSrc, "const ERR_MAP = "));

// 1. STRINGS en/ur parity per file.
for (const [name, dict] of [["shared.js", sharedStrings], ["admin.js", adminStrings]]) {
  const en = keysOf(dict.en), ur = keysOf(dict.ur);
  for (const k of en) if (!ur.has(k)) fail(`${name} STRINGS: key "${k}" in en but missing in ur`);
  for (const k of ur) if (!en.has(k)) fail(`${name} STRINGS: key "${k}" in ur but missing in en`);
}

// 2. NOTIF_TEMPLATES en/ur parity + cross-file parity.
for (const [name, dict] of [["shared.js", sharedNotif], ["admin.js", adminNotif]]) {
  const en = keysOf(dict.en), ur = keysOf(dict.ur);
  for (const k of en) if (!ur.has(k)) fail(`${name} NOTIF_TEMPLATES: type "${k}" in en but missing in ur`);
  for (const k of ur) if (!en.has(k)) fail(`${name} NOTIF_TEMPLATES: type "${k}" in ur but missing in en`);
  for (const k of en) {
    for (const part of ["title", "body"]) {
      if (!dict.en[k] || dict.en[k][part] == null) fail(`${name} NOTIF_TEMPLATES: "${k}" missing en ${part}`);
      if (!dict.ur[k] || dict.ur[k][part] == null) fail(`${name} NOTIF_TEMPLATES: "${k}" missing ur ${part}`);
    }
  }
}
for (const k of keysOf(sharedNotif.en)) if (!adminNotif.en[k]) fail(`NOTIF_TEMPLATES: type "${k}" in shared.js but missing in admin.js`);
for (const k of keysOf(adminNotif.en)) if (!sharedNotif.en[k]) fail(`NOTIF_TEMPLATES: type "${k}" in admin.js but missing in shared.js`);

// 3. ERR_MAP parity between the two files.
for (const k of keysOf(sharedErr)) if (!adminErr[k]) fail(`ERR_MAP: "${k}" in shared.js but missing in admin.js`);
for (const k of keysOf(adminErr)) if (!sharedErr[k]) fail(`ERR_MAP: "${k}" in admin.js but missing in shared.js`);
for (const k of keysOf(sharedErr)) {
  if (!sharedErr[k].en || !sharedErr[k].ur) fail(`ERR_MAP shared.js: "${k}" missing en/ur text`);
  if (adminErr[k] && (!adminErr[k].en || !adminErr[k].ur)) fail(`ERR_MAP admin.js: "${k}" missing en/ur text`);
}

// 4. data-i18n usage in HTML + literal t("key") calls in JS.
const pageDict = {
  "public/index.html": sharedStrings, "public/rider.html": sharedStrings,
  "public/driver.html": sharedStrings, "public/admin.html": adminStrings,
};
for (const [file, dict] of Object.entries(pageDict)) {
  const html = fs.readFileSync(file, "utf8");
  const en = keysOf(dict.en);
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) {
    if (!en.has(m[1])) fail(`${file}: data-i18n="${m[1]}" has no STRINGS key`);
  }
  for (const m of html.matchAll(/data-i18n-ph="([^"]+)"/g)) {
    if (!en.has(m[1])) fail(`${file}: data-i18n-ph="${m[1]}" has no STRINGS key`);
  }
}
const jsDict = { "public/shared.js": sharedStrings, "public/rider.js": sharedStrings, "public/driver.js": sharedStrings, "public/admin.js": adminStrings };
for (const [file, dict] of Object.entries(jsDict)) {
  const src = fs.readFileSync(file, "utf8");
  const en = keysOf(dict.en);
  for (const m of src.matchAll(/(?<![A-Za-z0-9_$.])t\("([^"]+)"\s*[,)]/g)) {
    if (!en.has(m[1])) fail(`${file}: t("${m[1]}") has no STRINGS key`);
  }
  for (const m of src.matchAll(/(?<![A-Za-z0-9_$.])t\('([^']+)'\s*[,)]/g)) {
    if (!en.has(m[1])) fail(`${file}: t('${m[1]}') has no STRINGS key`);
  }
}

console.log(`STRINGS shared.js: ${Object.keys(sharedStrings.en).length} en / ${Object.keys(sharedStrings.ur).length} ur keys`);
console.log(`STRINGS admin.js:  ${Object.keys(adminStrings.en).length} en / ${Object.keys(adminStrings.ur).length} ur keys`);
console.log(`NOTIF_TEMPLATES:   ${Object.keys(sharedNotif.en).length} types (shared) / ${Object.keys(adminNotif.en).length} types (admin)`);
console.log(`ERR_MAP:           ${Object.keys(sharedErr).length} entries (shared) / ${Object.keys(adminErr).length} entries (admin)`);
if (failures.length) {
  console.log(`\nFAIL — ${failures.length} missing key(s):`);
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("\nOK — zero missing keys.");
