import { cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeModules = path.join(repositoryRoot, "node_modules");
const legalRoot = path.join(process.env.LAYERLING_RELEASE_DIR || path.join(repositoryRoot, "dist", "windows"), "legal");
const runtimeNodeModules = path.join(repositoryRoot, "dist", process.env.LAYERLING_ULTIMATE_BUILD === "1" ? "ultimate-stage" : "desktop-stage", "runtime", "node_modules");
const licenseNames = /^(license|licence|copying|notice|copyright|third[-_ ]party[-_ ]notice)(\.|$)/i;
const textExtensions = new Set(["", ".txt", ".md", ".rst", ".html"]);

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function packageMetadata(packageDirectory) {
  try {
    const file = path.join(packageDirectory, "package.json");
    const metadata = JSON.parse(await readFile(file, "utf8"));
    if (!metadata.name) return null;
    return { ...metadata, _directory: packageDirectory };
  } catch {
    return null;
  }
}

async function walkPackageDirectory(directory, packages, visited) {
  let realDirectory;
  try {
    realDirectory = await realpath(directory);
  } catch {
    return;
  }
  if (visited.has(realDirectory)) return;
  visited.add(realDirectory);

  const metadata = await packageMetadata(realDirectory);
  if (metadata) packages.push(metadata);

  const nested = path.join(realDirectory, "node_modules");
  if (!(await exists(nested))) return;
  await walkNodeModules(nested, packages, visited);
}

async function walkNodeModules(directory, packages, visited) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === ".bin") continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.name.startsWith("@")) {
      let scopedEntries = [];
      try {
        scopedEntries = await readdir(entryPath, { withFileTypes: true });
      } catch {
        // An unreadable optional scope is recorded by the package manager, not here.
      }
      for (const child of scopedEntries) await walkPackageDirectory(path.join(entryPath, child.name), packages, visited);
    } else {
      await walkPackageDirectory(entryPath, packages, visited);
    }
  }
}

async function findLicenseTexts(packageDirectory) {
  const found = [];
  async function visit(directory, depth) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isFile()) {
        const extension = path.extname(entry.name).toLowerCase();
        if (licenseNames.test(entry.name) && textExtensions.has(extension)) found.push(fullPath);
      } else if (entry.isDirectory() && depth < 2 && /^(licenses?|legal|third[-_ ]party)$/i.test(entry.name)) {
        await visit(fullPath, depth + 1);
      }
    }
  }
  await visit(packageDirectory, 0);
  return [...new Set(found)].sort((a, b) => a.localeCompare(b));
}

function safeName(value) {
  return value.replace(/^@/, "").replaceAll("/", "__").replace(/[^a-zA-Z0-9._+-]/g, "_");
}

function packageSource(metadata) {
  const repository = metadata.repository;
  const repositoryUrl = typeof repository === "string" ? repository : repository?.url;
  return (repositoryUrl || metadata.homepage || "").replace(/^git\+/, "").replace(/\.git$/, "");
}

async function copyLicense(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
}

await mkdir(legalRoot, { recursive: true });
await rm(path.join(legalRoot, "packages"), { recursive: true, force: true });

const packages = [];
await walkNodeModules(nodeModules, packages, new Set());
packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
const runtimePackages = [];
await walkNodeModules(runtimeNodeModules, runtimePackages, new Set());
const runtimePackageKeys = new Set(runtimePackages.map((entry) => `${entry.name}@${entry.version || "unknown-version"}`));

const sharedLicenseText = {
  "@next/env": "upstream/next-MIT.txt",
  "@next/swc-win32-x64-msvc": "upstream/next-MIT.txt",
  "client-only": "upstream/client-only-MIT.txt",
  "occt-wasm": "upstream/occt-wasm-MIT.txt, upstream/occt-wasm-Apache-2.0.txt",
  "qrcode-generator": "upstream/qrcode-generator-MIT.txt",
};

