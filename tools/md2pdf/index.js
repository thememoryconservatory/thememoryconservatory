#!/usr/bin/env node
/**
 * md2pdf — turn Markdown files into styled PDFs.
 *
 * Renders each .md file to HTML with `marked`, wraps it in the print
 * stylesheet at tools/md2pdf/pdf.css, and prints it with headless Chrome.
 *
 *   node tools/md2pdf/index.js                 # every .md in the project -> pdf/
 *   node tools/md2pdf/index.js README.md       # one file
 *   node tools/md2pdf/index.js docs --out dist # a directory, custom output
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { marked } = require('marked');

const SKIP_DIRS = new Set(['node_modules', '.git', '.netlify', '.cache', 'dist']);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const USAGE = `md2pdf — convert Markdown files to PDF

Usage:
  node tools/md2pdf/index.js [files-or-dirs...] [options]

Arguments:
  files-or-dirs   .md files, or directories to scan recursively.
                  Defaults to the whole project when omitted.

Options:
  -o, --out <dir>   Output directory (default: pdf)
  -c, --css <file>  Override the print stylesheet
      --flat        Write every PDF straight into <out>, ignoring subfolders
      --no-title    Do not add the filename/date title block
  -q, --quiet       Only report errors
  -h, --help        Show this message

Environment:
  CHROME_PATH          Path to a Chrome/Chromium binary, if not auto-detected.
  MD2PDF_NO_SANDBOX    Add Chrome's --no-sandbox (needed in containers/as root).
`;

function parseArgs(argv) {
  const opts = { inputs: [], out: 'pdf', css: null, flat: false, title: true, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': opts.help = true; break;
      case '-o': case '--out': opts.out = argv[++i]; break;
      case '-c': case '--css': opts.css = argv[++i]; break;
      case '--flat': opts.flat = true; break;
      case '--no-title': opts.title = false; break;
      case '-q': case '--quiet': opts.quiet = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
        opts.inputs.push(a);
    }
  }
  if ((opts.out === undefined) || (opts.css === undefined)) throw new Error('Missing value for an option');
  return opts;
}

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'No Chrome/Chromium found. Install Google Chrome, or set CHROME_PATH to a browser binary.'
  );
}

/**
 * Collect .md files from a list of files and/or directories. Each result
 * carries the root it was found under, so a directory input keeps its
 * subfolder structure in the output while a file input lands flat.
 */
function collectMarkdown(inputs, outDir) {
  const outAbs = path.resolve(outDir);
  const found = new Map(); // absolute file path -> root directory

  const walk = (dir, root) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        if (path.resolve(full) === outAbs) continue;
        walk(full, root);
      } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
        found.set(path.resolve(full), root);
      }
    }
  };

  for (const input of inputs) {
    if (!fs.existsSync(input)) throw new Error(`Not found: ${input}`);
    const abs = path.resolve(input);
    if (fs.statSync(abs).isDirectory()) walk(abs, abs);
    else if (!found.has(abs)) found.set(abs, path.dirname(abs));
  }

  return [...found.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, root]) => ({ file, root }));
}

/** Shortest readable form of a path: relative to the cwd, or absolute. */
function pretty(p) {
  const rel = path.relative(process.cwd(), p);
  return !rel ? '.' : rel.length < p.length && !rel.startsWith('..') ? rel : p;
}

/**
 * Pull a leading `# Heading` off the document to use as the PDF title, so the
 * title block does not repeat it. Falls back to the filename, body untouched.
 */
