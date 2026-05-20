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
import { mkdirSync, existsSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopDir, '..')
const resourcesDir = path.join(desktopDir, 'resources')

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

try {
  execSync(
    `bun build --compile --target=${target} ${externalFlags} desktop/sidecars/desktop-sidecar.ts --outfile="${outfile}"`,
    {
      cwd: repoRoot,
      stdio: 'inherit',
    },
  )
  console.log('Sidecar binary built successfully.')

  // Phase 2b: Build adapter sidecar
  // Adapter source files use static top-level imports of these packages.
  // Unlike EXTERNAL_PACKAGES (which are only loaded via dynamic import()),
  // Bun --compile must resolve the named exports at build time, so stubs
  // are not sufficient — the real packages must be installed.
  const ADAPTER_EXTERNAL_PACKAGES = [
    ...EXTERNAL_PACKAGES,
    'dingtalk-stream',
    '@larksuiteoapi/node-sdk',
    'grammy',
  ]

  const adaptersDir = path.join(repoRoot, 'adapters')
  console.log('  Installing adapter dependencies...')
  execSync('bun install', { cwd: adaptersDir, stdio: 'inherit' })

  // Ensure stubs in root node_modules so --external can locate the packages
  // (Bun resolves from repoRoot as cwd and needs them in the root tree)
  for (const pkg of ['dingtalk-stream', '@larksuiteoapi/node-sdk', 'grammy']) {
    const rootPkgDir = path.join(repoRoot, 'node_modules', ...pkg.split('/'))
    if (!existsSync(rootPkgDir) || !existsSync(path.join(rootPkgDir, 'package.json'))) {
      console.log(`  Creating stub: ${pkg} in root node_modules`)
      stubDirs.push(createStub(pkg, repoRoot))
    }
  }

  const adapterExternalFlags = ADAPTER_EXTERNAL_PACKAGES.map((p) => `--external:${p}`).join(' ')

  execSync(
    `bun build --compile --target=${target} ${adapterExternalFlags} desktop/sidecars/adapter-sidecar.ts --outfile="${adapterOutfile}"`,
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
