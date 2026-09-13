/* Calculus Fennicus reader — commenting layer (ported from the PhD reader).
 *
 * Flow: select text in a page's text layer -> floating 💬 button -> composer.
 * A comment is anchored THREE ways, from precise to language-independent:
 *   rects[]  page-fraction boxes of the selection (exact, this edition only)
 *   page     physical page in this edition (+ printed page number)
 *   anchor   nearest hyperref destination + offset (anchors.js) — resolves in
 *            the OTHER edition too, and survives re-typesetting
 * Page-level comments (no selection) carry page + anchor only.
 *
 * Submit POSTs event:'feedback' (site=CFG.site) to the MyPublicAnalytics
 * Worker with the signed-in Google identity. Nothing renders publicly; the
 * commenter sees their OWN notes (Worker /feedback?mine=1, plus a localStorage
 * echo) painted in whichever edition they are reading.
 */
const LS_MINE = 'cf:mycomments';
const MAX_EXTRA = 3800;   // Worker truncates `extra` JSON at 4096 chars
const MAX_MSG = 1500;
const MAX_RECTS = 80;

const STR = {
  en: {
    fab: '💬 Comment', pageBtn: '💬 Comment page', title: 'Comment', titleSel: (p) => 'Comment · page ' + p, titlePage: (p) => 'Comment on page ' + p,
    signin: 'Sign in with your Google account (top right) to leave a comment, so I know who the feedback is from.',
    cats: { general: 'General remark', typo: 'Typo / language', math: 'Mathematical error', translation: 'Translation issue', question: 'Question', suggestion: 'Suggestion' },
    dictate: '🎤 Dictate', listening: '● listening…', placeholder: 'Write or dictate your comment here…',
    hint: 'Comments go only to the translator; they are never shown publicly.', cancel: 'Cancel', send: 'Send', sending: 'Sending…',
    thanks: 'Thank you! Comment saved.', failed: 'Sending failed: ', empty: 'Write or dictate a comment.', noSpeech: 'This browser has no dictation. Try Chrome or Safari.',
    mine: 'Your comment', mineIn: (d, p) => 'Your comment in the ' + (d === 'fi' ? 'Finnish' : 'English') + ' edition, p. ' + p, voice: '(voice)',
    edition: { fi: 'FI', en: 'EN' },
  },
  fi: {
    fab: '💬 Kommentoi', pageBtn: '💬 Kommentoi sivua', title: 'Kommentti', titleSel: (p) => 'Kommentti · sivu ' + p, titlePage: (p) => 'Kommentti koko sivusta ' + p,
    signin: 'Kirjaudu sisään Google-tilillä (oikea yläkulma) jättääksesi kommentin, jotta tiedän keneltä palaute tulee.',
    cats: { general: 'Yleinen huomio', typo: 'Kirjoitus-/kielivirhe', math: 'Matemaattinen virhe', translation: 'Käännösongelma', question: 'Kysymys', suggestion: 'Ehdotus' },
    dictate: '🎤 Sanele', listening: '● kuuntelee…', placeholder: 'Kirjoita tai sanele kommenttisi tähän…',
    hint: 'Kommentit tulevat vain kääntäjälle, eivät näy julkisesti.', cancel: 'Peruuta', send: 'Lähetä', sending: 'Lähetetään…',
    thanks: 'Kiitos! Kommentti tallennettu.', failed: 'Lähetys epäonnistui: ', empty: 'Kirjoita tai sanele kommentti.', noSpeech: 'Selain ei tue sanelua. Kokeile Chromea tai Safaria.',
    mine: 'Oma kommenttisi', mineIn: (d, p) => 'Oma kommenttisi ' + (d === 'fi' ? 'suomenkielisessä' : 'englanninkielisessä') + ' laitoksessa, s. ' + p, voice: '(ääni)',
    edition: { fi: 'FI', en: 'EN' },
  },
};

let R, CFG, A, T;
let sel = null;           // pending selection anchor
let recog = null, recognizing = false;
let mineServer = [];      // own comments from the Worker (all editions)
let composerSent = false;

