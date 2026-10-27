import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "dist", "windows", "sources");
const legalRoot = path.join(root, "dist", "windows", "legal", "occt");
const occtWasmCommit = "ce0e6da47ea43b7994fb2b6275643e04cb36fe5a";
const occtCommit = "c7f60ffe85f28c67358d1771454044f0521f2fdd";
const occtWasmTag = "v5.8.0";
const userAgent = "Layerling-Source-Offer/1.0 (source archive generator)";
const packageLock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const installedOcct = packageLock.packages?.["node_modules/occt-wasm"];
if (installedOcct?.version !== "5.8.0") {
  throw new Error(`Expected package-lock node_modules/occt-wasm@5.8.0, found ${installedOcct?.version ?? "no lock entry"}`);
}
const installedQr = packageLock.packages?.["node_modules/qrcode-generator"];
if (installedQr?.version !== "2.0.4") throw new Error(`Expected qrcode-generator@2.0.4, found ${installedQr?.version ?? "no lock entry"}`);
const installedNext = packageLock.packages?.["node_modules/next"];
if (installedNext?.version !== "15.5.28") throw new Error(`Expected next@15.5.28, found ${installedNext?.version ?? "no lock entry"}`);

async function get(url, accept = "application/vnd.github+json") {
  const response = await fetch(url, { headers: { accept, "user-agent": userAgent }, signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  return response;
}

async function getJson(url) {
  return get(url, "application/json").then((response) => response.json());
}

async function downloadArchive(name, url, expectedRoot, expectedSha256) {
  const filename = `${name}.zip`;
  const destination = path.join(sourceRoot, filename);
  let bytes;
  try {
    bytes = await readFile(destination);
  } catch {
    bytes = null;
  }
  let sha256 = bytes ? createHash("sha256").update(bytes).digest("hex") : "";
  const cached = Boolean(bytes && sha256 === expectedSha256 && bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50);
  if (!cached) {
    const response = await get(url, "application/zip");
    bytes = Buffer.from(await response.arrayBuffer());
    sha256 = createHash("sha256").update(bytes).digest("hex");
  }
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) throw new Error(`${name}: response was not a ZIP archive`);
  if (sha256 !== expectedSha256) throw new Error(`${name}: SHA-256 ${sha256} did not match pinned ${expectedSha256}`);
  if (!cached) await writeFile(destination, bytes);
  return { file: filename, url, expectedRoot, bytes: bytes.length, sha256 };
}

await mkdir(sourceRoot, { recursive: true });
await mkdir(legalRoot, { recursive: true });


// The npm registry's gitHead ties the installed package release to its Git commit.
const npmRelease = await getJson("https://registry.npmjs.org/occt-wasm/5.8.0");
if (npmRelease.gitHead !== occtWasmCommit) {
  throw new Error(`npm occt-wasm@5.8.0 gitHead ${npmRelease.gitHead} did not match pinned ${occtWasmCommit}`);
}

const tagRef = await getJson(`https://api.github.com/repos/andymai/occt-wasm/git/ref/tags/${occtWasmTag}`);
if (tagRef.object.sha !== occtWasmCommit || tagRef.object.type !== "commit") {
  throw new Error(`Upstream ${occtWasmTag} no longer resolves directly to expected commit ${occtWasmCommit}`);
}

const sourceCommit = await getJson(`https://api.github.com/repos/andymai/occt-wasm/commits/${occtWasmCommit}`);
const sourceTree = await getJson(`https://api.github.com/repos/andymai/occt-wasm/git/trees/${sourceCommit.commit.tree.sha}?recursive=1`);
const submodule = sourceTree.tree.find((entry) => entry.path === "occt" && entry.type === "commit");
if (submodule?.sha !== occtCommit) throw new Error(`occt-wasm pinned tree OCCT submodule was ${submodule?.sha ?? "not found"}, expected ${occtCommit}`);

const modulesResponse = await get(`https://raw.githubusercontent.com/andymai/occt-wasm/${occtWasmCommit}/.gitmodules`, "text/plain");
const modulesText = await modulesResponse.text();
if (!/path\s*=\s*occt\s*[\r\n]+\s*url\s*=\s*https:\/\/github\.com\/andymai\/OCCT\.git/i.test(modulesText)) {
  throw new Error("Pinned occt-wasm .gitmodules does not identify the expected OCCT submodule source");
}

const occtTree = await getJson(`https://api.github.com/repos/andymai/OCCT/git/trees/${occtCommit}?recursive=1`);
const requiredLicensePaths = ["LICENSE_LGPL_21.txt", "OCCT_LGPL_EXCEPTION.txt"];
const licenseMaterials = [];
async function saveLicense(relativePath, url, sourceLabel) {
  const response = await get(url, "text/plain");
  const text = await response.text();
  if (!text.trim() || text.startsWith("404:")) throw new Error(`No license text returned from ${url}`);
  const destination = path.join(root, "dist", "windows", "legal", relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, text, "utf8");
  const bytes = Buffer.from(text, "utf8");
  licenseMaterials.push({
    path: `../legal/${relativePath.replaceAll(path.sep, "/")}`,
    source: sourceLabel || url,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
for (const licensePath of requiredLicensePaths) {
  if (!occtTree.tree.some((entry) => entry.path === licensePath && entry.type === "blob")) {
    throw new Error(`Pinned OCCT source is missing expected license material ${licensePath}`);
  }
  await saveLicense(`occt/${licensePath}`, `https://raw.githubusercontent.com/andymai/OCCT/${occtCommit}/${licensePath}`, `https://github.com/andymai/OCCT/blob/${occtCommit}/${licensePath}`);
}

// Keep the license text for binaries/JS copied into the generated web bundle even when npm omits it.
await saveLicense("upstream/occt-wasm-MIT.txt", `https://raw.githubusercontent.com/andymai/occt-wasm/${occtWasmCommit}/LICENSE-MIT`, `https://github.com/andymai/occt-wasm/blob/${occtWasmCommit}/LICENSE-MIT`);
await saveLicense("upstream/occt-wasm-Apache-2.0.txt", `https://raw.githubusercontent.com/andymai/occt-wasm/${occtWasmCommit}/LICENSE-APACHE`, `https://github.com/andymai/occt-wasm/blob/${occtWasmCommit}/LICENSE-APACHE`);

const qrRelease = await getJson("https://registry.npmjs.org/qrcode-generator/2.0.4");
const qrCommit = "83b7e8fe3fddd3b0368dbafd6ce56995bd25e3c8";
if (qrRelease.gitHead !== qrCommit) throw new Error(`qrcode-generator npm gitHead ${qrRelease.gitHead} did not match ${qrCommit}`);
await saveLicense("upstream/qrcode-generator-MIT.txt", `https://raw.githubusercontent.com/kazuhikoarase/qrcode-generator/${qrCommit}/LICENSE`, `https://github.com/kazuhikoarase/qrcode-generator/blob/${qrCommit}/LICENSE`);

const nextRef = await getJson("https://api.github.com/repos/vercel/next.js/git/ref/tags/v15.5.28");
if (nextRef.object.type !== "commit" || nextRef.object.sha !== "195cd6a714086ee0e442cb551da376ad71f37035") {
  throw new Error(`Next.js v15.5.28 tag did not match the pinned source revision`);
}
await saveLicense("upstream/next-MIT.txt", "https://raw.githubusercontent.com/vercel/next.js/v15.5.28/license.md", "https://github.com/vercel/next.js/blob/v15.5.28/license.md");

const reactVersion = packageLock.packages?.["node_modules/react"]?.version;
if (reactVersion !== "19.2.6") throw new Error(`Expected React ${reactVersion ?? "not installed"} for client-only license source`);
const reactLicense = await readFile(path.join(root, "node_modules", "react", "LICENSE"), "utf8");
const reactLicenseBytes = Buffer.from(reactLicense, "utf8");
const reactLicensePath = path.join(root, "dist", "windows", "legal", "upstream", "client-only-MIT.txt");
await mkdir(path.dirname(reactLicensePath), { recursive: true });
await writeFile(reactLicensePath, reactLicense, "utf8");
licenseMaterials.push({
  path: "../legal/upstream/client-only-MIT.txt",
  source: `installed react@${reactVersion} package LICENSE (client-only@0.0.1 metadata identifies the React homepage and MIT)`,
  bytes: reactLicenseBytes.length,
  sha256: createHash("sha256").update(reactLicenseBytes).digest("hex"),
});

const archives = [];
archives.push(await downloadArchive(
  "occt-wasm-5.8.0-ce0e6da",
  `https://codeload.github.com/andymai/occt-wasm/zip/${occtWasmCommit}`,
  `occt-wasm-${occtWasmCommit.slice(0, 7)}/`,
  "864c8575233b98402d9f699e6bdd80aa3746c2218718ceac9a8e27eb7077e6ca",
));
archives.push(await downloadArchive(
  `occt-${occtCommit.slice(0, 7)}`,
  `https://codeload.github.com/andymai/OCCT/zip/${occtCommit}`,
  `OCCT-${occtCommit.slice(0, 7)}/`,
  "5bdc01bdbdc18902a51e12f4a0ff43f6e1cd7b1ea2f7bd1d187e6daf46f97001",
));

const manifest = {
  generatedAt: new Date().toISOString(),
  evidence: {
    npmRelease: "https://registry.npmjs.org/occt-wasm/5.8.0",
    upstreamTag: `https://api.github.com/repos/andymai/occt-wasm/git/ref/tags/${occtWasmTag}`,
    occtWasmCommit: `https://github.com/andymai/occt-wasm/commit/${occtWasmCommit}`,
    gitmodules: `https://github.com/andymai/occt-wasm/blob/${occtWasmCommit}/.gitmodules`,
    occtSubmoduleCommit: `https://github.com/andymai/OCCT/commit/${occtCommit}`,
    licenseText: `https://github.com/andymai/OCCT/tree/${occtCommit}`,
  },
  pinnedCommits: { occtWasm: occtWasmCommit, occt: occtCommit },
  archives,
  licenseMaterials,
  sourceRevisionNotes: {
    qrcodeGenerator: `2.0.4 gitHead ${qrCommit}`,
    next: `15.5.28 tag commit ${nextRef.object.sha}`,
    react: `installed version ${reactVersion}; its MIT license text is used for the client-only marker package whose metadata points to reactjs.org`,
  },
  otherGeometryDependency: {
    name: "brepjs",
    version: "20.10.3",
    declaredLicense: "Apache-2.0",
    source: "https://github.com/andymai/brepjs",
    note: "Its installed package metadata declares Apache-2.0. Its README distinguishes kernels registered with it and identifies occt-wasm output as LGPL-2.1-only; the corresponding OCCT source is archived above. No LGPL status was found for brepjs itself, so no separate brepjs archive was generated.",
  },
  reviewNote: "Source and license references reflect upstream/package evidence at generation time. This manifest does not determine legal sufficiency or whether the OCCT exception applies to a particular distributed binary.",
};

await writeFile(path.join(sourceRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const archiveLines = archives.map((archive) => `- \`${archive.file}\`: ${archive.bytes} bytes; SHA-256 \`${archive.sha256}\`; source ${archive.url}`).join("\n");
const readme = `# Geometry kernel source archives

Pinned source corresponding to the installed \`occt-wasm@5.8.0\` package:

- occt-wasm tag \`${occtWasmTag}\` and npm \`gitHead\`: \`${occtWasmCommit}\`.
- The pinned occt-wasm tree records its \`occt\` submodule at \`${occtCommit}\`, from \`https://github.com/andymai/OCCT.git\`.
- Downloaded source archives are SHA-256 recorded below and in \`manifest.json\`.
- The LGPL-2.1 text and Open CASCADE exception text from the pinned OCCT submodule are under \`../legal/occt/\`.
- MIT/Apache wrapper licenses for occt-wasm, QR Code Generator's MIT license, Next.js's MIT license, and the React MIT text used for the \`client-only\` marker are under \`../legal/upstream/\`; their exact source revisions are listed in \`manifest.json\`.
- The OCCT archive includes the source tree at the exact gitlink commit recorded by the occt-wasm archive; the repository's unrelated nested submodules are not recursively archived.

${archiveLines}

\`brepjs@20.10.3\` declares Apache-2.0 in its installed package metadata. Its README states that kernel licensing is separate and identifies occt-wasm output as LGPL-2.1-only; the OCCT source is included here. No separate LGPL license was identified for brepjs itself, so no additional source archive was generated for it.

The Windows desktop keeps the runtime outside ASAR at \`resources/runtime/apps/web/public/occt/5.8.0/occt-wasm.wasm\`. To replace the LGPL component, close the application, replace that installed file, and restart. See \`docs/desktop/BUILD_REPORT.md\` for current replaceability verification status and evidence; this notice itself does not claim the check passed. These source-access materials are not a legal opinion; review the exact packaged WASM, applicable source build inputs, any exception, and replacement behavior before distribution.
`;
await writeFile(path.join(sourceRoot, "README.md"), readme, "utf8");

console.log(`[desktop/geometry-sources] archived pinned occt-wasm ${occtWasmCommit} and OCCT submodule ${occtCommit}`);
for (const archive of archives) console.log(`${archive.file}: ${archive.bytes} bytes sha256=${archive.sha256}`);
