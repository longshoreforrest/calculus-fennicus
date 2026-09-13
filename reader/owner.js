/* Calculus Fennicus reader — OWNER view: every reader's comments, in both
 * editions (ported from the PhD reader's owner.js).
 *
 * Visible only when the signed-in Google account is in CFG.ownerEmails.
 * Fetches GET /feedback?site=…&id_token=… from the MyPublicAnalytics Worker
 * (which verifies the token and enforces FEEDBACK_OWNERS), then:
 *   - lists every comment newest first: who ✓, when, edition, anchor
 *     ("Theorem I.10.1 · Cauchy sequences"), page in BOTH editions, quote,
 *     message; text filter; click → jump to the spot in the current edition,
 *     ↔ button → switch edition and jump there,
 *   - paints markers on the pages: exact amber boxes for comments made in the
 *     edition being read, dashed margin markers (anchor-resolved) for comments
 *     made in the other edition,
 *   - keeps the "N" counter on the toolbar button.
 */
import { parseExtra, paintRects, paintBadge, paintXlang } from './comments.js?v=20260913-0946';

const STR = {
  en: { title: 'All comments', filter: 'Filter: name, text, p. 19, FI, EN…', reload: 'Reload', close: 'Close', loading: 'Loading…',
    expired: 'Sign-in expired — sign in again.', forbidden: 'This account may not read the comments.', failed: 'Could not load comments: ',
    count: (n, t) => n + (t != null ? ' / ' + t : '') + ' comments', empty: 'No comments yet.', nohit: 'No matches for this filter.',
    sel: 'selection', page: 'whole page', verified: 'Google-verified', unverified: 'unverified', voice: '(voice)',
    cats: { general: 'General', typo: 'Language', math: 'Math', translation: 'Translation', question: 'Question', suggestion: 'Suggestion' },
    kinds: { theorem: 'Thm', example: 'Ex.', equation: 'Eq.', display: 'Eq.', item: 'Item', section: '§', chapter: 'Part', footnote: 'Fn.', figure: 'Fig.', other: '' },
    switchTo: (d) => 'Open in the ' + (d === 'fi' ? 'Finnish' : 'English') + ' edition', madeIn: (d, p) => 'Commented in the ' + (d === 'fi' ? 'Finnish' : 'English') + ' edition, p. ' + p, approx: '≈' },
  fi: { title: 'Kaikki kommentit', filter: 'Suodata: nimi, teksti, s. 19, FI, EN…', reload: 'Päivitä', close: 'Sulje', loading: 'Ladataan…',
    expired: 'Kirjautuminen vanhentunut — kirjaudu uudelleen.', forbidden: 'Tällä tilillä ei ole oikeutta lukea kommentteja.', failed: 'Kommenttien haku epäonnistui: ',
    count: (n, t) => n + (t != null ? ' / ' + t : '') + ' kommenttia', empty: 'Ei vielä kommentteja.', nohit: 'Ei osumia suodattimella.',
    sel: 'valinta', page: 'koko sivu', verified: 'Google-varmennettu', unverified: 'varmentamaton', voice: '(ääni)',
    cats: { general: 'Yleinen', typo: 'Kieli', math: 'Matematiikka', translation: 'Käännös', question: 'Kysymys', suggestion: 'Ehdotus' },
    kinds: { theorem: 'Lause', example: 'Esim.', equation: 'Yht.', display: 'Yht.', item: 'Kohta', section: '§', chapter: 'Osa', footnote: 'Alav.', figure: 'Kuva', other: '' },
    switchTo: (d) => 'Avaa ' + (d === 'fi' ? 'suomenkielisessä' : 'englanninkielisessä') + ' laitoksessa', madeIn: (d, p) => 'Kommentoitu ' + (d === 'fi' ? 'suomenkielisessä' : 'englanninkielisessä') + ' laitoksessa, s. ' + p, approx: '≈' },
};

