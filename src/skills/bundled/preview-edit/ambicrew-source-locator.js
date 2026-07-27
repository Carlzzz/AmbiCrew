// AmbiCrew Preview Source-Locator (dev-only Vite plugin)
//
// Tags elements with data-source="<relpath>:<line>:<col>" so the AmbiCrew
// preview pane can map a clicked DOM node back to its source. Handles:
//   - .jsx/.tsx  : Babel parse, inject on JSXOpeningElement (React)
//   - .vue/.svelte/.html : HTML scan, inject on opening tags (Vue/Svelte/HTML)
// Also injects a shared click-picker script into index.html.
//
// Register in vite.config.ts:
//   import ambicrewSourceLocator from './ambicrew-source-locator.js'
//   export default defineConfig({ plugins: [vue(), ambicrewSourceLocator()] })
// (put it before/after the framework plugin; it uses enforce:'pre')
//
// Requires (transitive in a Vite + framework project):
//   @babel/parser, magic-string (Vite deps); picker.js next to this file.
// Dev server only (apply: 'serve'). No-ops in build.

import path from 'node:path'
import fs from 'node:fs'
import { parse } from '@babel/parser'
import MagicString from 'magic-string'

// Shared picker - read from sibling picker.js so the Vite plugin and the
// AmbiCrew reverse proxy use the exact same script.
const PICKER_SCRIPT = fs.readFileSync(new URL('./picker.js', import.meta.url), 'utf8')

function relPath(projectRoot, id) {
  return path.relative(projectRoot, id).split(path.sep).join('/')
}

// Minimal recursive AST visitor for Babel nodes.
var SKIP = { loc: 1, start: 1, end: 1, range: 1, type: 1, extra: 1, leadingComments: 1, trailingComments: 1, innerComments: 1 }
function visit(node, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (var key in node) {
    if (SKIP[key]) continue
    var child = node[key]
    if (Array.isArray(child)) {
      for (var i = 0; i < child.length; i++) visit(child[i], fn)
    } else if (child && typeof child === 'object') {
      visit(child, fn)
    }
  }
}

// Inject data-source on JSX opening elements (React).
function injectJsxDataSource(code, rel) {
  var ast
  try {
    ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'], errorRecovery: true })
  } catch (e) {
    return null
  }
  var s = new MagicString(code)
  var inserted = Object.create(null)
  visit(ast, function (node) {
    if (node.type !== 'JSXOpeningElement') return
    var name = node.name
    if (!name || typeof name.end !== 'number') return
    var loc = node.loc && node.loc.start
    if (!loc) return
    var pos = name.end
    if (inserted[pos]) return
    inserted[pos] = true
    s.appendLeft(pos, ' data-source=' + JSON.stringify(rel + ':' + loc.line + ':' + (loc.column + 1)))
  })
  var count = 0
  for (var k in inserted) count++
  if (count === 0) return null
  return { code: s.toString(), map: s.generateMap({ source: rel, hires: true }) }
}

// Inject data-source on HTML opening tags (Vue .vue template, Svelte .svelte,
// .html). State machine skips <script>/<style>/<!-- --> and tracks line/col.
function injectHtmlDataSource(src, rel) {
  var s = new MagicString(src)
  var len = src.length
  var i = 0
  var line = 1
  var col = 1
  var state = 'html' // 'html' | 'script' | 'style' | 'comment'
  while (i < len) {
    if (state === 'comment') {
      if (src.startsWith('-->', i)) { state = 'html'; i += 3; col += 3 }
      else { if (src[i] === '\n') { line++; col = 1 } else col++; i++ }
      continue
    }
    if (state === 'script') {
      if (src.startsWith('</script', i) && !/[a-zA-Z0-9-]/.test(src[i + 8] || '')) { state = 'html' }
      else { if (src[i] === '\n') { line++; col = 1 } else col++; i++; continue }
    }
    if (state === 'style') {
      if (src.startsWith('</style', i) && !/[a-zA-Z0-9-]/.test(src[i + 7] || '')) { state = 'html' }
      else { if (src[i] === '\n') { line++; col = 1 } else col++; i++; continue }
    }
    // state === 'html'
    if (src.startsWith('<!--', i)) { state = 'comment'; i += 4; col += 4; continue }
    if (src.startsWith('<script', i) && !/[a-zA-Z0-9-]/.test(src[i + 7] || '')) { state = 'script'; i += 7; col += 7; continue }
    if (src.startsWith('<style', i) && !/[a-zA-Z0-9-]/.test(src[i + 6] || '')) { state = 'style'; i += 6; col += 6; continue }
    if (src[i] === '<' && /[a-zA-Z]/.test(src[i + 1] || '')) {
      var tagLine = line
      var tagCol = col
      var j = i + 1
      while (j < len && /[a-zA-Z0-9-]/.test(src[j])) j++
      s.appendLeft(j, ' data-source=' + JSON.stringify(rel + ':' + tagLine + ':' + tagCol))
      while (i < j) { if (src[i] === '\n') { line++; col = 1 } else col++; i++ }
      continue
    }
    if (src[i] === '\n') { line++; col = 1 } else col++
    i++
  }
  return { code: s.toString(), map: s.generateMap({ source: rel, hires: true }) }
}

export default function ambicrewSourceLocator() {
  var projectRoot = process.cwd()
  return {
    name: 'ambicrew-source-locator',
    apply: 'serve',
    // Run before framework plugins (plugin-vue / plugin-svelte / plugin-react)
    // so we inject data-source on real JSX/template markup before it's compiled.
    enforce: 'pre',
    configResolved: function (config) {
      projectRoot = (config && config.root) || projectRoot
    },
    transform: function (code, id) {
      if (id.indexOf('/node_modules/') !== -1 || id.indexOf('\\node_modules\\') !== -1) return null
      // Prefer the raw file so we always see real markup regardless of pipeline.
      var src = code
      try {
        if (fs.existsSync(id)) src = fs.readFileSync(id, 'utf8')
      } catch (e) { /* fall back to code */ }
      var rel = relPath(projectRoot, id)
      if (/\.[jt]sx$/.test(id)) {
        return injectJsxDataSource(src, rel)
      }
      if (/\.(vue|svelte|html)$/.test(id)) {
        return injectHtmlDataSource(src, rel)
      }
      return null
    },
    transformIndexHtml: function (html) {
      if (html.indexOf('__AMBICREW_PICKER__') !== -1) return html
      var script = '<script>' + PICKER_SCRIPT + '</script>'
      if (html.indexOf('</body>') !== -1) return html.replace('</body>', script + '</body>')
      return html + script
    },
  }
}
