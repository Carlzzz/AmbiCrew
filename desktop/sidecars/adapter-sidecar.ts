/**
 * Adapter-only sidecar entry — handles IM adapters mode exclusively.
 *
 * Mirrors desktop-sidecar.ts (which handles server/cli) but for adapters.
 * Splitting into separate binaries avoids pulling adapter dependencies
 * (grammy, @larksuiteoapi/node-sdk, dingtalk-stream) into the server binary.
 *
 * Usage:
 *   adapter-sidecar --feishu --telegram --wechat --dingtalk [--app-root <path>]
 */

let appRoot: string | null = process.env.CLAUDE_APP_ROOT ?? null
let enableFeishu = false
let enableTelegram = false
let enableWechat = false
let enableDingtalk = false

for (let i = 0; i < process.argv.length; i++) {
  const arg = process.argv[i]
  if (arg === '--app-root') {
    appRoot = process.argv[i + 1] ?? null
    i += 1
    continue
  }
  if (arg === '--feishu') { enableFeishu = true; continue }
  if (arg === '--telegram') { enableTelegram = true; continue }
  if (arg === '--wechat') { enableWechat = true; continue }
  if (arg === '--dingtalk') { enableDingtalk = true; continue }
}

if (!enableFeishu && !enableTelegram && !enableWechat && !enableDingtalk) {
  console.error('adapter-sidecar: must enable at least one of --feishu / --telegram / --wechat / --dingtalk')
  process.exit(2)
}

if (appRoot) {
  process.env.CLAUDE_APP_ROOT = appRoot
}
process.env.CALLER_DIR ||= process.cwd()

await import('../../preload.ts')

const { loadConfig } = await import('../../adapters/common/config.ts')
const config = loadConfig()

let started = 0

if (enableFeishu) {
  if (!config.feishu.appId || !config.feishu.appSecret) {
    console.warn('[adapter-sidecar] --feishu requested but FEISHU_APP_ID / FEISHU_APP_SECRET missing — skipping')
  } else {
    console.log('[adapter-sidecar] starting Feishu adapter')
    await import('../../adapters/feishu/index.ts')
    started += 1
  }
}

if (enableTelegram) {
  if (!config.telegram.botToken) {
    console.warn('[adapter-sidecar] --telegram requested but TELEGRAM_BOT_TOKEN missing — skipping')
  } else {
    console.log('[adapter-sidecar] starting Telegram adapter')
    await import('../../adapters/telegram/index.ts')
    started += 1
  }
}

if (enableWechat) {
  if (!config.wechat.accountId || !config.wechat.botToken) {
    console.warn('[adapter-sidecar] --wechat requested but no QR-bound WeChat account found — skipping')
  } else {
    console.log('[adapter-sidecar] starting WeChat adapter')
    await import('../../adapters/wechat/index.ts')
    started += 1
  }
}

if (enableDingtalk) {
  if (!config.dingtalk.clientId || !config.dingtalk.clientSecret) {
    console.warn('[adapter-sidecar] --dingtalk requested but DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET missing — skipping')
  } else {
    console.log('[adapter-sidecar] starting DingTalk adapter')
    await import('../../adapters/dingtalk/index.ts')
    started += 1
  }
}

if (started === 0) {
  console.error('[adapter-sidecar] no adapter could be started — check credentials in env or ~/.claude/adapters.json')
  process.exit(1)
}
