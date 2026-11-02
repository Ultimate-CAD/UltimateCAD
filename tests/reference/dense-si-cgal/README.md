# Dense self-intersection reference checker

This standalone checker reads the native geometry helper's LLR1 result protocol without changing its double coordinates or triangle indices, creates a `CGAL::Surface_mesh`, preserves source face IDs in a property map, and runs complete sequential CGAL PMP `self_intersections` using `Exact_predicates_inexact_constructions_kernel` (EPIK). It is independent of the app's manufacturing validator and is not linked into the app.

The output reports whether the mesh was accepted, whether the complete CGAL call returned, triangle and vertex counts, total intersections, up to the first 64 source-face ID pairs, elapsed time, and Windows peak working set. CGAL does not expose broad-phase candidate counts through this API; that field is null by design. No hit cap is set, so `complete:true` means the API call finished over its full input. `status:"valid"` means no PMP surface intersections were reported; it is not a printability or wall-thickness verdict.

## Build and small controls

From the repository root, run:

```powershell
.\tests\reference\dense-si-cgal\build.ps1
$checker = '.codex-run\certification13\cgal-reference-build\Release\dense-si-cgal-reference.exe'
& $checker --fixture captured-false-pair
& $checker --fixture shared-edge-only
& $checker --fixture crossing-triangles
& $checker --fixture crossing-tetrahedra
```

Then run the checker against an LLR1 result mesh with `& $checker 'path\to\result.mesh.bin'`. The binary protocol header is 16 bytes: little-endian `LLR1` magic `0x31524c4c`, version 1, coordinate count, index count; followed by float64 XYZ coordinates and uint32 triangle indices. Input values are copied directly into CGAL points and faces. The preserved `.11` false-positive triangles are fixture face IDs 4361 and 4369 from `../../../../.codex-run/export11/intersection-proof.json`.

## Pinned isolated dependencies

The downloads below are needed only when the existing cache is absent. Run from the repository root. They store archives and extracted headers under the workspace; they do not install anything system-wide or change the application runtime. Verify both pinned SHA-256 values before extraction:

```powershell
$repo = (Resolve-Path '.').Path
$deps = Join-Path $repo '.codex-run\certification13\reference-deps'
New-Item -ItemType Directory -Force -Path $deps | Out-Null

$cgalZip = Join-Path $deps 'CGAL-6.2.1-library.zip'
Invoke-WebRequest -Uri 'https://github.com/CGAL/cgal/releases/download/v6.2.1/CGAL-6.2.1-library.zip' -OutFile $cgalZip
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $cgalZip).Hash.ToLowerInvariant() -ne 'db49ffa9d2c5a3386e0725983bf3478e3fd2ade43553f8fc3900e18554decd49') { throw 'CGAL archive SHA-256 mismatch' }
Expand-Archive -LiteralPath $cgalZip -DestinationPath $deps -Force
if (!(Test-Path (Join-Path $deps 'CGAL-6.2.1\include\CGAL\Surface_mesh.h'))) { throw 'CGAL archive did not extract to the expected workspace path' }

$boostArchive = Join-Path $deps 'boost_1_88_0.7z'
Invoke-WebRequest -Uri 'https://archives.boost.io/release/1.88.0/source/boost_1_88_0.7z' -OutFile $boostArchive
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $boostArchive).Hash.ToLowerInvariant() -ne 'e84a33716a31c1c8cb00783a411630d41c008e9364002dc0fe55aea4f54f4726') { throw 'Boost archive SHA-256 mismatch' }
$sevenZip = 'C:\Program Files\7-Zip\7z.exe'
if (!(Test-Path $sevenZip)) { throw "The existing 7-Zip extractor was not found at $sevenZip" }
$boostOut = Join-Path $deps 'boost-headers'
New-Item -ItemType Directory -Force -Path $boostOut | Out-Null
& $sevenZip x -y "-o$boostOut" $boostArchive 'boost_1_88_0\boost\*'
if ($LASTEXITCODE -ne 0) { throw "Boost header extraction failed with exit code $LASTEXITCODE" }
if (!(Test-Path (Join-Path $boostOut 'boost_1_88_0\boost\version.hpp'))) { throw 'Boost headers did not extract to the expected workspace path' }
```

Pinned assets:

- CGAL 6.2.1 official library archive, SHA-256 `db49ffa9d2c5a3386e0725983bf3478e3fd2ade43553f8fc3900e18554decd49`.
- Boost 1.88.0 official Windows source archive, SHA-256 `e84a33716a31c1c8cb00783a411630d41c008e9364002dc0fe55aea4f54f4726`; only `boost_1_88_0/boost/` headers are extracted for this checker.

Once those workspace paths exist, build and run with the earlier commands. The build script checks the configure exit code before starting the build and checks the build exit code before succeeding; a failed configure cannot fall through to an old executable. It does not download dependencies itself.

`CGAL_DISABLE_GMP=1` is defined for this standalone build. CGAL's pinned `enable_third_party_libraries.h` disables GMP/MPFR in that mode; Boost.Multiprecision remains enabled with Boost 1.88. No system install, registry edit, package manager, or application runtime change is used. CMake uses the installed Visual Studio 18 2026 x64 generator. The existing checker CMake flags are `/O2 /EHsc /bigobj /utf-8`; they are left as previously verified. CGAL 6.2.1's interval header documents the MSVC `/fp:strict` nuance for a NaN comparison, not as a required compile flag for this checker.

Official sources: [CGAL 6.2.1 release](https://github.com/CGAL/cgal/releases/tag/v6.2.1), [CGAL installation requirements](https://doc.cgal.org/latest/Manual/installation.html), [PMP intersection API](https://doc.cgal.org/latest/Polygon_mesh_processing/group__PMP__intersection__grp.html), [Boost 1.88.0 archive](https://archives.boost.io/release/1.88.0/source/boost_1_88_0.7z), [Boost 1.88.0 release page](https://www.boost.org/releases/1.88.0/).

CGAL's official PMP implementation treats shared mesh edges specially and tests whether the coplanar incident triangles overlap beyond that edge. This is why the `shared-edge-only` control expects zero hits. The captured `.11` disjoint coplanar pair must also return zero; crossing triangles and crossing tetrahedra must return one or more hits.

CGAL PMP's self-intersection header is marked `GPL-3.0-or-later OR LicenseRef-Commercial`; the official CGAL release license texts and Boost license are retained under `docs/research/dense-si-reference/licenses/`. This reference-only checker is not part of the product build.