const inventory = [];
const copied = [];
for (const metadata of packages) {
  const packageId = `${metadata.name}@${metadata.version || "unknown-version"}`;
  const outputDirectory = path.join(legalRoot, "packages", safeName(packageId));
  const sourceFiles = await findLicenseTexts(metadata._directory);
  const copiedFiles = [];
  for (const source of sourceFiles) {
    const relative = path.relative(metadata._directory, source);
    const destination = path.join(outputDirectory, relative);
    await copyLicense(source, destination);
    const relativeOutput = path.relative(legalRoot, destination).split(path.sep).join("/");
    copiedFiles.push(relativeOutput);
    copied.push(relativeOutput);
  }
  const sharedFiles = sharedLicenseText[metadata.name]?.split(", ") ?? [];
  for (const relativeOutput of sharedFiles) {
    if (await exists(path.join(legalRoot, relativeOutput))) copiedFiles.push(relativeOutput);
  }
  const packageIdKey = `${metadata.name}@${metadata.version || "unknown-version"}`;
  inventory.push({
    name: metadata.name,
    version: metadata.version || "",
    license: metadata.license || "UNSPECIFIED",
    source: packageSource(metadata),
    licenseFiles: [...new Set(copiedFiles)],
    stagedNodeRuntime: runtimePackageKeys.has(packageIdKey),
  });
}

const repositoryLicense = path.join(repositoryRoot, "LICENSE");
if (await exists(repositoryLicense)) await copyLicense(repositoryLicense, path.join(legalRoot, "Layerling-LICENSE"));
const fontLicense = path.join(repositoryRoot, "fonts", "zen-maru-gothic", "OFL.txt");
if (await exists(fontLicense)) await copyLicense(fontLicense, path.join(legalRoot, "fonts", "Zen-Maru-Gothic-OFL.txt"));

const occtMetadata = packages.find((entry) => entry.name === "occt-wasm");
const occtReadme = occtMetadata ? path.join(occtMetadata._directory, "README.md") : "";
const occtVersion = occtMetadata?.version || "not installed";
const sourceAccess = `# Source access and replaceable runtime components

This release inventory is generated from the installed node_modules tree. It records package metadata and copies license/notice text files that are present in each installed package. A missing license file is shown as missing in the inventory; the SPDX/package metadata is not a substitute for verifying applicable obligations.

## Layerling source

Project source repository: https://github.com/henmedia/layerling
The accompanying Layerling license text is in Layerling-LICENSE.

## Open CASCADE WebAssembly runtime

Installed npm package: occt-wasm@${occtVersion}
Installed package metadata declares the TypeScript wrapper/tooling as MIT OR Apache-2.0; its README separately identifies the compiled WASM output as LGPL-2.1-only inherited from OCCT. Do not treat the npm package.json license field as covering the compiled WASM.
Wrapper/tooling source: https://github.com/andymai/occt-wasm
OCCT project source: https://github.com/Open-Cascade-SAS/OCCT
Pinned source submodule: https://github.com/andymai/OCCT/tree/c7f60ffe85f28c67358d1771454044f0521f2fdd (recorded in the v5.8.0 occt-wasm commit's .gitmodules as https://github.com/andymai/OCCT.git)
Official OCCT licensing/source page: https://dev.opencascade.org/resources/download
Upstream build instructions: https://github.com/andymai/occt-wasm#building-from-source (clone with --recurse-submodules; run cargo xtask build).
License reference: https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html
Pinned source archives are under ../sources/: occt-wasm commit ce0e6da47ea43b7994fb2b6275643e04cb36fe5a and its OCCT git submodule commit c7f60ffe85f28c67358d1771454044f0521f2fdd. The corresponding LICENSE_LGPL_21.txt and OCCT_LGPL_EXCEPTION.txt from the OCCT submodule are copied in occt/ by desktop/geometry-sources.mjs.

The installed occt-wasm README describes its OCCT build as V8.0.1 and gives the source build steps above. It specifically says desktop apps embedding the WASM should consult the LGPL-2.1 FAQ. The upstream README also says the WASM must be replaceable and gives a URL/binary override example for web applications. The pinned OCCT source carries an LGPL 2.1 text and an Open CASCADE exception text; both are included as upstream materials, but applicability and the effect of the exception on a specific binary must be reviewed. The desktop package keeps the runtime outside ASAR at \`resources/runtime/apps/web/public/occt/5.8.0/occt-wasm.wasm\`. User replacement instructions: close the application, replace that file in the install directory, then restart the application. See \`docs/desktop/BUILD_REPORT.md\` for current replaceability verification status and evidence; this notice itself does not claim the check passed. This notice records upstream statements and source references; it is not a legal conclusion that a particular distribution or replacement mechanism is sufficient. Verify the exact shipped binary, corresponding source/build, notices, and end-user replacement path for the desktop package.
`;
await writeFile(path.join(legalRoot, "SOURCE-ACCESS.md"), sourceAccess, "utf8");

