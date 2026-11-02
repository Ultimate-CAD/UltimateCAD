$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$deps = Join-Path $repo '.codex-run\certification13\reference-deps'
$build = Join-Path $repo '.codex-run\certification13\cgal-reference-build'
$cgalRoot = Join-Path $deps 'CGAL-6.2.1'
$boostRoot = Join-Path $deps 'boost-headers\boost_1_88_0'
if (!(Test-Path (Join-Path $cgalRoot 'include\CGAL\Surface_mesh.h'))) { throw "Missing extracted CGAL 6.2.1 under $cgalRoot" }
if (!(Test-Path (Join-Path $boostRoot 'boost\version.hpp'))) { throw "Missing extracted Boost 1.88.0 headers under $boostRoot" }
& cmake -S $PSScriptRoot -B $build -G 'Visual Studio 18 2026' -A x64 -DCGAL_SOURCE_ROOT="$cgalRoot" -DBOOST_INCLUDE_ROOT="$boostRoot"
$configureExit = $LASTEXITCODE
if ($configureExit -ne 0) { throw "CMake configure failed with exit code $configureExit; build was not started." }

& cmake --build $build --config Release --parallel 8
$buildExit = $LASTEXITCODE
if ($buildExit -ne 0) { throw "CMake build failed with exit code $buildExit." }
