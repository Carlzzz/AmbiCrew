/**
 * Builds the unified sidecar binary via `bun build --compile`.
 *
 * The sidecar handles server, CLI, and adapters modes from a single binary:
 *   claude-sidecar server   — starts the HTTP/WS server
 *   claude-sidecar cli      — runs the CLI
 *
 * Usage:
 *   bun run desktop/scripts/build-server.ts                    # current platform + arch
 *   bun run desktop/scripts/build-server.ts win32              # Windows x64
 *   bun run desktop/scripts/build-server.ts darwin             # macOS (host arch)
 *   bun run desktop/scripts/build-server.ts darwin arm64       # macOS Apple Silicon
 *   bun run desktop/scripts/build-server.ts darwin x64         # macOS Intel
 *
 * Output:
 *   desktop/resources/claude-sidecar.exe   (Windows)
 *   desktop/resources/claude-sidecar        (macOS / Linux)
 */

import { execSync } from 'node:child_process'
import { mkdirSync, existsSync, rmSync, writeFileSync, readdirSync, readFileSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopDir, '..')
const resourcesDir = path.join(desktopDir, 'resources')

// Resolve the app version to bake into the compiled sidecar. preload.ts reads
// CLAUDE_CODE_LOCAL_VERSION at startup to populate MACRO.VERSION (used by
// `/version`, the auto-updater, and the CrewCentral device heartbeat). Without
// this, the compiled binary falls back to '999.0.0-local'. Source of truth is
// desktop/package.json, kept in sync with tauri.conf.json.
function resolveAppVersion(): string {
  if (process.env.CLAUDE_CODE_LOCAL_VERSION) {
    return process.env.CLAUDE_CODE_LOCAL_VERSION
  }
  try {
    const pkg = JSON.parse(readFileSync(path.join(desktopDir, 'package.json'), 'utf-8')) as {
      version?: string
    }
    if (pkg.version) return pkg.version
  } catch {
    // fall through to default
  }
  return '0.0.0'
}

const appVersion = resolveAppVersion()
const buildEnv = {
  ...process.env,
  CLAUDE_CODE_LOCAL_VERSION: appVersion,
  CLAUDE_CODE_LOCAL_BUILD_TIME: new Date().toISOString(),
}
console.log(`[build-server] Baking version ${appVersion} into sidecar`)

const targetPlatform = process.argv[2] || process.platform
const targetArch = process.argv[3] || process.arch

const PLATFORM_TARGETS: Record<string, Record<string, string>> = {
  win32: { x64: 'bun-windows-x64' },
  darwin: { arm64: 'bun-darwin-arm64', x64: 'bun-darwin-x64' },
  linux: { x64: 'bun-linux-x64' },
}

const PLATFORM_EXTS: Record<string, string> = {
  win32: '.exe',
  darwin: '',
  linux: '',
}

const platformTargets = PLATFORM_TARGETS[targetPlatform]
if (!platformTargets) {
  console.error(`Unsupported platform: ${targetPlatform}`)
  process.exit(1)
}
const target = platformTargets[targetArch]
if (!target) {
  console.error(`Unsupported arch: ${targetArch} for platform ${targetPlatform}`)
  process.exit(1)
}

const ext = PLATFORM_EXTS[targetPlatform]
const sidecarName = `claude-sidecar${ext}`
const outfile = path.join(resourcesDir, sidecarName)
const adapterSidecarName = `adapter-sidecar${ext}`
const adapterOutfile = path.join(resourcesDir, adapterSidecarName)

// Ensure output directory exists
mkdirSync(resourcesDir, { recursive: true })

// Remove old binaries if they exist
if (existsSync(outfile)) {
  rmSync(outfile)
}
if (existsSync(adapterOutfile)) {
  rmSync(adapterOutfile)
}

/** Packages loaded via dynamic import() for optional platform features.
 *  Bun build --compile cannot resolve these unless they exist in node_modules,
 *  so we create lightweight stubs and mark them as --external. */