export function initComments(reader, cfg, anchors, uiLang) {
  R = reader; CFG = cfg || {}; A = anchors; T = STR[uiLang] || STR.en;
  ensureDom();
  wireSelection();
  wireComposer();
  wirePageButton();
  R.onPainted((n, el, layer) => paintMine(n, layer));
  R.on('doc', () => { A.load(R.doc).then(repaintMine); });
  window.addEventListener('cf-auth-change', () => { refreshAuthState(); loadMineFromServer(); });
  A.load(R.doc).then(repaintMine);
  loadMineFromServer();
  return { refresh: loadMineFromServer, get mine() { return allMine(); } };
}

/* ---------------- DOM (created here so viewer.html stays lean) ---------------- */
function ensureDom() {
  if (document.getElementById('composer')) return;
  const fab = document.createElement('button');
  fab.id = 'fab'; fab.type = 'button'; fab.textContent = T.fab;
  document.body.appendChild(fab);
  const c = document.createElement('div');
  c.id = 'composer'; c.setAttribute('role', 'dialog'); c.setAttribute('aria-modal', 'false'); c.setAttribute('aria-label', T.title);
  c.innerHTML =
    '<h3 id="cmtCtx"></h3>' +
    '<div class="quote" id="cmtQuote" style="display:none"></div>' +
    '<div id="cmtSigninNote" class="signin-note" style="display:none"></div>' +
    '<div class="row"><select id="cmtCat" aria-label="Type"></select>' +
    '<button class="iconbtn" id="cmtMic" type="button"></button><span id="dictindicator"></span></div>' +
    '<textarea id="cmtText"></textarea>' +
    '<div class="row end"><span class="hint" id="cmtHint" style="margin-right:auto"></span>' +
    '<button class="iconbtn" id="cmtCancel" type="button"></button><button class="iconbtn primary" id="cmtSend" type="button"></button></div>';
  document.body.appendChild(c);
  document.getElementById('cmtSigninNote').textContent = T.signin;
  document.getElementById('cmtMic').textContent = T.dictate;
  document.getElementById('dictindicator').textContent = T.listening;
  document.getElementById('cmtText').placeholder = T.placeholder;
  document.getElementById('cmtHint').textContent = T.hint;
  document.getElementById('cmtCancel').textContent = T.cancel;
  document.getElementById('cmtSend').textContent = T.send;
  const pb = document.getElementById('cmtPage'); if (pb) pb.textContent = T.pageBtn;
}
function fillCategories() {
  const s = document.getElementById('cmtCat');
  const cur = s.value;
  s.innerHTML = '';
  for (const k of ['general', 'typo', 'math', 'translation', 'question', 'suggestion']) {
    if (k === 'translation' && R.doc !== 'en') continue;   // the Finnish edition is the original
    const o = document.createElement('option'); o.value = k; o.textContent = T.cats[k]; s.appendChild(o);
  }
  if (cur && [...s.options].some((o) => o.value === cur)) s.value = cur;
}

/* ---------------- selection -> FAB ---------------- */
function wireSelection() {
  const fab = document.getElementById('fab');
  const update = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) { hideFab(); return; }
    const text = s.toString().trim();
    const page = R.pageOfNode(s.anchorNode);
    if (!text || !page) { hideFab(); return; }
    const rects = s.getRangeAt(0).getClientRects();
    const last = rects[rects.length - 1];
    if (!last) { hideFab(); return; }
    fab.style.left = Math.min(window.innerWidth - 150, last.right + 4) + 'px';
    fab.style.top = Math.max(48, last.top - 36) + 'px';
    fab.classList.add('show');
  };
  document.addEventListener('mouseup', () => setTimeout(update, 0));
  document.addEventListener('touchend', () => setTimeout(update, 250), { passive: true });
  document.addEventListener('selectionchange', () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed) hideFab();
  });
  fab.addEventListener('mousedown', (e) => e.preventDefault()); // keep selection
  fab.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  fab.addEventListener('click', () => { captureSelection(); openComposer('selection'); });
}
function hideFab() { const f = document.getElementById('fab'); if (f) f.classList.remove('show'); }