function extractTitle(markdown, fallback) {
  const match = markdown.match(/^\s*#\s+(.+?)\s*$/m);
  if (!match || markdown.slice(0, match.index).trim() !== '') {
    return { title: fallback, body: markdown };
  }
  return {
    title: match[1].replace(/[*_`]/g, '').trim(),
    body: markdown.slice(match.index + match[0].length).replace(/^\s*\n/, ''),
  };
}

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp',
};

/**
 * Inline local images as data URIs. Chrome refuses to load file:// subresources
 * from a page in another directory, and the rendered HTML lives in a temp dir,
 * so embedding is the only reliable way to get local images into the PDF.
 */
function inlineImages(html, sourceDir, warn) {
  return html.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/gi, (whole, pre, src, post) => {
    if (/^(https?:|data:|file:)/i.test(src)) return whole;
    const decoded = (() => { try { return decodeURIComponent(src); } catch { return src; } })();
    const abs = path.resolve(sourceDir, decoded.split(/[?#]/)[0]);
    const mime = MIME[path.extname(abs).toLowerCase()];
    if (!mime || !fs.existsSync(abs)) {
      warn(`image not embedded: ${src}`);
      return whole;
    }
    return `${pre}data:${mime};base64,${fs.readFileSync(abs).toString('base64')}${post}`;
  });
}

function buildHtml({ markdown, title, sourceDir, css, showTitle, sourceName, warn }) {
  const body = inlineImages(
    marked.parse(markdown, { gfm: true, breaks: false }),
    sourceDir,
    warn
  );
  const escape = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const stamp = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const header = showTitle
    ? `<h1 class="doc-title">${escape(title)}</h1>\n<p class="doc-meta">${escape(sourceName)} &middot; ${stamp}</p>`
    : '';

  // Local images are already inlined above; <base> is what keeps relative
  // *links* pointing at the source folder rather than the temp render dir.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<base href="file://${sourceDir.replace(/ /g, '%20')}/">
<title>${escape(title)}</title>
<style>
${css}
</style>
</head>
<body>
${header}
${body}
</body>
</html>
`;
}

function printToPdf(chrome, htmlPath, pdfPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '--headless',
      '--disable-gpu',
      '--no-pdf-header-footer',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=3000',
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`,
    ];
    // Containers and root shells need --no-sandbox; desktop runs should not.
    if (process.env.MD2PDF_NO_SANDBOX) args.splice(1, 0, '--no-sandbox');
    execFile(chrome, args, { timeout: 60000 }, (err) => {
      // Chrome exits 0 but chatters on stderr; trust the file on disk instead.
      if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 0) return resolve();
      reject(new Error(err ? err.message.split('\n')[0] : 'Chrome produced no PDF'));
    });
  });
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\n\n${USAGE}`);
    process.exit(1);
  }
  if (opts.help) return console.log(USAGE);

  const log = (...a) => { if (!opts.quiet) console.log(...a); };

  const chrome = findChrome();
  const cssPath = opts.css ? path.resolve(opts.css) : path.join(__dirname, 'pdf.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  const inputs = opts.inputs.length ? opts.inputs : [process.cwd()];
  const files = collectMarkdown(inputs, opts.out);
  if (!files.length) {
    console.error('No Markdown files found.');
    process.exit(1);
  }

  const outDir = path.resolve(opts.out);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md2pdf-'));

  log(`md2pdf — ${files.length} file${files.length === 1 ? '' : 's'} -> ${pretty(outDir)}/\n`);

  let failed = 0;
  let n = 0;
  for (const { file, root } of files) {
    const rel = pretty(file);
    const stem = path.basename(file).replace(/\.(md|markdown)$/i, '');
    const subdir = opts.flat ? '' : path.relative(root, path.dirname(file));
    const destDir = path.join(outDir, subdir);
    const pdfPath = path.join(destDir, `${stem}.pdf`);

    try {
      const markdown = fs.readFileSync(file, 'utf8');
      const { title, body } = opts.title
        ? extractTitle(markdown, stem)
        : { title: stem, body: markdown };
      const html = buildHtml({
        markdown: body,
        title,
        sourceDir: path.dirname(file),
        css,
        showTitle: opts.title,
        sourceName: path.basename(file),
        warn: (msg) => console.error(`  warn  ${rel}  —  ${msg}`),
      });

      const htmlPath = path.join(tmpDir, `${n++}-${stem}.html`);
      fs.writeFileSync(htmlPath, html);
      fs.mkdirSync(destDir, { recursive: true });
      await printToPdf(chrome, htmlPath, pdfPath);
      fs.unlinkSync(htmlPath);

      const kb = (fs.statSync(pdfPath).size / 1024).toFixed(0);
      log(`  ok  ${rel}  ->  ${pretty(pdfPath)}  (${kb} KB)`);
    } catch (err) {
      failed++;
      console.error(`  FAIL  ${rel}  —  ${err.message}`);
    }
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  log(`\nDone. ${files.length - failed} succeeded${failed ? `, ${failed} failed` : ''}.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`md2pdf: ${err.message}`);
  process.exit(1);
});
