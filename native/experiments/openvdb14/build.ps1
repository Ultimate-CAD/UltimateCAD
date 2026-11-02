[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$sparseRoot = Join-Path $repoRoot '.codex-run\sparse14'
$depsRoot = Join-Path $sparseRoot 'deps'
$vdbSource = Join-Path $depsRoot 'openvdb-14.0.0'
$vdbArchive = Join-Path $depsRoot 'openvdb-14.0.0.zip'
$tbbBuild = Join-Path $repoRoot '.codex-run\adaptive10\build\_deps\tbb-build'
$tbbInstall = Join-Path $depsRoot 'tbb-install'
$vdbBuild = Join-Path $sparseRoot 'openvdb-build'
$vdbInstall = Join-Path $depsRoot 'openvdb-install'
$prototypeBuild = Join-Path $sparseRoot 'prototype-build'
$nativeCache = Join-Path $repoRoot '.codex-run\adaptive10'
$logs = Join-Path $sparseRoot 'logs'
$expectedSha256 = 'd53508b64e50eabd8c01fb62310f2d55a2ef00475972a6b14e69ec0a6d6d05d1'

function Assert-WorkspacePath([string]$Path) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  $prefix = [IO.Path]::GetFullPath($sparseRoot) + [IO.Path]::DirectorySeparatorChar
  if (-not $fullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing path outside isolated sparse14 workspace: $fullPath"
  }
}

function Invoke-Logged([string]$Executable, [string[]]$Arguments, [string]$LogPath) {
  & $Executable @Arguments *> $LogPath
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    Get-Content -LiteralPath $LogPath -Tail 30
    throw "$Executable failed with exit code $exitCode; see $LogPath"
  }
  Write-Host "PASS $Executable $($Arguments -join ' ')"
}

foreach ($path in @($tbbInstall, $vdbBuild, $vdbInstall, $prototypeBuild, $logs)) {
  Assert-WorkspacePath $path
}

if (-not (Test-Path -LiteralPath $vdbArchive -PathType Leaf)) { throw "Missing pinned OpenVDB archive: $vdbArchive" }
if (-not (Test-Path -LiteralPath (Join-Path $vdbSource 'CMakeLists.txt') -PathType Leaf)) { throw "Missing extracted OpenVDB 14 source: $vdbSource" }
if (-not (Test-Path -LiteralPath (Join-Path $tbbBuild 'cmake_install.cmake') -PathType Leaf)) { throw "Missing existing TBB build: $tbbBuild" }
if (-not (Test-Path -LiteralPath (Join-Path $nativeCache 'manifold\include\manifold\manifold.h') -PathType Leaf)) { throw "Missing existing native geometry dependencies: $nativeCache" }

$actualSha256 = (Get-FileHash -LiteralPath $vdbArchive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) { throw "OpenVDB archive SHA-256 mismatch: $actualSha256" }
$sourceCMake = Join-Path $vdbSource 'CMakeLists.txt'
foreach ($versionLine in @(
  '^set\(OpenVDB_MAJOR_VERSION 14\)$',
  '^set\(OpenVDB_MINOR_VERSION 0\)$',
  '^set\(OpenVDB_PATCH_VERSION 0\)$'
)) {
  if (-not (Select-String -LiteralPath $sourceCMake -Pattern $versionLine)) {
    throw 'Extracted OpenVDB source does not identify as pinned version 14.0.0'
  }
}

New-Item -ItemType Directory -Path $logs -Force | Out-Null
$cmake = 'cmake'
$generator = 'Visual Studio 18 2026'

Invoke-Logged $cmake @('--install', $tbbBuild, '--config', 'Release', '--prefix', $tbbInstall) (Join-Path $logs 'tbb-install.log')

$vdbConfigure = @(
  '-S', $vdbSource, '-B', $vdbBuild, '-G', $generator, '-A', 'x64',
  "-DCMAKE_INSTALL_PREFIX=$vdbInstall", '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded',
  "-DCMAKE_PREFIX_PATH=$tbbInstall", '-DOPENVDB_BUILD_CORE=ON',
  '-DOPENVDB_CORE_SHARED=OFF', '-DOPENVDB_CORE_STATIC=ON',
  '-DOPENVDB_BUILD_BINARIES=OFF', '-DOPENVDB_BUILD_UNITTESTS=OFF',
  '-DOPENVDB_BUILD_PYTHON_MODULE=OFF', '-DOPENVDB_BUILD_DOCS=OFF',
  '-DOPENVDB_BUILD_AX=OFF', '-DOPENVDB_BUILD_NANOVDB=OFF',
  '-DUSE_EXPLICIT_INSTANTIATION=OFF', '-DUSE_ZLIB=OFF', '-DUSE_ZSTD=OFF',
  '-DUSE_IMATH_HALF=OFF', '-DUSE_EXR=OFF', '-DCONCURRENT_MALLOC=None',
  '-DMSVC_MP_THREAD_COUNT=4'
)
Invoke-Logged $cmake $vdbConfigure (Join-Path $logs 'openvdb-configure.log')
Invoke-Logged $cmake @('--build', $vdbBuild, '--config', 'Release', '--target', 'openvdb_static', '--parallel', '4') (Join-Path $logs 'openvdb-build.log')
Invoke-Logged $cmake @('--install', $vdbBuild, '--config', 'Release') (Join-Path $logs 'openvdb-install.log')

$prototypeConfigure = @(
  '-S', $PSScriptRoot, '-B', $prototypeBuild, '-G', $generator, '-A', 'x64',
  '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded', "-DVDB_PREFIX=$vdbInstall",
  "-DNATIVE_CACHE=$nativeCache", '-DSPARSE_CAVITY_SIMPLIFY_DIVISOR=0'
)
Invoke-Logged $cmake $prototypeConfigure (Join-Path $logs 'prototype-configure.log')
Invoke-Logged $cmake @('--build', $prototypeBuild, '--config', 'Release', '--target', 'ultimate-openvdb14', '--parallel', '4') (Join-Path $logs 'prototype-build.log')

Write-Host "Prototype executable: $(Join-Path $prototypeBuild 'Release\ultimate-openvdb14.exe')"
Write-Host "Logs: $logs"