function captureSelection() {
  const s = window.getSelection();
  if (!s || s.isCollapsed || !s.rangeCount) { sel = null; return; }
  const quote = s.toString().replace(/\s+/g, ' ').trim();
  const page = R.pageOfNode(s.anchorNode);
  const pageEl = R.pageEl(page);
  const rects = [];
  if (pageEl) {
    const pr = pageEl.getBoundingClientRect();
    for (const r of s.getRangeAt(0).getClientRects()) {
      if (r.bottom < pr.top || r.top > pr.bottom || r.width < 1) continue;
      rects.push({
        x: +clamp((r.left - pr.left) / pr.width).toFixed(4),
        y: +clamp((r.top - pr.top) / pr.height).toFixed(4),
        w: +clamp(r.width / pr.width).toFixed(4),
        h: +clamp(r.height / pr.height).toFixed(4),
      });
    }
  }
  sel = { kind: 'selection', page, quote, rects: rects.slice(0, MAX_RECTS) };
  hideFab();
  try { s.removeAllRanges(); } catch (_) {}
}
const clamp = (v) => Math.max(0, Math.min(1, v));

/* ---------------- page-level comment ---------------- */
function wirePageButton() {
  const b = document.getElementById('cmtPage');
  if (b) b.onclick = () => { sel = { kind: 'page', page: R.currentPage(), quote: '', rects: [] }; openComposer('page'); };
}

/* ---------------- composer ---------------- */
function wireComposer() {
  document.getElementById('cmtCancel').onclick = closeComposer;
  document.getElementById('cmtSend').onclick = submit;
  document.getElementById('cmtMic').onclick = toggleDictation;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeComposer(); });
}

function openComposer(kind) {
  const c = document.getElementById('composer');
  const q = document.getElementById('cmtQuote');
  const ctx = document.getElementById('cmtCtx');
  const page = sel ? sel.page : R.currentPage();
  fillCategories();
  q.style.display = (kind === 'selection' && sel && sel.quote) ? '' : 'none';
  if (kind === 'selection' && sel) q.textContent = '“' + (sel.quote.length > 300 ? sel.quote.slice(0, 300) + '…' : sel.quote) + '”';
  ctx.textContent = (kind === 'selection' ? T.titleSel : T.titlePage)(R.printed(page)) + ' · ' + T.edition[R.doc];
  document.getElementById('cmtText').value = '';
  c.classList.add('show');
  positionComposer();
  refreshAuthState();
  composerSent = false;
  R.emit('comment_open', { kind, page: R.printed(page), quote_len: (kind === 'selection' && sel) ? sel.quote.length : 0 });
  setTimeout(() => document.getElementById('cmtText').focus(), 30);
}
function positionComposer() {
  const c = document.getElementById('composer');
  c.style.top = Math.max(56, Math.round(window.innerHeight * 0.14)) + 'px';
  c.style.left = Math.max(8, Math.round(Math.min(window.innerWidth - c.offsetWidth - 16, window.innerWidth * 0.52))) + 'px';
}
function closeComposer() {
  stopDictation();
  const c = document.getElementById('composer');
  if (!c) return;
  if (c.classList.contains('show') && !composerSent) R.emit('comment_cancel', { page: R.printed(sel ? sel.page : R.currentPage()), kind: sel ? sel.kind : 'page', typed: document.getElementById('cmtText').value.trim().length });
  c.classList.remove('show');
  sel = null;
}

function refreshAuthState() {
  const note = document.getElementById('cmtSigninNote');
  const send = document.getElementById('cmtSend');
  if (!note || !send) return;
  const id = window.CfAuth && window.CfAuth.getIdentity();
  const needSignin = CFG.requireSignIn && !id;
  note.style.display = needSignin ? '' : 'none';
  send.disabled = needSignin;
  send.textContent = id ? (T.send + ' (' + (id.name || id.email) + ')') : T.send;
}

/* ---------------- dictation (speech-to-text) ---------------- */
function toggleDictation() { recognizing ? stopDictation() : startDictation(); }
function startDictation() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = document.getElementById('cmtMic');
  const ind = document.getElementById('dictindicator');
  if (!SR) { R.toast(T.noSpeech, true); return; }
  R.emit('voice', { mode: 'dictation', page: R.printed(sel ? sel.page : R.currentPage()) });
  recog = new SR();
  const dl = CFG.dictationLang || {};
  recog.lang = (typeof dl === 'string' ? dl : dl[R.doc]) || 'fi-FI';
  recog.interimResults = true; recog.continuous = true;
  const ta = document.getElementById('cmtText');
  let base = ta.value ? ta.value + ' ' : '';
  recog.onresult = (e) => {
    let interim = '', finalTxt = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalTxt += t; else interim += t;
    }
    if (finalTxt) base += finalTxt;
    ta.value = base + interim;
  };
  recog.onerror = (e) => { if (e.error !== 'no-speech') R.toast('Dictation: ' + e.error, true); };
  recog.onend = () => { recognizing = false; mic.classList.remove('active'); ind.classList.remove('show'); };
  try { recog.start(); recognizing = true; mic.classList.add('active'); ind.classList.add('show'); }
  catch (_) {}
}
function stopDictation() { if (recog && recognizing) { try { recog.stop(); } catch (_) {} } recognizing = false; }