const inventoryJson = {
  generatedAt: new Date().toISOString(),
  root: "Layerling-LICENSE",
  fonts: (await exists(fontLicense)) ? ["fonts/Zen-Maru-Gothic-OFL.txt"] : [],
  packageCount: inventory.length,
  stagedRuntimePackageCount: runtimePackageKeys.size,
  licenseFilesMissingForStagedRuntime: inventory.filter((entry) => entry.stagedNodeRuntime && entry.licenseFiles.length === 0).map((entry) => `${entry.name}@${entry.version}`),
  packages: inventory,
  packageClassificationNotes: {
    "qrcode-generator@2.0.4": "Bundled through apps/web/src/lib/qrCode.ts into browser chunks; its upstream MIT text is included under upstream/.",
    "occt-wasm@5.8.0": "Runtime glue and WASM are staged as public assets rather than as a Node package. The wrapper's MIT/Apache texts and OCCT WASM LGPL/exception texts are included separately.",
    "@jscadui/3mf-export@0.5.0": "Installed as a manifold-3d package dependency, but absent from the traced Node runtime and not present in the public manifold.js runtime artifact. No browser/runtime attribution was identified in this audit.",
    "@nodable/entities@2.1.0": "Transitive dependency of manifold-3d's 3MF export path; absent from the traced Node runtime and public manifold.js runtime artifact.",
    "@next/swc-win32-x64-msvc@15.5.28": "Build compiler package; absent from the traced Node runtime. The Next.js MIT text is included as shared upstream text.",
    "sharp@0.35.5 and @img/sharp-win32-x64@0.35.5": "Next standalone tracing pulled these into the staging tree although images are unoptimized and there are no next/image uses. The desktop build should prune them; if retained in release output, resolve LGPL-3.0-or-later source/notices for bundled libvips and components.",
  },
  bundledRuntimeComponents: [
    {
      name: "manifold-3d runtime (apps/web/public/manifold.js and manifold.wasm)",
      version: packages.find((entry) => entry.name === "manifold-3d")?.version || "not installed",
      license: packages.find((entry) => entry.name === "manifold-3d")?.license || "UNSPECIFIED",
      licenseText: packages.find((entry) => entry.name === "manifold-3d")?.licenseFiles || [],
      source: packageSource(packages.find((entry) => entry.name === "manifold-3d") || {}),
      note: "Public runtime files are staged from manifold-3d; verify the exact release contents against the package license and notices.",
    },
    {
      name: "occt-wasm compiled WebAssembly runtime",
      version: occtVersion,
      license: "LGPL-2.1-only (upstream README statement; inherited from OCCT)",
      licenseText: ["occt/LICENSE_LGPL_21.txt", "occt/OCCT_LGPL_EXCEPTION.txt"],
      source: "https://github.com/andymai/occt-wasm",
      note: "Distinct from the npm package metadata license for wrapper/build tooling; see SOURCE-ACCESS.md for upstream source and replaceability note.",
    },
    {
      name: "Zen Maru Gothic source font and generated Japanese typeface assets",
      version: "",
      license: "SIL Open Font License 1.1",
      licenseText: (await exists(fontLicense)) ? "fonts/Zen-Maru-Gothic-OFL.txt" : "not found",
      source: "https://github.com/googlefonts/zen-marugothic",
      note: "Generated public Japanese typeface files are subsets derived from the bundled font source.",
    },
  ],
};
await writeFile(path.join(legalRoot, "inventory.json"), `${JSON.stringify(inventoryJson, null, 2)}\n`, "utf8");

