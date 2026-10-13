#!/usr/bin/env node
'use strict';

/**
 * The Memory Conservatory — static HTML builder.
 *
 * This is deliberately tiny. It is not a framework and there is no runtime:
 * it expands `<!-- @include name -->` comments in `src/pages/*.html` using the
 * matching file in `partials/`, then writes plain, complete HTML into `public/`.
 *
 * Why it exists: the header and footer are ~150 lines of markup shared by every
 * page. Without this, a single nav change means the same edit repeated on every
 * page, and page five quietly drifts out of sync.
 *
 * What Netlify (and the browser) receives is ordinary static HTML. This matters
 * for Netlify Forms in particular, which only detects forms that are physically
 * present in the built HTML — never forms injected later by JavaScript.
 *
 * Syntax
 * ------
 *   <!-- @include header -->
 *   <!-- @include head title="Home" description="..." -->
 *
 * Attributes become `{{placeholders}}` inside the partial. Includes may nest.
 * Leading indentation on the include line is applied to every line of the
 * partial, so the generated HTML stays readable.
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PAGES_DIR = path.join(ROOT, 'src', 'pages');
const PARTIALS_DIR = path.join(ROOT, 'partials');
const OUT_DIR = path.join(ROOT, 'public');

const MAX_INCLUDE_DEPTH = 10;

const INCLUDE_RE = /^([ \t]*)<!--[ \t]*@include[ \t]+([A-Za-z0-9_-]+)((?:[ \t]+[A-Za-z0-9_-]+="[^"]*")*)[ \t]*-->[ \t]*$/gm;
const ATTR_RE = /([A-Za-z0-9_-]+)="([^"]*)"/g;

function readPartial(name) {
  const file = path.join(PARTIALS_DIR, `${name}.html`);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing partial: partials/${name}.html`);
  }
  return fs.readFileSync(file, 'utf8').replace(/\s+$/, '');
}

function parseAttrs(raw) {
  const attrs = {};
  if (!raw) return attrs;
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

function indentBlock(text, indent) {
  if (!indent) return text;
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? line : indent + line))
    .join('\n');
}

/** Replace {{key}} with the supplied value; unknown keys collapse to ''. */
function fillPlaceholders(text, attrs, partialName, warnings) {
  return text.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (_full, key) => {
    if (Object.prototype.hasOwnProperty.call(attrs, key)) return attrs[key];
    warnings.push(`partials/${partialName}.html expects "${key}", which the page did not pass`);
    return '';
  });
}

function expand(html, depth, warnings) {
  if (depth > MAX_INCLUDE_DEPTH) {
    throw new Error('@include nested too deeply — check for a partial including itself');
  }
  return html.replace(INCLUDE_RE, (_full, indent, name, rawAttrs) => {
    const attrs = parseAttrs(rawAttrs);
    const filled = fillPlaceholders(readPartial(name), attrs, name, warnings);
    return indentBlock(expand(filled, depth + 1, warnings), indent);
  });
}

/** Every .html under src/pages/, as paths relative to it, deepest last. */
function findPages(dir, prefix = '') {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) found.push(...findPages(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.html')) found.push(rel);
  }
  return found;
}

function buildOnce() {
  const started = Date.now();
  const warnings = [];

  if (!fs.existsSync(PAGES_DIR)) {
    console.error(`No pages found at src/pages/`);
    process.exitCode = 1;
    return;
  }

  const pages = findPages(PAGES_DIR);
  if (pages.length === 0) {
    console.warn('No .html files in src/pages/ — nothing to build.');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const page of pages) {
    const source = fs.readFileSync(path.join(PAGES_DIR, page), 'utf8');
    const output = expand(source, 0, warnings);
    const target = path.join(OUT_DIR, page);
    // Sub-directories mirror the source tree, so src/pages/gallery/x.html is
    // served at /gallery/x.
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output, 'utf8');
    console.log(`  build  src/pages/${page}  ->  public/${page}`);
  }

  for (const w of new Set(warnings)) console.warn(`  warn   ${w}`);
  console.log(`  done   ${pages.length} page(s) in ${Date.now() - started}ms`);
}

function safeBuild() {
  try {
    buildOnce();
  } catch (err) {
    // In watch mode a bad edit should print and wait, not kill the process.
    console.error(`  error  ${err.message}`);
    if (!process.argv.includes('--watch')) process.exitCode = 1;
  }
}

safeBuild();

if (process.argv.includes('--watch')) {
  console.log('  watch  src/pages/ and partials/ — Ctrl+C to stop');
  let queued = null;
  const rebuild = () => {
    clearTimeout(queued);
    queued = setTimeout(safeBuild, 60); // debounce editors that save twice
  };
  for (const dir of [PAGES_DIR, PARTIALS_DIR]) {
    if (fs.existsSync(dir)) fs.watch(dir, { recursive: true }, rebuild);
  }
}