/* ---------------- submit ---------------- */
async function submit() {
  const id = window.CfAuth && window.CfAuth.getIdentity();
  if (CFG.requireSignIn && !id) { refreshAuthState(); return; }
  const message = document.getElementById('cmtText').value.trim().slice(0, MAX_MSG);
  const category = document.getElementById('cmtCat').value;
  if (!message) { R.toast(T.empty, true); return; }

  const send = document.getElementById('cmtSend');
  send.disabled = true; const label = send.textContent; send.textContent = T.sending;
  try {
    await A.load(R.doc);
    const extra = buildExtra(message, category);
    const body = JSON.stringify({
      site: CFG.site, path: location.pathname, event: 'feedback',
      extra,
      user: id ? { email: id.email, name: id.name, sub: id.sub } : undefined,
      idToken: id ? id.idToken : undefined,
    });
    const resp = await fetch(CFG.collectEndpoint, {
      method: 'POST', mode: 'cors', keepalive: true,
      headers: { 'content-type': 'text/plain;charset=UTF-8' }, body,
    });
    if (!resp.ok && resp.status !== 204 && resp.status !== 0) throw new Error('HTTP ' + resp.status);
    saveMine(extra, id);
    repaintMine();
    composerSent = true;
    R.emit('comment_sent', { kind: extra.kind, page: extra.printed, doc: extra.doc, category, len: message.length, anchor: extra.anchor ? extra.anchor.dest : null });
    R.toast(T.thanks);
    closeComposer();
  } catch (e) {
    R.toast(T.failed + (e.message || e), true);
    send.disabled = false; send.textContent = label;
  }
}

function buildExtra(message, category) {
  const page = sel ? sel.page : R.currentPage();
  const yTop = sel && sel.rects && sel.rects.length ? Math.min(...sel.rects.map((r) => r.y)) : 0;
  const anchor = A.nearest(R.doc, page, yTop);
  const base = {
    kind: sel ? sel.kind : 'page',
    book: CFG.book || 'cf1',
    doc: R.doc,
    page, printed: R.printed(page),
    anchor: anchor || undefined,
    category,
    message,
    v: CFG.buildVersion || 'dev',
    url: location.origin + location.pathname + '#doc=' + R.doc + (anchor ? '&dest=' + encodeURIComponent(anchor.dest) : '&page=' + R.printed(page)),
  };
  if (sel && sel.kind === 'selection') {
    base.quote = sel.quote;
    base.rects = sel.rects;
  }
  // Keep under the Worker's 4096-char extra cap: trim rects, then quote.
  let s = JSON.stringify(base);
  while (s.length > MAX_EXTRA && base.rects && base.rects.length) { base.rects = base.rects.slice(0, Math.floor(base.rects.length / 2)); s = JSON.stringify(base); }
  if (s.length > MAX_EXTRA && base.quote) { base.quote = base.quote.slice(0, 400); s = JSON.stringify(base); }
  return base;
}