const EXTERNAL_PACKAGES = [
  '@aws-sdk/client-sts',
  '@aws-sdk/client-bedrock',
  '@aws-sdk/credential-provider-node',
  '@aws-sdk/credential-providers',
  '@anthropic-ai/bedrock-sdk',
  '@anthropic-ai/foundry-sdk',
  '@anthropic-ai/vertex-sdk',
  '@anthropic-ai/mcpb',
  '@azure/identity',
  '@opentelemetry/exporter-metrics-otlp-grpc',
  '@opentelemetry/exporter-metrics-otlp-http',
  '@opentelemetry/exporter-metrics-otlp-proto',
  '@opentelemetry/exporter-prometheus',
  '@opentelemetry/exporter-logs-otlp-grpc',
  '@opentelemetry/exporter-logs-otlp-http',
  '@opentelemetry/exporter-logs-otlp-proto',
  '@opentelemetry/exporter-trace-otlp-grpc',
  '@opentelemetry/exporter-trace-otlp-http',
  '@opentelemetry/exporter-trace-otlp-proto',
  '@smithy/core',
  '@smithy/node-http-handler',
  'audio-capture-napi',
  'cacache',
  'cli-highlight',
  'fflate',
  'image-processor-napi',
  'plist',
  'sharp',
  'url-handler-napi',
]

const STUB_INDEX = 'throw new Error("This package is a build-time stub; it must be installed at runtime for the feature to work.")'

function createStub(pkgName: string, baseDir = repoRoot): string {
  const dir = path.join(baseDir, 'node_modules', ...pkgName.split('/'))
  mkdirSync(dir, { recursive: true })
  const pkgJson = path.join(dir, 'package.json')
  if (!existsSync(pkgJson)) {
    writeFileSync(pkgJson, JSON.stringify({ name: pkgName, version: '0.0.0-stub', main: 'index.js' }), 'utf-8')
    writeFileSync(path.join(dir, 'index.js'), STUB_INDEX, 'utf-8')
  }
  return dir
}

function removeStub(stubDir: string) {
  try { rmSync(stubDir, { recursive: true, force: true }) } catch {}
  // Clean up empty scope directories (e.g. node_modules/@aws-sdk)
  const parent = path.dirname(stubDir)
  const isRootNodeModules = parent.startsWith(path.join(repoRoot, 'node_modules'))
  const isAdaptersNodeModules = parent.startsWith(path.join(repoRoot, 'adapters', 'node_modules'))
  if (isRootNodeModules || isAdaptersNodeModules) {
    try {
      const remaining = readdirSync(parent)
      if (remaining.length === 0) rmSync(parent, { recursive: true, force: true })
    } catch {
      // directory not empty or doesn't exist — fine
    }
  }
}

console.log(`Building sidecar for ${targetPlatform}-${targetArch} (${target})...`)
console.log(`  Entry:  desktop/sidecars/desktop-sidecar.ts`)
console.log(`  Output: ${outfile}`)

// Phase 0: Download ripgrep for the target platform
console.log('[build-server] Downloading ripgrep...')
execSync(`bun run desktop/scripts/download-ripgrep.ts ${targetPlatform}`, {
  cwd: repoRoot,
  stdio: 'inherit',
})

// Phase 1: Create stubs for missing optional dependencies
const stubDirs: string[] = []
for (const pkg of EXTERNAL_PACKAGES) {
  const pkgDir = path.join(repoRoot, 'node_modules', ...pkg.split('/'))
  if (!existsSync(pkgDir) || !existsSync(path.join(pkgDir, 'package.json'))) {
    console.log(`  Creating stub: ${pkg}`)
    stubDirs.push(createStub(pkg))
  }
}

// Phase 2: Build
const externalFlags = EXTERNAL_PACKAGES.map((p) => `--external:${p}`).join(' ')

// Inline the version/build-time at compile time. A compiled binary runs in the
// user's environment where these env vars don't exist, so build-time env alone
// is not enough — --define replaces the process.env reads with string literals.
const defineFlags = [
  `--define process.env.CLAUDE_CODE_LOCAL_VERSION=${JSON.stringify(appVersion)}`,
  `--define process.env.CLAUDE_CODE_LOCAL_BUILD_TIME=${JSON.stringify(buildEnv.CLAUDE_CODE_LOCAL_BUILD_TIME)}`,
].join(' ')

