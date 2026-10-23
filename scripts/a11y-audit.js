// Paste into the browser console (or run via the in-app browser's javascript tool) on any page.
// Reports text elements below WCAG AA contrast, and interactive elements smaller than 44px (mobile).
(() => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] } }
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 })
  const bgOf = (el) => {
    const stack = []
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a === 1) break } }
    let base = { r: 255, g: 255, b: 255, a: 1 }
    for (const c of stack.reverse()) base = over(c, base)
    return base
  }
  const bad = []
  const seen = new Set()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const n = walker.currentNode
    if (!n.textContent.trim()) continue
    const el = n.parentElement
    if (!el || seen.has(el) || el.closest('script,style,noscript')) continue
    seen.add(el)
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const fg = parse(cs.color); if (!fg) continue
    const bg = bgOf(el)
    const f = over(fg, bg)
    const ratio = (Math.max(lum(f), lum(bg)) + 0.05) / (Math.min(lum(f), lum(bg)) + 0.05)
    const px = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700
    const large = px >= 24 || (px >= 18.66 && bold)
    const need = large ? 3 : 4.5
    if (ratio < need) bad.push({ text: n.textContent.trim().slice(0, 40), ratio: +ratio.toFixed(2), need, color: cs.color, tag: el.tagName })
  }
  const small = []
  document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button]').forEach((el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
    if (r.width === 0 || cs.visibility === 'hidden' || el.classList.contains('sr-only')) return
    if (el.tagName === 'A' && el.closest('p, li > span, dd') && !el.className.includes('button')) return // inline text links
    if (r.height < 43.5 && !(el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox'))) small.push({ el: (el.innerText || el.getAttribute('aria-label') || el.name || el.tagName).trim().slice(0, 30), h: Math.round(r.height), w: Math.round(r.width) })
  })
  return { path: location.pathname, viewport: innerWidth, horizontalOverflow: document.documentElement.scrollWidth - innerWidth, lowContrast: bad.slice(0, 12), lowContrastCount: bad.length, smallTargets: small.slice(0, 12), smallTargetCount: small.length }
})()
