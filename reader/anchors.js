/* Calculus Fennicus reader — language-independent comment anchors.
 *
 * Both editions carry the same hyperref destination names (Thm.1.10.1,
 * equation.8.3, Item.412, section.11.6 …) at different pages. A comment is
 * anchored to the nearest such destination at or above it:
 *
 *   { dest: 'Thm.1.10.1', dp: 0, dy: 0.08 }
 *     dp = 0  → same page as the destination; dy = fraction BELOW its top
 *     dp > 0  → dp pages after the destination's page; dy = absolute fraction
 *               on that page (pages without any destination, e.g. long proofs)
 *
 * resolve(doc, anchor) turns that back into {page, y, approx} in either
 * edition using dests-<doc>.json (tools/gen-dests.py). Labels (labels-<doc>.json)
 * give the human title: "Theorem I.10.1 · Cauchy sequences".
 */
export function initAnchors(R, CFG) {
  const V = CFG.buildVersion && CFG.buildVersion !== 'dev' ? '?v=' + encodeURIComponent(CFG.buildVersion) : '';
  const dests = {};     // doc -> { byName: {name:[page, top]}, byPage: Map(page -> [[top,name],…] sorted), pages: sorted page list }
  const labels = {};    // doc -> { key: {ref,page,dest,title,kind,part} }
  const byDest = {};    // doc -> { dest: key }
  const loading = {};

  async function fetchJson(url) {
    const r = await fetch(url + V, { cache: 'force-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return r.json();
  }

  /* Load the destination + label tables of one edition (cached). */
  async function load(doc) {
    if (dests[doc]) return dests[doc];
    if (loading[doc]) return loading[doc];
    loading[doc] = (async () => {
      let raw = {};
      try { raw = await fetchJson((CFG.dests || {})[doc] || ('dests-' + doc + '.json')); } catch (e) { console.warn('dests table missing for', doc, e.message); }
      const byPage = new Map();
      for (const name in raw) {
        const [page, top] = raw[name];
        if (!byPage.has(page)) byPage.set(page, []);
        byPage.get(page).push([top, name]);
      }
      for (const arr of byPage.values()) arr.sort((a, b) => a[0] - b[0]);
      const pages = [...byPage.keys()].sort((a, b) => a - b);
      dests[doc] = { byName: raw, byPage, pages };
      // labels: the viewer already holds the current edition's table
      let lab = null;
      if (R.doc === doc && R.labels && Object.keys(R.labels).length) lab = R.labels;
      else { try { lab = await fetchJson((CFG.labels || {})[doc] || ('labels-' + doc + '.json')); } catch (_) { lab = {}; } }
      labels[doc] = lab;
      const rev = {};
      for (const k in lab) if (lab[k] && lab[k].dest && !rev[lab[k].dest]) rev[lab[k].dest] = k;
      byDest[doc] = rev;
      return dests[doc];
    })();
    return loading[doc];
  }

  /* Nearest semantic destination at or above (page, yFrac) in `doc`. */
  function nearest(doc, page, yFrac) {
    const t = dests[doc]; if (!t) return null;
    const same = t.byPage.get(page);
    if (same) {
      let best = null;
      for (const [top, name] of same) { if (top <= yFrac + 0.005) best = [top, name]; else break; }
      if (best) return { dest: best[1], dp: 0, dy: +Math.max(0, yFrac - best[0]).toFixed(4) };
    }
    // walk back to the previous page that has a destination; take its last one
    let lo = 0, hi = t.pages.length - 1, prev = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (t.pages[mid] < page) { prev = mid; lo = mid + 1; } else hi = mid - 1; }
    if (prev < 0) return null;
    const p = t.pages[prev]; const arr = t.byPage.get(p); const last = arr[arr.length - 1];
    return { dest: last[1], dp: page - p, dy: +yFrac.toFixed(4) };
  }

  /* Anchor -> {page, y, approx} in `doc` (tables must be loaded). */
  function resolve(doc, anchor) {
    const t = dests[doc]; if (!t || !anchor || !anchor.dest) return null;
    const d = t.byName[anchor.dest]; if (!d) return null;
    const dp = Number(anchor.dp) || 0, dy = Number(anchor.dy) || 0;
    if (dp === 0) {
      const y = d[1] + dy;
      return { page: d[0], y: Math.min(1, y), approx: y > 1 };
    }
    const n = R.doc === doc ? R.numPages : Infinity;
    return { page: Math.min(n, d[0] + dp), y: Math.min(1, dy), approx: true };
  }

  /* Human description of a destination: {key, ref, title, kind} or null. */
  function describe(doc, dest) {
    const rev = byDest[doc] || byDest[R.doc] || {};
    const key = rev[dest];
    const lab = key ? ((labels[doc] || labels[R.doc] || {})[key]) : null;
    if (lab) return { key, ref: lab.ref, title: lab.title, kind: lab.kind };
    // fall back to the destination name itself
    const m = /^([A-Za-z*]+)\.(.+)$/.exec(dest || '');
    return m ? { key: '', ref: m[2], title: '', kind: KIND[m[1]] || 'other' } : null;
  }
  const KIND = { Thm: 'theorem', Exa: 'example', equation: 'equation', AMS: 'display', Item: 'item', section: 'section', 'section*': 'section', chapter: 'chapter', Hfootnote: 'footnote', figure: 'figure' };

  /* printed-page offset of an edition (physical = printed + offset), from labels. */
  function offset(doc) {
    const t = dests[doc], lab = labels[doc];
    if (!t || !lab) return 0;
    for (const k in lab) { const L = lab[k]; if ((L.kind === 'section' || L.kind === 'chapter') && t.byName[L.dest]) return t.byName[L.dest][0] - L.page; }
    return 0;
  }
  const printed = (doc, phys) => Math.max(1, phys - offset(doc));

  return { load, nearest, resolve, describe, offset, printed, has: (doc) => !!dests[doc] };
}
