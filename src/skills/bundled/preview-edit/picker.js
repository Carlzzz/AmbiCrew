// AmbiCrew preview picker - injected into preview pages (by the Vite source-
// locator plugin in dev, or by the Bun reverse proxy for arbitrary pages).
// Listens for {type:'ambicrew:preview-mode', pick} from the parent to arm,
// then on click posts {type:'ambicrew:preview-pick', source?, selector, text,
// tag, outerHTML} to the parent. `source` is the data-source attribute
// (file:line:col) when present (Vite plugin); otherwise null and the parent
// falls back to selector/text so the agent can grep.
(function () {
  if (window.__AMBICREW_PICKER__) return
  window.__AMBICREW_PICKER__ = true
  var armed = false
  var last = null
  var label = document.createElement('div')
  label.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:rgba(17,17,17,.92);color:#7CFFB2;font:11px/1.4 monospace;padding:3px 7px;border-radius:5px;display:none;max-width:80vw;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;box-shadow:0 2px 8px rgba(0,0,0,.3)'
  function clear() { if (last) { last.style.outline = ''; last.style.outlineOffset = ''; last = null } label.style.display = 'none' }
  function srcOf(el) { var n = el; while (n) { if (n.getAttribute && n.getAttribute('data-source')) return n.getAttribute('data-source'); n = n.parentElement } return null }
  function cssPath(el) {
    var parts = []; var n = el
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      var sel = n.tagName.toLowerCase()
      if (n.id) { sel += '#' + n.id; parts.unshift(sel); break }
      var cls = (n.className && typeof n.className === 'string') ? n.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
      if (cls) sel += '.' + cls
      var sib = n; var i = 1
      while ((sib = sib.previousElementSibling)) { if (sib.tagName === n.tagName) i++ }
      if (i > 1) sel += ':nth-of-type(' + i + ')'
      parts.unshift(sel); n = n.parentElement
    }
    return parts.join(' > ')
  }
  function move(e) { label.style.left = (e.clientX + 14) + 'px'; label.style.top = (e.clientY + 14) + 'px' }
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'ambicrew:preview-mode') return
    armed = !!e.data.pick
    if (!armed) clear()
  })
  document.addEventListener('mouseover', function (e) {
    if (!armed) return
    clear()
    var t = e.target
    if (!(t instanceof Element)) return
    t.style.outline = '2px solid #4f8cff'
    t.style.outlineOffset = '-2px'
    last = t
    label.textContent = srcOf(t) || t.tagName.toLowerCase()
    label.style.display = 'block'
    move(e)
  }, true)
  document.addEventListener('mousemove', function (e) { if (armed && label.style.display === 'block') move(e) }, true)
  document.addEventListener('click', function (e) {
    if (!armed) return
    e.preventDefault(); e.stopPropagation()
    var t = e.target
    if (!(t instanceof Element)) return
    window.parent.postMessage({
      type: 'ambicrew:preview-pick',
      source: srcOf(t),
      selector: cssPath(t),
      text: (t.textContent || '').trim().slice(0, 120),
      tag: t.tagName.toLowerCase(),
      outerHTML: t.outerHTML.slice(0, 500)
    }, '*')
  }, true)
  function mount() { if (document.body && !label.parentNode) document.body.appendChild(label) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount()
})()
