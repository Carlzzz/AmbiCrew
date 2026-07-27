// Reverse proxy that lets the desktop preview pane load ARBITRARY localhost
// pages (static HTML, built SPAs, etc.) with the AmbiCrew picker injected.
//
// The desktop can't inject scripts into a cross-origin iframe (browser
// security), so for non-Vite pages we fetch the page server-side, strip
// framing-blocking headers, rewrite relative asset URLs to absolute, inject
// the picker, and return. Vite dev (with the source-locator plugin) doesn't
// need this - it loads the dev server directly.

// @ts-ignore - Bun text import (embeds the picker source at compile time)
import PICKER_SCRIPT from '../../skills/bundled/preview-edit/picker.js' with { type: 'text' }

const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1'])

/** SSRF guard: only http(s) to loopback hosts is allowed. serverPort (the
 *  port this server listens on) is blocked too, so the proxy can't be used
 *  to read the server's own APIs (self-SSRF). */
function isAllowedTarget(target: string, serverPort?: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (!ALLOWED_HOSTNAMES.has(parsed.hostname)) return false
  if (serverPort && parsed.port === serverPort) return false
  return true
}

/** Rewrite relative src/href to absolute against the page base, so assets
 *  load from the original server instead of the proxy origin. */
function rewriteRelativeUrls(html: string, base: URL): string {
  return html.replace(
    /((?:src|href)\s*=\s*)(["'])([^"']+)\2/gi,
    (match, attr: string, quote: string, val: string) => {
      if (/^(?:https?:|\/\/|data:|blob:|mailto:|tel:|javascript:|#)/i.test(val)) return match
      try {
        return attr + quote + new URL(val, base).toString() + quote
      } catch {
        return match
      }
    },
  )
}

/** Route in-page navigation (<a href>) back through the proxy so the target
 *  page also gets its framing headers stripped and the picker injected. Runs
 *  AFTER rewriteRelativeUrls, so hrefs are already absolute. Only loopback
 *  http(s) links are wrapped; external/mailto/tel/#/js links are left alone
 *  (the proxy would reject them anyway). proxyPath is this proxy's own path
 *  (e.g. "/preview-proxy"); the result is root-relative so it resolves against
 *  the iframe's origin (the proxy server), not the proxied page's origin. */
function rewriteAnchorLinks(html: string, base: URL, proxyPath: string): string {
  return html.replace(/<a\b[^>]*>/gi, (tag) =>
    tag.replace(
      /(\bhref\s*=\s*)(["'])([^"']*)\2/i,
      (match, attr: string, quote: string, val: string) => {
        const v = val.trim()
        if (v === '' || /^(?:#|mailto:|tel:|javascript:|data:|blob:)/i.test(v)) return match
        let abs: URL
        try {
          abs = new URL(v, base)
        } catch {
          return match
        }
        if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return match
        if (!ALLOWED_HOSTNAMES.has(abs.hostname)) return match
        return attr + quote + proxyPath + '?url=' + encodeURIComponent(abs.toString()) + quote
      },
    ),
  )
}

/** Strip headers that prevent framing or leak cookies; keep safe ones. */
function buildSafeHeaders(upstream: Response, isHtml: boolean): Headers {
  const headers = new Headers()
  const contentType = upstream.headers.get('content-type')
  if (contentType) headers.set('content-type', isHtml ? 'text/html; charset=utf-8' : contentType)
  const cacheControl = upstream.headers.get('cache-control')
  if (cacheControl) headers.set('cache-control', cacheControl)
  // Allow the proxied page's cross-origin asset loads + script injection.
  headers.set('access-control-allow-origin', '*')
  // Deliberately drop: x-frame-options, content-security-policy, set-cookie,
  // location (we serve 200), and any other framing blockers.
  return headers
}

export async function handlePreviewProxyRequest(_req: Request, url: URL): Promise<Response> {
  const target = url.searchParams.get('url')
  if (!target) {
    return Response.json({ error: 'Missing url parameter' }, { status: 400 })
  }
  // serverPort = the port this proxy server listens on (from the request URL),
  // used to block self-SSRF to the server's own APIs.
  const serverPort = url.port
  if (!isAllowedTarget(target, serverPort)) {
    return Response.json(
      { error: 'Only http(s) to 127.0.0.1/localhost/::1 is allowed (and not this server)' },
      { status: 403 },
    )
  }

  let upstream: Response
  try {
    upstream = await fetch(target, {
      headers: { accept: 'text/html,application/xhtml+xml,*/*' },
      redirect: 'follow',
      // Bound the upstream fetch so a hanging local server can't stall the proxy.
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    return Response.json(
      { error: 'Failed to fetch target', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    )
  }

  // Re-validate the FINAL (post-redirect) URL - a localhost server must not
  // redirect the proxy to an external/internal target (redirect SSRF bypass).
  if (!isAllowedTarget(upstream.url || target, serverPort)) {
    return Response.json(
      { error: 'Target redirected to a disallowed host' },
      { status: 403 },
    )
  }

  const contentType = upstream.headers.get('content-type') || ''
  const isHtml = contentType.includes('text/html') || contentType.includes('xhtml')

  if (!isHtml) {
    // Non-HTML asset (JS/CSS/image): pass through with permissive CORS.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: buildSafeHeaders(upstream, false),
    })
  }

  // Use the final (post-redirect) URL as the base for relative URL rewriting.
  const base = new URL(upstream.url || target)
  let html = await upstream.text()
  html = rewriteRelativeUrls(html, base)
  // Keep in-page navigation inside the proxy so linked pages also get the
  // picker injected and framing headers stripped. url.pathname is this proxy's
  // own path (e.g. "/preview-proxy").
  html = rewriteAnchorLinks(html, base, url.pathname)

  // Report the real (proxied) URL to the parent so it can sync the address bar,
  // then load the shared picker.
  const urlReport =
    '<script>try{parent.postMessage({type:"ambicrew:preview-nav",url:' +
    JSON.stringify(base.toString()) +
    '},"*")}catch(e){}</script>'
  const script = urlReport + '<script>' + PICKER_SCRIPT + '</script>'
  if (html.includes('</body>')) {
    html = html.replace('</body>', script + '</body>')
  } else {
    html = html + script
  }

  return new Response(html, { status: 200, headers: buildSafeHeaders(upstream, true) })
}