try {
  execSync(
    `bun build --compile --target=${target} ${externalFlags} ${defineFlags} desktop/sidecars/desktop-sidecar.ts --outfile="${outfile}"`,
    {
      cwd: repoRoot,
      stdio: 'inherit',
    },
  )
  console.log('Sidecar binary built successfully.')

  // Phase 2b: Build adapter sidecar
  // Adapter packages (dingtalk-stream, @larksuiteoapi/node-sdk, grammy) are
  // bundled INTO the binary so the compiled sidecar has no runtime dependency
  // on node_modules. Only the base EXTERNAL_PACKAGES remain external.
  const ADAPTER_EXTERNAL_PACKAGES = [
    ...EXTERNAL_PACKAGES,
  ]

  const adaptersDir = path.join(repoRoot, 'adapters')
  console.log('  Installing adapter dependencies...')
  // Use --force to ensure a full install even when lockfile reports "no changes".
  // Without it, Bun may skip extracting distribution files (out/, dist/) from its
  // cache, leaving packages with only package.json/README — which causes the
  // bundler to fail resolving named exports from adapter source files.
  execSync('bun install --force', { cwd: adaptersDir, stdio: 'inherit' })

  // Link real adapter packages from adapters/node_modules into root node_modules
  // so bun build --compile can resolve named exports at build time.
  // Simple stubs are NOT sufficient because the adapter source files use static
  // top-level imports with named bindings (e.g. `import { Bot } from 'grammy'`)
  // that Bun must resolve even when --external is specified.
  const adapterPkgs = ['dingtalk-stream', '@larksuiteoapi/node-sdk', 'grammy']
  for (const pkg of adapterPkgs) {
    const rootPkgDir = path.join(repoRoot, 'node_modules', ...pkg.split('/'))
    const adapterPkgDir = path.join(adaptersDir, 'node_modules', ...pkg.split('/'))
    if (existsSync(rootPkgDir) && existsSync(path.join(rootPkgDir, 'package.json'))) {
      continue // already present (e.g. user installed it globally)
    }
    if (!existsSync(adapterPkgDir)) {
      console.warn(`  ⚠️ ${pkg} not found in adapters/node_modules — adapter sidecar build may fail`)
      continue
    }
    // Ensure parent scope directory exists (e.g. node_modules/@larksuiteoapi)
    const parentDir = path.dirname(rootPkgDir)
    mkdirSync(parentDir, { recursive: true })
    // Remove any leftover stub directory
    if (existsSync(rootPkgDir)) {
      rmSync(rootPkgDir, { recursive: true, force: true })
    }
    // Use symlink (junction on Windows for cross-drive compat)
    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir'
    try {
      symlinkSync(adapterPkgDir, rootPkgDir, symlinkType)
      console.log(`  Linked: ${pkg} → adapters/node_modules/${pkg}`)
      stubDirs.push(rootPkgDir) // track for cleanup
    } catch (linkErr) {
      // Fallback: copy the directory if symlink fails (e.g. permissions)
      console.warn(`  Symlink failed for ${pkg}, falling back to copy:`, linkErr instanceof Error ? linkErr.message : linkErr)
      execSync(
        process.platform === 'win32'
          ? `xcopy "${adapterPkgDir}" "${rootPkgDir}" /E /I /Q /Y`
          : `cp -R "${adapterPkgDir}" "${rootPkgDir}"`,
        { stdio: 'pipe' },
      )
      console.log(`  Copied: ${pkg} from adapters/node_modules`)
      stubDirs.push(rootPkgDir) // track for cleanup
    }
  }

  const adapterExternalFlags = ADAPTER_EXTERNAL_PACKAGES.map((p) => `--external:${p}`).join(' ')

  execSync(
    `bun build --compile --target=${target} ${adapterExternalFlags} ${defineFlags} desktop/sidecars/adapter-sidecar.ts --outfile="${adapterOutfile}"`,
    {
      cwd: repoRoot,
      stdio: 'inherit',
    },
  )
  console.log('Adapter sidecar binary built successfully.')
} finally {
  // Phase 3: Clean up stubs
  for (const dir of stubDirs) {
    removeStub(dir)
  }
}
