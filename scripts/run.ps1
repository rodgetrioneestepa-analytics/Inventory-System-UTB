param(
  [Parameter(Position=0)][ValidateSet('dev','build','test','test:browser','test:deployment','start','tunnel','migrate','admin:create','catalog:import')][string]$Task='dev',
  [Parameter(ValueFromRemainingArguments=$true)][string[]]$TaskArguments
)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$nodeCommand=Get-Command node -ErrorAction SilentlyContinue
if($nodeCommand){$nodePath=$nodeCommand.Source}elseif($env:UTB_NODE_PATH){$nodePath=$env:UTB_NODE_PATH}elseif(Test-Path -LiteralPath '.local\runtime.json'){
  $runtimeConfig=Get-Content -Raw -LiteralPath '.local\runtime.json' | ConvertFrom-Json
  $nodePath=$runtimeConfig.node
}else{
  $runtime=Get-ChildItem -LiteralPath 'C:\Program Files\WindowsApps' -Directory -Filter 'OpenAI.CodexPrimaryRuntime*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if(!$runtime){throw 'Install Node.js 24 or newer, including npm, first.'}
  $nodePath=Join-Path $runtime.FullName 'dependencies\node\bin\node.exe'
}
if(!(Test-Path -LiteralPath $nodePath)){throw 'The configured Node runtime is missing. Install Node.js 24+ or set UTB_NODE_PATH to its executable.'}
$env:PATH=(Split-Path -Parent $nodePath)+';'+(Join-Path (Get-Location) 'node_modules\.bin')+';'+$env:PATH
if(!(Test-Path -LiteralPath 'node_modules')){throw 'Install dependencies using npm install (or pnpm install) first.'}
switch($Task){
  'build'{& $nodePath node_modules/typescript/bin/tsc -p config/tsconfig.backend.json;if($LASTEXITCODE -ne 0){exit $LASTEXITCODE};& $nodePath node_modules/typescript/bin/tsc -p config/tsconfig.frontend.json;if($LASTEXITCODE -ne 0){exit $LASTEXITCODE};& $nodePath node_modules/vite/bin/vite.js build --config config/vite.config.ts}
  'dev'{& $nodePath node_modules/concurrently/dist/bin/concurrently.js -k 'tsx watch inventory-webapp/backend/src/index.ts' 'vite --config config/vite.config.ts --host 127.0.0.1'}
  'test'{& $nodePath --import tsx --test 'tests/backend/*.test.ts'}
  'test:browser'{& $nodePath node_modules/@playwright/test/cli.js test --config config/playwright.config.ts}
  'test:deployment'{& $nodePath --test tests/deployment.test.mjs}
  'start'{& $nodePath --env-file-if-exists=.env dist/server/index.js}
  'tunnel'{& $nodePath scripts/local-tunnel.mjs @TaskArguments}
  'migrate'{& $nodePath --import tsx inventory-webapp/backend/src/migrate.ts}
  'admin:create'{& $nodePath --import tsx inventory-webapp/backend/src/admin.ts @TaskArguments}
  'catalog:import'{& $nodePath --import tsx inventory-webapp/backend/src/catalog.ts @TaskArguments}
}
exit $LASTEXITCODE
