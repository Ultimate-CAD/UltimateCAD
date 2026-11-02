import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEXT_EXTENSIONS = new Set([
  "",
  ".c",
  ".cc",
  ".cfg",
  ".conf",
  ".cpp",
  ".h",
  ".hpp",
  ".ini",
  ".json",
  ".license",
  ".licence",
  ".md",
  ".notice",
  ".rst",
  ".text",
  ".toml",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`))
    throw new Error(`Path escapes its staging root: ${target}`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const escapes = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return escapes[character];
  });
}

function localPath(value, label, { optional = false } = {}) {
  if (value == null || value === "") {
    if (optional) return "";
    throw new Error(`${label} is required`);
  }
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(value) ||
    value.split("/").includes("..")
  )
    throw new Error(`${label} must be a safe local absolute path`);
  return value;
}

function color(value, fallback) {
  return typeof value === "string" &&
    /^(#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8})$/i.test(value)
    ? value
    : fallback;
}

function collectLegalFiles(legalRoot, directory = legalRoot) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    assertInside(legalRoot, file);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      files.push(...collectLegalFiles(legalRoot, file));
      continue;
    }
    if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      continue;
    const real = realpathSync(file);
    assertInside(legalRoot, real);
    files.push(real);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function page(title, body, brand, icon) {
  const name = escapeHtml(brand.name),
    tagline = escapeHtml(brand.tagline),
    description = escapeHtml(brand.description),
    version = escapeHtml(brand.version),
    splash = localPath(brand.splash, "brand.splash", { optional: true });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${description}">
  <link rel="icon" href="${icon}">
  <title>${escapeHtml(title)} · ${name}</title>
  <style>
    :root { color-scheme: light dark; --accent: ${color(brand.accentColor, "#426b82")}; --background: ${color(brand.backgroundColor, "#f4f6f7")}; --foreground: ${color(brand.foregroundColor, "#20282d")}; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--background); color: var(--foreground); font: 16px/1.6 system-ui, sans-serif; }
    header, main { width: min(100% - 2rem, 920px); margin: 0 auto; }
    header { padding: 2rem 0 1.25rem; border-bottom: 1px solid color-mix(in srgb, var(--foreground) 20%, transparent); }
    .brand { display: flex; align-items: center; gap: 1rem; text-decoration: none; color: inherit; }
    .brand img { width: 3rem; height: 3rem; object-fit: contain; }
    .brand-name { display: block; font-size: 1.35rem; font-weight: 700; }
    .tagline, .version { display: block; opacity: .76; }
    .splash { width: 100%; max-height: 12rem; object-fit: cover; margin-top: 1.5rem; border-radius: .75rem; }
    main { padding: 1.5rem 0 4rem; }
    h1 { line-height: 1.2; }
    a { color: var(--accent); }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: 1rem; border-radius: .5rem; background: color-mix(in srgb, var(--foreground) 6%, var(--background)); font: 14px/1.5 ui-monospace, monospace; }
    li { margin: .5rem 0; }
    .notice { padding: .85rem 1rem; border-left: 4px solid var(--accent); background: color-mix(in srgb, var(--accent) 9%, var(--background)); }
  </style>
</head>
<body>
  <header>
    <a class="brand" href="/desktop/about.html">
      <img src="${localPath(brand.logo, "brand.logo")}" alt="">
      <span><span class="brand-name">${name}</span><span class="tagline">${tagline}</span><span class="version">Version ${version}</span></span>
    </a>
    ${splash ? `<img class="splash" src="${splash}" alt="">` : ""}
  </header>
  <main>${body}</main>
</body>
</html>
`;
}

/** Stage local About, license and source-access pages without mutating inputs. */
export async function stageLocalDocs({ brand, legalRoot, publicRoot, sourceArchive }) {
  if (!brand || typeof brand !== "object") throw new Error("brand is required");
  const legal = realpathSync(path.resolve(legalRoot)),
    output = path.resolve(publicRoot);
  if (!statSync(legal).isDirectory()) throw new Error("legalRoot must be a directory");
  mkdirSync(output, { recursive: true });
  const publicDirectory = realpathSync(output),
    desktopRoot = path.join(publicDirectory, "desktop"),
    licenseRoot = path.join(desktopRoot, "licenses"),
    documentRoot = path.join(licenseRoot, "documents"),
    sourceRoot = path.join(desktopRoot, "sources");
  for (const target of [desktopRoot, licenseRoot, documentRoot, sourceRoot])
    assertInside(publicDirectory, target);
  mkdirSync(documentRoot, { recursive: true });
  mkdirSync(sourceRoot, { recursive: true });

  const helpPath = localPath(brand.helpPath, "brand.helpPath"),
    icon = localPath(brand.icon, "brand.icon"),
    files = collectLegalFiles(legal),
    docs = [];
  for (const file of files) {
    const relative = path.relative(legal, file).split(path.sep).join("/"),
      slug = createHash("sha256").update(relative).digest("hex").slice(0, 16),
      target = path.join(documentRoot, `${slug}.html`),
      contents = readFileSync(file, "utf8");
    assertInside(legal, file);
    assertInside(publicDirectory, target);
    writeFileSync(
      target,
      page(
        relative,
        `<h1>${escapeHtml(relative)}</h1><p><a href="/desktop/licenses/index.html">Back to license index</a></p><pre>${escapeHtml(contents)}</pre>`,
        brand,
        icon,
      ),
    );
    docs.push({ label: relative, href: `/desktop/licenses/documents/${slug}.html` });
  }

  const sourceAccessFile = files.find(
      (file) => path.relative(legal, file).toLowerCase() === "source-access.md",
    ),
    sourceAccessExists = Boolean(sourceAccessFile);
  const archiveName = "Layerling-Ultimate-Source.zip";
  let archiveHref = "";
  if (sourceArchive) {
    const archive = realpathSync(path.resolve(sourceArchive));
    if (!statSync(archive).isFile()) throw new Error("sourceArchive must be a file");
    copyFileSync(archive, path.join(sourceRoot, archiveName));
    archiveHref = `/desktop/sources/${archiveName}`;
  }

  const list = docs
    .map((doc) => `<li><a href="${doc.href}">${escapeHtml(doc.label)}</a></li>`)
    .join("\n");
  writeFileSync(
    path.join(licenseRoot, "index.html"),
    page(
      "Open-Source Licenses",
      `<h1>Open-Source Licenses</h1><p>Application license: AGPL-3.0-only. Original Layerling and third-party copyright notices are preserved below.</p><p>License and notice materials included with this application:</p><ul>${list}</ul><p><a href="/desktop/licenses/source.html">Source access and replaceable components</a></p><p><a href="${helpPath}">Help</a></p>`,
      brand,
      icon,
    ),
  );

  const sourceText = sourceAccessExists
      ? escapeHtml(readFileSync(sourceAccessFile, "utf8"))
      : "No SOURCE-ACCESS.md file was found in the staged legal materials.",
    archiveSection = archiveHref
      ? `<p><a href="${archiveHref}">Download the complete application source archive</a></p>`
      : `<p>The application source archive was not staged with these pages.</p>`;
  writeFileSync(
    path.join(licenseRoot, "source.html"),
    page(
      "Source access",
      `<h1>Source access</h1><p>Application license: AGPL-3.0-only.</p><p class="notice">This page exposes bundled source and license information locally. It does not make a legal determination about this build or any future distribution or network deployment. Preserve the applicable source, license and replaceable-component materials when changing packaging or deployment.</p>${archiveSection}<h2>Bundled source-access notice</h2><pre>${sourceText}</pre><p><a href="/desktop/licenses/index.html">Open-source licenses</a> · <a href="${helpPath}">Help</a></p>`,
      brand,
      icon,
    ),
  );

  writeFileSync(
    path.join(desktopRoot, "about.html"),
    page(
      `About ${brand.name}`,
      `<h1>About ${escapeHtml(brand.name)}</h1><p>${escapeHtml(brand.description)}</p><p>Version ${escapeHtml(brand.version)}</p><p class="notice">A local desktop derivative of Layerling by Layerling contributors. This attribution does not claim ownership of Layerling or its third-party components.</p><nav><ul><li><a href="${helpPath}">Help</a></li><li><a href="/desktop/licenses/index.html">Open-Source Licenses</a></li><li><a href="/desktop/licenses/source.html">Source access</a></li></ul></nav>`,
      brand,
      icon,
    ),
  );

  return {
    aboutPath: path.join(desktopRoot, "about.html"),
    licensesPath: path.join(licenseRoot, "index.html"),
    sourceAccessPath: path.join(licenseRoot, "source.html"),
    licenseDocumentCount: docs.length,
    sourceArchivePath: archiveHref ? path.join(sourceRoot, archiveName) : null,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  throw new Error("Import stageLocalDocs() and provide explicit staging paths");
}
