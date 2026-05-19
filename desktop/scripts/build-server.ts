/**
 * Builds the unified sidecar binary via `bun build --compile`.
 *
 * The sidecar handles server, CLI, and adapters modes from a single binary:
 *   claude-sidecar server   — starts the HTTP/WS server
 *   claude-sidecar cli      — runs the CLI
 *
 * Usage:
 *   bun run desktop/scripts/build-server.ts           # current platform
 *   bun run desktop/scripts/build-server.ts win32     # cross-compile (if supported)
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

const PLATFORM_TARGETS: Record<string, string> = {
  win32: 'bun-windows-x64',
  darwin: 'bun-darwin-arm64',
  linux: 'bun-linux-x64',
}

const PLATFORM_EXTS: Record<string, string> = {
  win32: '.exe',
  darwin: '',
  linux: '',
}

const target = PLATFORM_TARGETS[targetPlatform]
if (!target) {
  console.error(`Unsupported platform: ${targetPlatform}`)
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

function createStub(pkgName: string): string {
  const dir = path.join(repoRoot, 'node_modules', ...pkgName.split('/'))
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
  if (parent !== path.join(repoRoot, 'node_modules') && parent.startsWith(path.join(repoRoot, 'node_modules'))) {
    try {
      const remaining = readdirSync(parent)
      if (remaining.length === 0) rmSync(parent, { recursive: true, force: true })
    } catch {
      // directory not empty or doesn't exist — fine
    }
  }
}

console.log(`Building sidecar for ${targetPlatform} (${target})...`)
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
  if (!existsSync(pkgDir)) {
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
  const ADAPTER_EXTERNAL_PACKAGES = [
    ...EXTERNAL_PACKAGES,
    // Adapter-specific dependencies — pulled from adapters/package.json
    'dingtalk-stream',
    '@larksuiteoapi/node-sdk',
    'grammy',
  ]

  // Ensure adapter dependencies have stubs if missing
  for (const pkg of ['dingtalk-stream', '@larksuiteoapi/node-sdk', 'grammy']) {
    const pkgDir = path.join(repoRoot, 'node_modules', ...pkg.split('/'))
    if (!existsSync(pkgDir)) {
      console.log(`  Creating stub: ${pkg}`)
      stubDirs.push(createStub(pkg))
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
