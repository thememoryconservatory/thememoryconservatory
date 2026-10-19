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

/* -----------------------------------------------------------------------------
   SEO — written into every page at build time

   The head partial carries an `@seo` comment; it is replaced here with tags
   that depend on the page itself, so no page has to remember to add them:

     - <link rel="canonical"> and og:url, from the page's own path
     - the business, as schema.org structured data (every page)
     - noindex on every page except the four the client wants in search
       (Home, Gallery, About, Enquire) — see INDEXED_PAGES

   The keyword research behind the titles and descriptions is the client's
   ("Keywords TMC Website.docx"); the business data below stays factual —
   areas served, contact details, the kinds of coverage offered.
   -------------------------------------------------------------------------- */

const SITE = 'https://thememoryconservatory.com';
/* The only pages search engines may show — the client's instruction. Every
   other page (FAQs, thank-you, the individual wedding galleries) is sent
   "noindex, follow": kept out of results, but its links are still followed,
   so it passes visitors' paths on to the four pages that should rank.
   Deliberately NOT blocked in robots.txt: a crawler that is barred from a
   page cannot read its noindex, and may still list the bare URL. */
const INDEXED_PAGES = new Set(['index.html', 'about.html', 'contact.html', 'gallery/index.html']);
const isIndexed = (page) => INDEXED_PAGES.has(page.split(path.sep).join('/'));

const BUSINESS = {
  '@context': 'https://schema.org',
  '@type': 'ProfessionalService',
  '@id': `${SITE}/#business`,
  name: 'The Memory Conservatory',
  description:
    'Candid, documentary and fine art wedding photography and wedding films from Chennai, ' +
    'photographing Tamil, Telugu, Kannada, Christian and destination weddings across South India and India.',
  url: `${SITE}/`,
  logo: `${SITE}/assets/brand/favicon-512.png`,
  image: `${SITE}/assets/img/slideshow/slide-1.jpg`,
  email: 'thememoryconservatory@gmail.com',
  telephone: '+91 84385 33169',
  // City only: the street address on file may be private, so it is not published.
  address: { '@type': 'PostalAddress', addressLocality: 'Chennai', addressRegion: 'Tamil Nadu', addressCountry: 'IN' },
  areaServed: [
    { '@type': 'City', name: 'Chennai' },
    { '@type': 'City', name: 'Hyderabad' },
    { '@type': 'City', name: 'Bengaluru' },
    { '@type': 'City', name: 'Visakhapatnam' },
    { '@type': 'State', name: 'Tamil Nadu' },
    { '@type': 'Place', name: 'South India' },
    { '@type': 'Country', name: 'India' },
  ],
  knowsAbout: [
    'Wedding photography', 'Candid wedding photography', 'Documentary wedding photography',
    'Editorial wedding photography', 'Fine art wedding photography', 'Film and analog wedding photography',
    'Wedding cinematography', 'Pre-wedding photoshoots', 'Engagement photography',
    'South Indian wedding photography', 'Destination wedding photography',
  ],
  sameAs: ['https://www.instagram.com/thememoryconservatory/'],
};

/** "about.html" -> "/about", "index.html" -> "/", "gallery/index.html" -> "/gallery/" */
function urlPath(page) {
  const p = '/' + page.split(path.sep).join('/');
  if (p.endsWith('/index.html')) return p.slice(0, -'index.html'.length);
  return p.replace(/\.html$/, '');
}

/** JSON for inside <script>: "</" is escaped so the text can never close the tag. */
function jsonLd(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/<\//g, '<\\/')}</script>`;
}

function seoTags(page, html) {
  const url = SITE + urlPath(page);
  const tags = [
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:url" content="${url}">`,
  ];
  if (!isIndexed(page)) tags.push('<meta name="robots" content="noindex, follow">');
  tags.push(jsonLd(BUSINESS));
  return tags;
}

/** Replace the head partial's @seo comment, keeping its indentation. */
function applySeo(page, html) {
  return html.replace(/^([ \t]*)<!-- @seo[\s\S]*?-->[ \t]*$/m, (_m, indent) =>
    seoTags(page, html).map((t) => indent + t).join('\n'));
}

/** sitemap.xml: only the pages search engines may show. */
function writeSitemap(pages) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = pages
    .filter(isIndexed)
    .map((p) => `  <url>\n    <loc>${SITE}${urlPath(p)}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`);
  fs.writeFileSync(
    path.join(OUT_DIR, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
    'utf8'
  );
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
    const output = applySeo(page, expand(source, 0, warnings));
    const target = path.join(OUT_DIR, page);
    // Sub-directories mirror the source tree, so src/pages/gallery/x.html is
    // served at /gallery/x.
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output, 'utf8');
    console.log(`  build  src/pages/${page}  ->  public/${page}`);
  }

  writeSitemap(pages);

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
