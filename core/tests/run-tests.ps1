$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir '..\..')
$buildPath = Join-Path $projectRoot 'core\.build'
New-Item -ItemType Directory -Force -Path $buildPath | Out-Null
$outputPath = Join-Path $buildPath 'solar-system-core-tests.exe'

& gcc -std=c17 -Wall -Wextra -Werror -O2 `
  (Join-Path $projectRoot 'core\src\solar_system.c') `
  (Join-Path $projectRoot 'core\tests\test_solar_system.c') `
  '-I' (Join-Path $projectRoot 'core\include') `
  '-lm' '-o' $outputPath

if ($LASTEXITCODE -ne 0) { throw 'C17 core compilation failed.' }

& $outputPath
if ($LASTEXITCODE -ne 0) { throw 'C17 core tests failed.' }
