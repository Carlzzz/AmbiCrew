/**
 * Desktop-only sidecar entry — server and CLI modes only.
 *
 * Omits the adapters mode to avoid pulling in adapter dependencies
 * (grammy, @larksuiteoapi/node-sdk, dingtalk-stream) that aren't
 * needed for the desktop Electron app.
 *
 * Usage:
 *   claude-sidecar server   --app-root <path>
 *   claude-sidecar cli      --app-root <path> [CLI args...]
 */

import { parseLauncherArgs, resolveSidecarInvocation } from './launcherRouting'

const rawArgs = process.argv.slice(2)
const invocation = resolveSidecarInvocation(rawArgs)
if (!invocation.mode) {
  console.error('claude-sidecar: missing mode argument (expected "server" or "cli")')
  process.exit(2)
}
const mode = invocation.mode
const restArgs = invocation.restArgs

if (mode === 'adapters') {
  console.error('claude-sidecar: adapters mode is not supported in desktop builds')
  process.exit(2)
}

const { appRoot, args } = parseLauncherArgs(restArgs, invocation.defaultAppRoot)

process.env.CLAUDE_APP_ROOT = appRoot
process.env.CALLER_DIR ||= process.cwd()
process.argv = [process.argv[0]!, process.argv[1]!, ...args]

await import('../../preload.ts')

if (mode === 'server') {
  const { startServer } = await import('../../src/server/index.ts')
  startServer()
} else if (mode === 'cli') {
  await import('../../src/entrypoints/cli.tsx')
} else {
  console.error(`claude-sidecar: unknown mode "${mode}"`)
  process.exit(2)
}