/* ---------------- the commenter's own notes ---------------- */
export function parseExtra(row) {
  let x = {};
  try { x = typeof row.extra === 'string' ? JSON.parse(row.extra) : (row.extra || {}); } catch (_) {}
  return x;
}
function loadLocal() { try { return JSON.parse(localStorage.getItem(LS_MINE) || '[]'); } catch (_) { return []; } }
function saveMine(extra, id) {
  const all = loadLocal();
  all.push({ ts: Date.now(), email: id ? id.email : '', doc: extra.doc, page: extra.page, printed: extra.printed, anchor: extra.anchor || null, quote: extra.quote || '', rects: extra.rects || [], message: extra.message, kind: extra.kind });
  try { localStorage.setItem(LS_MINE, JSON.stringify(all.slice(-500))); } catch (_) {}
}
async function loadMineFromServer() {
  const id = window.CfAuth && window.CfAuth.getIdentity();
  if (!id || !id.idToken || !CFG.feedbackEndpoint) { mineServer = []; repaintMine(); return; }
  try {
    const r = await fetch(CFG.feedbackEndpoint + '?site=' + encodeURIComponent(CFG.site) + '&mine=1&id_token=' + encodeURIComponent(id.idToken), { mode: 'cors' });
    if (!r.ok) return;
    const data = await r.json();
    mineServer = (data.feedback || []).map((row) => {
      const x = parseExtra(row);
      return { ts: Number(row.ts) || 0, email: row.user_email || '', doc: x.doc || '', page: Number(x.page) || 0, printed: Number(x.printed) || 0, anchor: x.anchor || null, quote: x.quote || '', rects: Array.isArray(x.rects) ? x.rects : [], message: x.message || '', kind: x.kind || 'page' };
    });
    repaintMine();
  } catch (_) {}
}
function allMine() {
  // server rows win; local echo covers the seconds before the Worker has the row
  const id = window.CfAuth && window.CfAuth.getIdentity();
  const local = loadLocal().filter((c) => !id || !c.email || c.email === id.email);
  const seen = new Set(mineServer.map((c) => Math.round(c.ts / 1000)));
  return mineServer.concat(local.filter((c) => !seen.has(Math.round(c.ts / 1000)) && !mineServer.some((s) => s.message === c.message && s.doc === c.doc && s.page === c.page)));
}
function repaintMine() { for (let n = 1; n <= R.numPages; n++) if (R.isRendered(n)) paintMine(n, R.cmtLayer(n)); }
function paintMine(n, layer) {
  if (!layer) return;
  layer.querySelectorAll('.mine').forEach((x) => x.remove());
  const doc = R.doc;
  for (const c of allMine()) {
    if (!c.doc || !c.page) continue;
    if (c.doc === doc) {
      if (c.page !== n) continue;
      if (c.rects.length) paintRects(layer, c.rects, 'mine', c.message || T.mine, String(c.ts), () => R.toast(T.mine + ': ' + (c.message || T.voice)));
      else paintBadge(layer, 'mine', '💬', c.message || T.mine, () => R.toast(T.mine + ': ' + (c.message || T.voice)));
    } else if (c.anchor && A.has(doc)) {
      const res = A.resolve(doc, c.anchor);
      if (!res || res.page !== n) continue;
      paintXlang(layer, res.y, 'mine', '💬 ' + T.edition[c.doc] + ' ' + (c.printed || c.page), T.mineIn(c.doc, c.printed || c.page) + '\n' + (c.quote ? '“' + c.quote.slice(0, 160) + '”\n' : '') + (c.message || ''), () => R.toast(T.mine + ': ' + (c.message || T.voice)));
    }
  }
}

/* ---------------- shared marker painters (owner.js imports these) ---------------- */
export function paintRects(layer, rects, cls, title, ts, onClick) {
  for (const r of rects) {
    const i = document.createElement('i');
    i.className = cls; if (ts) i.dataset.ts = ts;
    i.style.left = (r.x * 100) + '%'; i.style.top = (r.y * 100) + '%';
    i.style.width = (r.w * 100) + '%'; i.style.height = (r.h * 100) + '%';
    i.title = (title || '').slice(0, 300);
    if (onClick) i.addEventListener('click', onClick);
    layer.appendChild(i);
  }
}
export function paintBadge(layer, cls, text, title, onClick) {
  const n = layer.querySelectorAll('.badge').length;
  const b = document.createElement('div'); b.className = 'badge ' + cls;
  b.style.top = (8 + n * 26) + 'px';
  b.textContent = text; b.title = (title || '').slice(0, 300);
  if (onClick) b.addEventListener('click', onClick);
  layer.appendChild(b);
}
export function paintXlang(layer, y, cls, label, title, onClick) {
  const d = document.createElement('div'); d.className = 'xl ' + cls;
  d.style.top = (Math.min(0.985, y) * 100) + '%';
  const pill = document.createElement('b'); pill.textContent = label; pill.title = (title || '').slice(0, 300);
  if (onClick) pill.addEventListener('click', onClick);
  d.appendChild(pill);
  layer.appendChild(d);
}
