/* Calculus Fennicus reader — Google Sign-In (Google Identity Services).
 *
 * Ported from the PhD reader (phd-tapio/public-viewer/auth.js). Stores the
 * verified identity under CFG.identityKey ('unitas:identity' — the same
 * localStorage key the MyPublicAnalytics beacon reads), so a feedback POST
 * carries {user, idToken} and the Worker stamps user_verified=1.
 *
 * Exposes window.CfAuth = { getIdentity(), signOut(), prompt(), isReady() }
 * and fires 'cf-auth-change' on window whenever sign-in state changes.
 */
let CFG = {};
let gisReady = false;
let T = {};

const STR = {
  en: { signIn: 'Sign in with Google', signOut: 'Sign out' },
  fi: { signIn: 'Kirjaudu Googlella', signOut: 'Kirjaudu ulos' },
};

export function initAuth(cfg, uiLang) {
  CFG = cfg || {};
  T = STR[uiLang] || STR.en;
  window.CfAuth = { getIdentity, signOut, prompt: () => promptSignIn(), isReady: () => gisReady };
  renderWho();
  loadGis();
  // Another tab / the parent page (same origin) signed in or out.
  window.addEventListener('storage', (e) => { if (e.key === (CFG.identityKey || 'unitas:identity')) { renderWho(); fire(!!getIdentity()); } });
}

function loadGis() {
  if (document.getElementById('gis-sdk')) return;
  const s = document.createElement('script');
  s.id = 'gis-sdk';
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onload = onGisLoad;
  s.onerror = () => { gisReady = false; renderWho(); };
  document.head.appendChild(s);
}

function onGisLoad() {
  if (!window.google || !google.accounts || !google.accounts.id) return;
  try {
    google.accounts.id.initialize({
      client_id: CFG.googleClientId,
      callback: onCredential,
      auto_select: true,
      use_fedcm_for_prompt: true,
    });
    gisReady = true;
    renderWho();
  } catch (e) { console.warn('GIS init failed', e); }
}

function onCredential(resp) {
  if (!resp || !resp.credential) return;
  const claims = decodeJwt(resp.credential);
  if (!claims) return;
  const id = {
    email: claims.email || '',
    name: claims.name || claims.email || '',
    sub: claims.sub || '',
    picture: claims.picture || '',
    idToken: resp.credential,
    exp: claims.exp || 0,
    t: Date.now(),
  };
  try { localStorage.setItem(CFG.identityKey || 'unitas:identity', JSON.stringify(id)); } catch (_) {}
  renderWho();
  fire(true, id);
}

function fire(signedIn, id) {
  window.dispatchEvent(new CustomEvent('cf-auth-change', { detail: { signedIn, id: id || getIdentity() } }));
}

export function getIdentity() {
  try {
    const raw = localStorage.getItem(CFG.identityKey || 'unitas:identity');
    if (!raw) return null;
    const id = JSON.parse(raw);
    if (id && id.exp && id.exp * 1000 < Date.now() - 5000) return null; // token expired
    return id && id.email ? id : null;
  } catch (_) { return null; }
}

export function signOut() {
  try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (_) {}
  try { localStorage.removeItem(CFG.identityKey || 'unitas:identity'); } catch (_) {}
  renderWho();
  fire(false);
}

function promptSignIn() {
  if (!gisReady) { loadGis(); return; }
  try { google.accounts.id.prompt(); } catch (e) { console.warn(e); }
}

/* ---- UI: #who (signed-in chip) and #gbtn (sign-in button) in the toolbar ---- */
function renderWho() {
  const who = document.getElementById('who');
  const gbtn = document.getElementById('gbtn');
  if (!who || !gbtn) return;
  const id = getIdentity();
  if (id) {
    gbtn.style.display = 'none';
    who.innerHTML = '';
    if (id.picture) { const img = document.createElement('img'); img.src = id.picture; img.alt = ''; img.referrerPolicy = 'no-referrer'; who.appendChild(img); }
    const span = document.createElement('span'); span.textContent = id.name || id.email; span.title = id.email; who.appendChild(span);
    const out = document.createElement('button'); out.className = 'iconbtn'; out.textContent = T.signOut;
    out.onclick = signOut; who.appendChild(out);
    who.style.display = 'inline-flex';
  } else {
    who.style.display = 'none';
    gbtn.style.display = '';
    gbtn.innerHTML = '';
    if (gisReady && window.google) {
      try {
        google.accounts.id.renderButton(gbtn, { type: 'standard', theme: 'outline', size: 'medium', text: 'signin_with', shape: 'pill' });
      } catch (_) { fallbackBtn(gbtn); }
    } else {
      fallbackBtn(gbtn);
    }
  }
}

function fallbackBtn(gbtn) {
  const b = document.createElement('button');
  b.className = 'iconbtn primary';
  b.textContent = T.signIn;
  b.onclick = promptSignIn;
  gbtn.appendChild(b);
}

function decodeJwt(t) {
  try {
    const p = t.split('.')[1];
    const json = atob(p.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch (_) { return null; }
}