const table = inventory.map((entry) => {
  const textFiles = entry.licenseFiles.length ? entry.licenseFiles.map((file) => `\`${file}\``).join(", ") : "No license text file found in package";
  const source = entry.source ? `[source](${entry.source})` : "not listed";
  const trace = entry.stagedNodeRuntime ? "Staged Node runtime" : "Not in staged Node runtime";
  return `| ${entry.name} | ${entry.version || "unknown"} | ${entry.license.replaceAll("|", "\\|")} | ${trace} | ${source} | ${textFiles} |`;
});
const inventoryMarkdown = `# Third-party license inventory

Generated from installed packages. Package license expressions and copied license text files are reported as discovered; entries marked UNSPECIFIED or without a license file need follow-up. This inventory does not determine whether package metadata fully covers bundled files.

Installed package count: ${inventory.length}; staged Node runtime package count: ${runtimePackageKeys.size}.
Packages absent from the traced Node runtime may still be bundled into browser JavaScript; this report does not perform static chunk attribution. Sharp and platform-specific libvips packages are only build/tracing dependencies for the current app configuration (\`images.unoptimized: true\`; no \`next/image\` use was found) and should be omitted from the final stage if that configuration stays in force. If they remain in the shipped runtime, their additional bundled library sources and notices must be handled.

Run \`node desktop/geometry-sources.mjs\` before \`node desktop/licenses.mjs\` so the pinned upstream wrapper and bundled browser-package license texts exist before the inventory is written. The generator caches pinned source archives by SHA-256 and leaves other files in \`dist/windows/sources\` intact.

| Package | Version | Declared license | Stage | Source | Copied license/notice text |
| --- | --- | --- | --- | --- | --- |
${table.join("\n")}

The root Layerling license is copied to \`Layerling-LICENSE\`. The Zen Maru Gothic font license is copied to \`fonts/Zen-Maru-Gothic-OFL.txt\`. See \`SOURCE-ACCESS.md\` for project source and OCCT/occt-wasm source references and notes about the packaged WASM component.

## Bundled public runtime assets

- \`manifold.js\` and \`manifold.wasm\`: supplied by \`manifold-3d\`; see its package license text in the package inventory.
- OCCT glue/WASM: \`occt-wasm\` package metadata covers wrapper/build tooling only; its README describes compiled WASM separately as LGPL-2.1-only. The installed package contains no standalone LGPL text file, so this inventory records the official license URL and upstream source in \`SOURCE-ACCESS.md\`.
- OCCT corresponding source: pinned archives are under \`../sources/\`; the LGPL text and OCCT exception from the pinned submodule are under \`occt/\`.
- Generated Japanese typeface assets: derived from Zen Maru Gothic; its SIL OFL 1.1 text is included at \`fonts/Zen-Maru-Gothic-OFL.txt\`.
- Browser QR helper: qrcode-generator 2.0.4 is bundled from \`apps/web/src/lib/qrCode.ts\`; its MIT text is in \`upstream/qrcode-generator-MIT.txt\`.
- Next and React marker packages: staged \`@next/env\` / \`client-only\` use their corresponding Next/React MIT texts in \`upstream/\`. The platform Next SWC compiler is not in the staged runtime.
`;
await writeFile(path.join(legalRoot, "LICENSES.md"), inventoryMarkdown, "utf8");

console.log(`[desktop/licenses] inventoried ${inventory.length} installed packages; copied ${copied.length} package license/notice text files to dist/windows/legal`);