export function initOwner(R, CFG, A, uiLang) {
  const T = STR[uiLang] || STR.en;
  const owners = (CFG.ownerEmails || []).map((e) => String(e).toLowerCase());
  if (!owners.length) return null;
  const endpoint = CFG.feedbackEndpoint || String(CFG.collectEndpoint || '').replace(/\/collect\/?$/, '/feedback');
  const btn = document.getElementById('ownerBtn');
  if (!btn) return null;
  const panel = ensurePanel(T);
  const ui = {
    list: panel.querySelector('#ownerList'), count: panel.querySelector('#ownerCount'), filter: panel.querySelector('#ownerFilter'),
    reload: panel.querySelector('#ownerReload'), close: panel.querySelector('#ownerClose'), status: panel.querySelector('#ownerStatus'),
  };
  const st = { open: false, items: [], loading: false, filter: '' };
  const OTHER = { fi: 'en', en: 'fi' };

  function identity() { return window.CfAuth && window.CfAuth.getIdentity ? window.CfAuth.getIdentity() : null; }
  function isOwner() { const id = identity(); return !!(id && id.email && owners.includes(String(id.email).toLowerCase())); }

  function refreshVisibility() {
    const on = isOwner();
    btn.style.display = on ? '' : 'none';
    if (!on) { if (st.open) hide(); st.items = []; repaintAll(); }
    else if (!st.items.length && !st.loading) load();
  }
  window.addEventListener('cf-auth-change', refreshVisibility);
  R.ready.then(refreshVisibility);
  setTimeout(refreshVisibility, 1500);   // CfAuth may initialise after us
  R.on('doc', async () => { await Promise.all([A.load('fi'), A.load('en')]); render(); repaintAll(); });

  async function load() {
    const id = identity(); if (!id || !id.idToken) return;
    st.loading = true; ui.status.textContent = T.loading;
    try {
      await Promise.all([A.load('fi'), A.load('en')]);
      const r = await fetch(endpoint + '?site=' + encodeURIComponent(CFG.site || 'calculus-fennicus') + '&id_token=' + encodeURIComponent(id.idToken), { mode: 'cors' });
      if (r.status === 401) throw new Error(T.expired);
      if (r.status === 403) throw new Error(T.forbidden);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      st.items = (data.feedback || []).map(normalize).filter(Boolean).sort((a, b) => b.ts - a.ts);
      ui.status.textContent = '';
      btn.querySelector('#ownerN').textContent = String(st.items.length);
      render(); repaintAll();
    } catch (e) {
      ui.status.textContent = T.failed + (e.message || e);
    } finally { st.loading = false; }
  }
  function normalize(row) {
    const x = parseExtra(row);
    const page = Number(x.page) || 0;
    const doc = x.doc === 'fi' || x.doc === 'en' ? x.doc : '';
    return {
      id: row.id, ts: Number(row.ts) || 0, name: row.user_name || row.user_email || '?', email: row.user_email || '',
      verified: Number(row.user_verified) === 1, doc, page, printed: Number(x.printed) || page, kind: x.kind || 'page', category: x.category || '',
      message: x.message || '', quote: x.quote || '', rects: Array.isArray(x.rects) ? x.rects : [], anchor: x.anchor && x.anchor.dest ? x.anchor : null, v: x.v || '',
    };
  }

  /* Where does this comment sit in edition `doc`? {page, y, approx, exact} or null. */
  function locate(it, doc) {
    if (it.doc === doc && it.page) {
      const y = it.rects.length ? Math.min(...it.rects.map((r) => r.y)) : 0;
      return { page: it.page, y, approx: false, exact: true };
    }
    if (!it.anchor || !A.has(doc)) return null;
    const res = A.resolve(doc, it.anchor);
    return res ? { page: res.page, y: res.y, approx: res.approx, exact: false } : null;
  }
  function pageLabel(it, doc) {
    const loc = locate(it, doc);
    if (!loc) return '';
    return (loc.exact ? '' : (loc.approx ? T.approx : '')) + 's. ' + (loc.exact ? it.printed : A.printed(doc, loc.page));
  }
  function anchorLabel(it) {
    if (!it.anchor) return '';
    const d = A.describe(R.doc, it.anchor.dest);
    if (!d) return it.anchor.dest;
    const kind = T.kinds[d.kind] || '';
    return (kind ? kind + ' ' : '') + (d.ref || '') + (d.title ? ' · ' + d.title.replace(/\$[^$]*\$/g, '').replace(/\\[a-zA-Z]+/g, '').trim() : '');
  }

  /* ---------- list ---------- */
  function fmt(ts) { const d = new Date(ts); return d.toLocaleDateString(uiLang === 'fi' ? 'fi-FI' : 'en-GB') + ' ' + d.toLocaleTimeString(uiLang === 'fi' ? 'fi-FI' : 'en-GB', { hour: '2-digit', minute: '2-digit' }); }
  function render() {
    const f = st.filter.trim().toLowerCase();
    const hay = (it) => (it.name + ' ' + it.email + ' ' + it.message + ' ' + it.quote + ' ' + it.doc + ' s. ' + it.printed + ' ' + anchorLabel(it) + ' ' + (T.cats[it.category] || '')).toLowerCase();
    const items = f ? st.items.filter((it) => hay(it).includes(f)) : st.items;
    ui.count.textContent = T.count(items.length, f ? st.items.length : null);
    ui.list.innerHTML = '';
    if (!items.length) { ui.list.innerHTML = '<div class="ownerEmpty">' + (st.items.length ? T.nohit : T.empty) + '</div>'; return; }
    const frag = document.createDocumentFragment();
    for (const it of items) {
      const li = document.createElement('div'); li.className = 'ownerItem' + (it.doc && it.doc !== R.doc ? ' other' : '');
      const other = it.doc ? OTHER[it.doc] : '';
      li.innerHTML =
        '<div class="oh"><span class="who">' + esc(it.name) + (it.verified ? ' <span class="ok" title="' + T.verified + '">✓</span>' : ' <span class="unv" title="' + T.unverified + '">?</span>') + '</span>' +
        (it.doc ? '<span class="ed ' + it.doc + '">' + it.doc.toUpperCase() + '</span>' : '') +
        '<span class="pg">' + esc(pageLabel(it, it.doc || R.doc)) + (other && locate(it, other) ? ' <span class="pg2 ' + other + '">' + other.toUpperCase() + ' ' + esc(pageLabel(it, other)) + '</span>' : '') + '</span>' +
        '<span class="kind">' + (it.kind === 'selection' ? T.sel : T.page) + '</span>' +
        (it.category ? '<span class="cat">' + esc(T.cats[it.category] || it.category) + '</span>' : '') +
        '<span class="ts">' + esc(fmt(it.ts)) + '</span></div>' +
        (it.anchor ? '<div class="oa">' + esc(anchorLabel(it)) + '</div>' : '') +
        (it.quote ? '<div class="oq">“' + esc(it.quote.length > 220 ? it.quote.slice(0, 220) + '…' : it.quote) + '”</div>' : '') +
        '<div class="om">' + esc(it.message || T.voice) + '</div>' +
        (it.doc && it.doc !== R.doc && it.anchor ? '<button class="iconbtn sw" type="button" title="' + esc(T.switchTo(it.doc)) + '">↔ ' + it.doc.toUpperCase() + '</button>' : '');
      li.addEventListener('click', (ev) => {
        if (ev.target.closest('.sw')) { ev.stopPropagation(); switchAndJump(it); return; }
        jump(it, R.doc);
      });
      frag.appendChild(li);
    }
    ui.list.appendChild(frag);
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function jump(it, doc) {
    const loc = locate(it, doc);
    if (!loc) return;
    R.scrollToFraction(loc.page, loc.y);
    R.emit('owner_jump', { page: A.printed(doc, loc.page), doc, exact: loc.exact });
    setTimeout(() => {
      const layer = R.cmtLayer(loc.page); if (!layer) return;
      layer.querySelectorAll('[data-ts="' + it.ts + '"]').forEach((el) => { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800); });
    }, 900);
  }
  async function switchAndJump(it) {
    if (!it.doc || it.doc === R.doc) { jump(it, R.doc); return; }
    await R.setDoc(it.doc);
    jump(it, it.doc);
  }

  /* ---------- markers on pages ---------- */
  function paint(n, layer) {
    if (!layer) return;
    layer.querySelectorAll('.other, .badge.other, .xl.other').forEach((x) => x.remove());
    if (!isOwner() || !st.items.length) return;
    const doc = R.doc;
    for (const it of st.items) {
      const loc = locate(it, doc);
      if (!loc || loc.page !== n) continue;
      const title = it.name + (it.verified ? ' ✓' : '') + ' · ' + fmt(it.ts) + (it.doc && it.doc !== doc ? '\n' + T.madeIn(it.doc, it.printed) : '') + '\n' + (it.message || T.voice);
      const open = () => { show(); ui.filter.value = (it.message || it.name).slice(0, 40); st.filter = ui.filter.value; render(); };
      if (loc.exact && it.kind === 'selection' && it.rects.length) paintRects(layer, it.rects, 'other', title, String(it.ts), open);
      else if (loc.exact) paintBadge(layer, 'other', '💬 ' + it.name.split(' ')[0], title, open);
      else paintXlang(layer, loc.y, 'other', '💬 ' + it.doc.toUpperCase() + ' ' + it.printed + ' · ' + it.name.split(' ')[0], (it.quote ? '“' + it.quote.slice(0, 160) + '”\n' : '') + title, open);
    }
  }
  function repaintAll() { for (let n = 1; n <= R.numPages; n++) if (R.isRendered(n)) paint(n, R.cmtLayer(n)); }
  R.onPainted((n, el, layer) => paint(n, layer));

  /* ---------- panel ---------- */
  function show() { st.open = true; panel.classList.add('show'); btn.classList.add('on'); if (!st.items.length) load(); render(); }
  function hide() { st.open = false; panel.classList.remove('show'); btn.classList.remove('on'); }
  btn.onclick = () => (st.open ? hide() : show());
  ui.close.onclick = hide;
  ui.reload.onclick = load;
  ui.filter.addEventListener('input', () => { st.filter = ui.filter.value; render(); });
  window.addEventListener('keydown', (e) => { if (st.open && e.key === 'Escape' && !/input|textarea/i.test(e.target.tagName)) hide(); });

  return { reload: load, get items() { return st.items; }, isOwner };
}

function ensurePanel(T) {
  let p = document.getElementById('owner');
  if (p) return p;
  p = document.createElement('div');
  p.id = 'owner'; p.setAttribute('role', 'region'); p.setAttribute('aria-label', T.title);
  p.innerHTML =
    '<div class="row"><strong>' + T.title + '</strong><span id="ownerCount" class="cnt"></span>' +
    '<input id="ownerFilter" type="search" placeholder="' + T.filter + '" autocomplete="off" aria-label="' + T.filter + '">' +
    '<button class="iconbtn" id="ownerReload" type="button" title="' + T.reload + '">↻</button>' +
    '<button class="iconbtn" id="ownerClose" type="button" title="' + T.close + '">✕</button></div>' +
    '<div id="ownerStatus" class="status"></div><div id="ownerList"></div>';
  document.body.appendChild(p);
  return p;
}
