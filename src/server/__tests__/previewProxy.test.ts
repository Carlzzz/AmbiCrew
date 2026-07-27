/**
 * Unit tests for the preview reverse proxy: anchor rewriting (navigation stays
 * inside the proxy), asset URL rewriting (assets load direct), nav reporting,
 * and the SSRF guard.
 */

import { describe, test, expect, afterEach } from 'bun:test'
import { handlePreviewProxyRequest } from '../services/previewProxy.js'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

/** Mock upstream fetch to return a fixed HTML page. finalUrl becomes the
 *  Response.url the proxy uses as the base for URL rewriting. */
function mockHtml(html: string, finalUrl: string) {
  globalThis.fetch = (async () => {
    const res = new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
    // Response.url is read-only via the constructor; define it to emulate the
    // post-redirect final URL the proxy reads.
    Object.defineProperty(res, 'url', { value: finalUrl })
    return res
  }) as unknown as typeof fetch
}

/** Build the proxy request URL for a given target. */
function proxyUrl(target: string): URL {
  return new URL('http://127.0.0.1:43124/preview-proxy?url=' + encodeURIComponent(target))
}

describe('preview proxy anchor rewriting', () => {
  test('routes in-page <a href> navigation back through the proxy', async () => {
    mockHtml(
      '<html><body><a href="/about">About</a></body></html>',
      'http://localhost:3000/',
    )
    const res = await handlePreviewProxyRequest(new Request('http://x'), proxyUrl('http://localhost:3000/'))
    const html = await res.text()
    // The link should point back at the proxy with the absolute target encoded.
    expect(html).toContain('/preview-proxy?url=' + encodeURIComponent('http://localhost:3000/about'))
    // It must NOT link directly to the origin page.
    expect(html).not.toContain('href="http://localhost:3000/about"')
  })

  test('leaves asset src pointing at the origin server (direct load)', async () => {
    mockHtml(
      '<html><body><img src="/logo.png"><script src="/app.js"></script></body></html>',
      'http://localhost:3000/',
    )
    const res = await handlePreviewProxyRequest(new Request('http://x'), proxyUrl('http://localhost:3000/'))
    const html = await res.text()
    expect(html).toContain('src="http://localhost:3000/logo.png"')
    expect(html).toContain('src="http://localhost:3000/app.js"')
    // Assets are not wrapped by the proxy.
    expect(html).not.toContain('/preview-proxy?url=' + encodeURIComponent('http://localhost:3000/logo.png'))
  })

  test('does not rewrite external, hash, mailto, or js anchors', async () => {
    mockHtml(
      '<html><body>' +
        '<a href="https://example.com/x">ext</a>' +
        '<a href="#top">hash</a>' +
        '<a href="mailto:a@b.c">mail</a>' +
        '<a href="javascript:void(0)">js</a>' +
        '</body></html>',
      'http://localhost:3000/',
    )
    const res = await handlePreviewProxyRequest(new Request('http://x'), proxyUrl('http://localhost:3000/'))
    const html = await res.text()
    expect(html).toContain('href="https://example.com/x"')
    expect(html).toContain('href="#top"')
    expect(html).toContain('href="mailto:a@b.c"')
    expect(html).toContain('href="javascript:void(0)"')
    // None of these should be proxy-wrapped.
    expect(html).not.toContain('/preview-proxy?url=https')
  })

  test('injects the nav report with the real page URL', async () => {
    mockHtml('<html><body>hi</body></html>', 'http://localhost:3000/dashboard')
    const res = await handlePreviewProxyRequest(new Request('http://x'), proxyUrl('http://localhost:3000/dashboard'))
    const html = await res.text()
    expect(html).toContain('ambicrew:preview-nav')
    expect(html).toContain('http://localhost:3000/dashboard')
  })

  test('rejects non-loopback targets (SSRF guard)', async () => {
    const res = await handlePreviewProxyRequest(new Request('http://x'), proxyUrl('http://evil.example.com/'))
    expect(res.status).toBe(403)
  })
})
