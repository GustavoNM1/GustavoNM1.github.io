// Builds the static site from the design source (design.dc.html):
// extracts the template, the styles and the logic class, adds a small
// runtime that renders the template, and prerenders the first paint.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright/index.mjs';

const src = fs.readFileSync('design.dc.html', 'utf8');
const css = src.match(/<helmet>[\s\S]*?<style>([\s\S]*?)<\/style>[\s\S]*?<\/helmet>/)[1].trim();
const tpl = src.match(/<\/helmet>([\s\S]*?)<\/x-dc>/)[1].trim();
let logic = src.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1].trim();

const swap = (a, b) => {
  if (logic.split(a).length !== 2) throw new Error('logic anchor not found: ' + a.slice(0, 40));
  logic = logic.replace(a, b);
};
swap("openCase: () => { this.setState({ view: 'case', stage: 0 }); toTop(); },", "openCase: () => { location.hash = 'case/' + selObj.id; },");
swap("goHome: () => { this.setState({ view: 'home' }); toTop(); },", "goHome: () => { location.hash = 'systems'; },");
swap("nextCase: () => { this.setState({ picked: nextObj.id, stage: 0 }); toTop(); },", "nextCase: () => { location.hash = 'case/' + nextObj.id; },");

const runtime = `
(function () {
  var HOLE = /\\{\\{\\s*([^}]+?)\\s*\\}\\}/g;
  function lookup(scope, expr) {
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (/^-?\\d+(\\.\\d+)?$/.test(expr)) return Number(expr);
    var parts = expr.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  function whole(str) { var m = /^\\s*\\{\\{\\s*([^}]+?)\\s*\\}\\}\\s*$/.exec(str); return m ? m[1] : null; }
  function fill(str, scope) {
    return str.replace(HOLE, function (_, e) { var v = lookup(scope, e); return v == null ? '' : String(v); });
  }
  function build(node, scope, out) {
    if (node.nodeType === 3) { out.appendChild(document.createTextNode(fill(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.localName, i;
    if (tag === 'sc-for') {
      var list = lookup(scope, whole(node.getAttribute('list'))) || [], as = node.getAttribute('as');
      for (i = 0; i < list.length; i++) {
        var child = Object.create(scope); child[as] = list[i]; child.$index = i;
        for (var c = node.firstChild; c; c = c.nextSibling) build(c, child, out);
      }
      return;
    }
    if (tag === 'sc-if') {
      if (lookup(scope, whole(node.getAttribute('value')))) for (var d = node.firstChild; d; d = d.nextSibling) build(d, scope, out);
      return;
    }
    var el = document.createElementNS(node.namespaceURI, tag);
    for (i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i], name = a.name, w = whole(a.value);
      if (/^on[a-z]+$/.test(name) && w) { var fn = lookup(scope, w); if (typeof fn === 'function') el.addEventListener(name.slice(2), fn); continue; }
      el.setAttribute(name, fill(a.value, scope));
    }
    for (var k = node.firstChild; k; k = k.nextSibling) build(k, scope, el);
    out.appendChild(el);
  }

  function DCLogic() { this.props = {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    for (var k in patch) this.state[k] = patch[k];
    if (patch.lang) { try { localStorage.setItem('lang', patch.lang); } catch (e) {} }
    render();
  };
  window.DCLogic = DCLogic;

  ${logic}

  var root = document.getElementById('root');
  var tplRoot = document.getElementById('tpl').content;
  var comp = new Component();

  function initialLang() {
    var q = new URLSearchParams(location.search).get('lang'), saved = null;
    try { saved = localStorage.getItem('lang'); } catch (e) {}
    if (q === 'pt' || q === 'en') return q;
    if (saved === 'pt' || saved === 'en') return saved;
    return (navigator.language || '').toLowerCase().indexOf('pt') === 0 ? 'pt' : 'en';
  }
  function render() {
    var focusables = root.querySelectorAll('button, a[href]');
    var idx = Array.prototype.indexOf.call(focusables, document.activeElement);
    var frag = document.createDocumentFragment();
    var vals = comp.renderVals();
    for (var c = tplRoot.firstChild; c; c = c.nextSibling) build(c, vals, frag);
    root.replaceChildren(frag);
    document.documentElement.lang = comp.state.lang === 'pt' ? 'pt-BR' : 'en';
    if (idx >= 0) { var again = root.querySelectorAll('button, a[href]')[idx]; if (again) again.focus({ preventScroll: true }); }
  }
  function route(first) {
    var h = decodeURIComponent(location.hash.slice(1));
    if (h.indexOf('case/') === 0) {
      comp.state.view = 'case'; comp.state.picked = h.slice(5); comp.state.stage = 0;
      render(); window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    var wasCase = comp.state.view === 'case';
    comp.state.view = 'home';
    render();
    if (h && (wasCase || first)) { var t = document.getElementById(h); if (t) t.scrollIntoView(); }
    else if (wasCase) window.scrollTo({ top: 0, behavior: 'instant' });
  }
  comp.state.lang = initialLang();
  window.addEventListener('hashchange', function () { route(false); });
  route(true);
})();
`;

const head = (title, desc) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="profile">
<meta property="og:url" content="https://gustavonm1.github.io/">
<meta property="og:image" content="https://gustavonm1.github.io/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="627">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="https://gustavonm1.github.io/">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500&display=swap">
<style>
html{scroll-behavior:smooth;background:#fbfaf7}
${css}
@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}*{transition:none !important}}
@media print{header nav{display:none !important}}
</style>
</head>`;

const title = 'Gustavo Nunes Martins · Infrastructure & Security Engineer';
const desc = 'Twelve layers of IT I can build and run, from the cable to the SOC, with real case studies, AI experiments and my path so far.';
const page = (prerendered) => `${head(title, desc)}
<body>
<div id="root">${prerendered}</div>
<template id="tpl">
${tpl}
</template>
<script>${runtime}</script>
</body>
</html>
`;

fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#15181d"/><text x="32" y="45" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="38" fill="#fbfaf7">G</text></svg>\n`);
fs.writeFileSync('dist/.nojekyll', '');
fs.writeFileSync('dist/index.html', page(''));

// Prerender the English home view so the page has content before the script runs.
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ locale: 'en-US' });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(String(e)));
await pg.goto('file://' + path.resolve('dist/index.html'));
await pg.waitForSelector('#root h1');
const html = await pg.evaluate(() => document.getElementById('root').innerHTML);
await browser.close();
if (errors.length) { console.error(errors); process.exit(1); }
fs.writeFileSync('dist/index.html', page(html));
fs.writeFileSync('dist/404.html', page(html));
console.log('built', fs.statSync('dist/index.html').size, 'bytes');
