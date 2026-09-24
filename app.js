/* Streckenbericht · Jagdgemeinschaft Thuine
 * Daten liegen als data/strecke.json im GitHub-Repo.
 * Lesen: öffentlich (GitHub-API bzw. Pages-Datei). Schreiben: nur mit GitHub-Token (Einstellungen).
 * Foto-Auswertung: Anthropic-API mit eigenem Schlüssel (nur auf dem Gerät gespeichert).
 */
'use strict';

/* Notfall: Falls beim Start etwas schiefgeht (z. B. alte index.html aus dem Zwischenspeicher),
   wird ein Hinweis mit „App reparieren“ angezeigt statt einer leeren Seite. */
function showRescue(msg) {
  if (document.getElementById('rescue')) return;
  // Nur zeigen, wenn die App nicht sichtbar gestartet ist (keine Fehlalarme im laufenden Betrieb)
  try { if (document.querySelector('.start-tile, .day, .hero, #lock:not([hidden])')) return; } catch { /* egal */ }
  const d = document.createElement('div');
  d.id = 'rescue';
  d.setAttribute('style', 'position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 90px);z-index:99;padding:14px 16px;border-radius:14px;background:#f3dcc6;border:1px solid #e3bc9a;color:#5a2c10;font:14px/1.4 -apple-system,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.2)');
  d.innerHTML = '<b>Die App konnte nicht richtig starten.</b><br>Meist hilft es, die App-Dateien neu zu laden.<br><small style="opacity:.7">' + String(msg || '').replace(/[<>&]/g, '') + '</small><br><button id="rescueBtn" style="margin-top:10px;min-height:42px;padding:8px 16px;border-radius:10px;border:0;background:#1f4a24;color:#f4f1de;font-weight:600">App reparieren &amp; neu laden</button>';
  document.body.appendChild(d);
  document.getElementById('rescueBtn').onclick = repairApp;
}
async function repairApp() {
  try { const regs = await navigator.serviceWorker?.getRegistrations?.(); await Promise.all((regs || []).map(r => r.unregister())); } catch { /* egal */ }
  try { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } catch { /* egal */ }
  location.replace(location.pathname + '?r=' + Date.now()); // Daten & Einstellungen auf dem Gerät bleiben erhalten
}
window.addEventListener('error', e => showRescue(e.message));
window.addEventListener('unhandledrejection', e => { if (!(e.reason && e.reason.name === 'AbortError')) showRescue(e.reason?.message || e.reason); });

const APP_VERSION = '2.3.0';
const LS_DATA = 'sb.data.v1';
const LS_PENDING = 'sb.pending.v1';
const LS_CFG = 'sb.cfg.v1';
const LS_SCHALEN = 'sb.schalen.v1';
const LS_SCHALEN_OPS = 'sb.schalen.ops.v1';
const SCHALEN_PATH = 'schalenwild.json';
const FALLBACK_MODEL = 'claude-sonnet-4-6';

/* ================= Hilfsfunktionen ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (Math.round((n || 0) * 10) / 10).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const clone = o => JSON.parse(JSON.stringify(o));
const slug = s => String(s).toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  try { val === undefined ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(val)); } catch { /* egal */ }
}

function dateDE(iso, long = false) {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return long
    ? dt.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
    : dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
/** Jagdjahr 1.4.–31.3. → "2025/26" */
function seasonOf(iso) {
  const [y, m] = iso.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
const b64encodeUtf8 = str => {
  const bytes = new TextEncoder().encode(str);
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
/* ================= Verschlüsselung (AES-GCM, Schlüssel aus Passwort via PBKDF2) ================= */
const LS_PW = 'sb.pw.v1';
class NeedPassword extends Error {}
const bytesToB64 = bytes => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
async function deriveKey(pw, salt, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptJSON(obj, pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 150000;
  const key = await deriveKey(pw, salt, iter);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  return { enc: 'aes-gcm-v1', hinweis: 'Verschlüsselte Daten', iter, salt: bytesToB64(salt), iv: bytesToB64(iv), data: bytesToB64(ct) };
}
async function decryptJSON(env, pw) {
  const key = await deriveKey(pw, b64ToBytes(env.salt), env.iter || 150000);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(env.iv) }, key, b64ToBytes(env.data));
  return JSON.parse(new TextDecoder().decode(pt));
}
/** Entschlüsselt, falls nötig. Wirft NeedPassword, wenn Passwort fehlt oder falsch ist. */
async function openData(raw) {
  if (!raw || !raw.enc) return raw;
  if (!state.pw) throw new NeedPassword('fehlt');
  try { return await decryptJSON(raw, state.pw); } catch { /* evtl. noch mit altem Passwort verschlüsselt (während eines Passwortwechsels) */ }
  if (state.pwOld) { try { return await decryptJSON(raw, state.pwOld); } catch { /* weiter */ } }
  throw new NeedPassword('falsch');
}
/** Zum Speichern: verschlüsselt, sobald ein Passwort gesetzt ist */
const sealData = obj => (state.pw ? encryptJSON(obj, state.pw) : obj);

/** Sperrbildschirm anlegen, falls die (evtl. ältere) index.html ihn nicht enthält */
function ensureLockDom() {
  if ($('#lock')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="lock" class="lock" hidden>
    <form class="lock-box" id="lockForm" autocomplete="off">
      <img src="icons/logo.png" alt="Jagdgemeinschaft Thuine">
      <h2>Streckenbericht</h2>
      <p id="lockMsg" class="sub">Bitte das Passwort der Jagdgemeinschaft eingeben.</p>
      <input type="password" id="lockPw" placeholder="Passwort" autocomplete="current-password" aria-label="Passwort">
      <button class="btn block" id="lockBtn" type="submit">Öffnen</button>
      <p class="hint">Das Passwort wird nur einmal pro Gerät abgefragt.</p>
      <button type="button" class="btn ghost" id="forgotPw">Passwort vergessen?</button>
    </form>
    <div class="lock-box" id="resetBox" hidden></div>
  </div>`);
}
function showLock(reason) {
  const el = $('#lock');
  if (!el) return;
  if (!el.hidden && reason !== 'falsch') return; // bereits gesperrt – Hinweis nicht überschreiben
  el.hidden = false;
  $('#lockMsg').textContent = reason === 'falsch' ? 'Passwort falsch oder geändert – bitte (neu) eingeben.' : 'Bitte das Passwort der Jagdgemeinschaft eingeben.';
  $('#lockMsg').classList.toggle('err', reason === 'falsch');
  $('#lockPw').value = '';
  setTimeout(() => $('#lockPw').focus(), 50);
}
async function unlock(e) {
  e?.preventDefault();
  const pw = $('#lockPw').value;
  if (!pw) return;
  state.pw = pw;
  $('#lockBtn').disabled = true;
  try {
    await load(true);
    if (!$('#lock').hidden) return; // weiterhin gesperrt → Passwort falsch
    lsSet(LS_PW, pw);
    loadSchalen();
  } finally { $('#lockBtn').disabled = false; }
}

const b64decodeUtf8 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

/* ================= Zustand ================= */
const state = {
  data: null,
  season: null,
  tab: 'start',
  sha: null,
  pending: !!lsGet(LS_PENDING, false),
  cfg: Object.assign(defaultCfg(), lsGet(LS_CFG, {})),
  schalen: normalizeSchalen(lsGet(LS_SCHALEN, null)),
  schalenOps: lsGet(LS_SCHALEN_OPS, []),
  pw: lsGet('sb.pw.v1', ''),
};
function normalizeSchalen(d) { d = d && typeof d === 'object' ? d : {}; d.version ||= 1; d.eintraege = Array.isArray(d.eintraege) ? d.eintraege : []; return d; }

function defaultCfg() {
  let owner = '', repo = '';
  if (location.hostname.endsWith('.github.io')) {
    owner = location.hostname.split('.')[0];
    repo = location.pathname.split('/').filter(Boolean)[0] || `${owner}.github.io`;
  }
  return { owner, repo, repo2: repo ? `${repo}-schalenwild` : '', branch: 'main', path: 'data/strecke.json', token: '', apiKey: '', model: '', mode: '', ich: '' };
}
// Rollen: 'voll' = alles bearbeiten (Sebastian), 'schalen' = nur Reh- & Dammwild eintragen, '' = nur ansehen
if (state.cfg.token && !state.cfg.mode) state.cfg.mode = 'voll';
// Ohne vollen Zugang gilt immer der Standard-Speicherort (aus dem Link) – versehentliche Änderungen werden so repariert
if (state.cfg.mode !== 'voll' && location.hostname.endsWith('.github.io')) {
  const d = defaultCfg(); Object.assign(state.cfg, { owner: d.owner, repo: d.repo, repo2: d.repo2 });
}
const isAdmin = () => !!(state.cfg.mode === 'voll' && state.cfg.token && state.cfg.owner && state.cfg.repo);
const canSchalen = () => !!((state.cfg.mode === 'voll' || state.cfg.mode === 'schalen') && state.cfg.token && state.cfg.owner && state.cfg.repo2);

/* ================= Berechnungen ================= */
const species = () => state.data.wildarten;
const ptsMap = () => Object.fromEntries(species().map(w => [w.id, Number(w.punkte) || 0]));
const shooterById = id => state.data.schuetzen.find(s => s.id === id);
/** Anzeigename (voller Name), z. B. "Sebastian Bruns" */
const shooterName = id => { const s = shooterById(id); return s ? (s.vollname || s.name) : id; };
/** Kurzname wie auf der Erlegerliste, z. B. "Bruns, S." */
const shortName = id => shooterById(id)?.name || id;
const findShooter = txt => {
  const t = String(txt || '').trim().toLowerCase();
  return t ? state.data.schuetzen.find(s => s.id === t || s.name.toLowerCase() === t || (s.vollname || '').toLowerCase() === t) : null;
};
/** Sonderkönig-Text → voller Name, falls ein Schütze passt */
const sonderName = txt => { const s = findShooter(txt); return s ? (s.vollname || s.name) : (txt || ''); };
/** Gehört der Schütze in diesem Jagdjahr zur Gemeinschaft? */
const isMember = (s, season) => s.aktiv !== false && (!s.ab || season >= s.ab) && (!s.bis || season <= s.bis);
function seasonRange() {
  const first = state.data.jagdtage.map(d => seasonOf(d.datum)).sort()[0] || seasonOf(todayISO());
  const y0 = Number(first.slice(0, 4)), y1 = Number(seasonOf(todayISO()).slice(0, 4)) + 3;
  const out = []; for (let y = y0; y <= y1; y++) out.push(`${y}/${String((y + 1) % 100).padStart(2, '0')}`);
  return out;
}

function sumCounts(obj) { return Object.values(obj || {}).reduce((a, b) => a + (Number(b) || 0), 0); }
function pointsOf(counts, pm = ptsMap()) {
  return Object.entries(counts || {}).reduce((a, [k, v]) => a + (pm[k] || 0) * (Number(v) || 0), 0);
}

/** Jagdtag-Arten */
const DAY_TYPES = { normal: 'Jagdtag', venslage: 'Jagd mit Venslage', treibjagd: 'Große Treibjagd' };
const DAY_SHORT = { normal: 'Normal', venslage: 'mit Venslage', treibjagd: 'Gr. Treibjagd' };
const isVenslage = d => d.art === 'venslage';
const isTreibjagd = d => d.art === 'treibjagd';
const hasGuests = d => isVenslage(d) || isTreibjagd(d);
const GUEST_LABEL = { venslage: 'Venslage', treibjagd: 'Gast' };
function addCounts(target, counts) { for (const [k, v] of Object.entries(counts || {})) if (v) target[k] = (target[k] || 0) + v; return target; }

/** Auswertung eines Jagdtages.
 * rows = Thuiner Schützen (+ bei Venslage die Venslager Jäger mit gast:true).
 * perSpecies = Strecke für UNSEREN Streckenbericht: normal = Summe unserer Schützen,
 *              Venslage = Zeile „Erlegt in Thuine“ (Revierstrecke).
 * perSpeciesAll = Gesamtstrecke des Tages über alle Jäger. */
function dayStats(day) {
  const pm = ptsMap();
  const ids = new Set([...Object.keys(day.strecke || {}), ...Object.keys(day.hund || {})]);
  const mk = (id, name, erlegt, hund, gast) => ({ id, name, gast, erlegt, hund, punkte: pointsOf(erlegt, pm), stueck: sumCounts(erlegt) + sumCounts(hund) });
  const own = [...ids].map(id => mk(id, shooterName(id), day.strecke?.[id] || {}, day.hund?.[id] || {}, false)).filter(r => r.stueck > 0);
  const guests = hasGuests(day)
    ? (day.gaeste || []).map((g, i) => Object.assign(mk(`gast:${i}`, `${g.name} (${GUEST_LABEL[day.art]})`, g.erlegt || {}, g.hund || {}, true), { plain: g.name, gastgeber: g.gastgeber || '' })).filter(r => r.stueck > 0)
    : [];
  const rows = [...own, ...guests];
  const perSpeciesAll = {}; const hundAll = {};
  for (const r of rows) { addCounts(perSpeciesAll, r.erlegt); addCounts(perSpeciesAll, r.hund); addCounts(hundAll, r.hund); }
  let perSpecies, perSpeciesHund;
  if (isVenslage(day)) { perSpecies = addCounts({}, day.revier); perSpeciesHund = {}; }
  else { perSpecies = perSpeciesAll; perSpeciesHund = hundAll; }
  const values = [...new Set(rows.map(r => r.punkte).filter(p => p > 0))].sort((a, b) => b - a);
  const koenig = values[0] != null ? rows.filter(r => r.punkte === values[0]).map(r => r.id) : [];
  const vize = values[1] != null ? rows.filter(r => r.punkte === values[1]).map(r => r.id) : [];
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  const label = id => byId[id]?.name || shooterName(id);
  const sortFn = (a, b) => b.punkte - a.punkte || b.stueck - a.stueck || a.name.localeCompare(b.name, 'de');
  own.sort(sortFn); guests.sort(sortFn); rows.sort(sortFn);
  return { rows, own, guests, perSpecies, perSpeciesHund, total: sumCounts(perSpecies), perSpeciesAll, totalAll: sumCounts(perSpeciesAll),
    koenig, koenigPts: values[0] || 0, vize, vizePts: values[1] || 0, label };
}
const dayNames = (ds, ids) => ids.map(id => esc(ds.label(id))).join(', ');

function seasonDays(season) {
  return state.data.jagdtage.filter(d => seasonOf(d.datum) === season).sort((a, b) => a.datum.localeCompare(b.datum));
}
function seasonNachtraege(season) {
  return (state.data.nachtraege || []).filter(n => seasonOf(n.datum) === season).sort((a, b) => a.datum.localeCompare(b.datum));
}
function allSeasons() {
  const s = new Set([...state.data.jagdtage, ...(state.data.nachtraege || []), ...(state.schalen?.eintraege || [])].map(d => seasonOf(d.datum)));
  s.add(seasonOf(todayISO()));
  return [...s].sort().reverse();
}

/** Auswertung eines Jagdjahres */
function seasonStats(season) {
  const days = seasonDays(season);
  const pm = ptsMap();
  const per = {};
  const get = id => (per[id] ||= { id, punkte: 0, stueck: 0, erlegt: {}, hund: {}, siege: 0, vize: 0, sonder: 0, tage: [] });
  const perSpecies = {}; const perSpeciesHund = {};
  for (const d of days) {
    const ds = dayStats(d);
    addCounts(perSpecies, ds.perSpecies); addCounts(perSpeciesHund, ds.perSpeciesHund);
    for (const r of ds.own) { // nur Stammmannschaft zählt für den Jahres-Jagdkönig
      const p = get(r.id);
      p.punkte += r.punkte; p.stueck += r.stueck;
      addCounts(p.erlegt, r.erlegt); addCounts(p.hund, r.hund);
      p.tage.push({ datum: d.datum, art: d.art, erlegt: r.erlegt, hund: r.hund, punkte: r.punkte });
    }
    ds.koenig.filter(id => !id.startsWith('gast:')).forEach(id => get(id).siege++);
    ds.vize.filter(id => !id.startsWith('gast:')).forEach(id => get(id).vize++);
    const sk = (d.sonderkoenig || '').trim();
    if (sk) { const s = findShooter(sk); if (s) get(s.id).sonder++; }
  }
  const ranking = Object.values(per).sort((a, b) =>
    b.punkte - a.punkte || b.stueck - a.stueck || shooterName(a.id).localeCompare(shooterName(b.id), 'de'));
  // Platzierung mit Gleichstand (gleiche Punkte = gleicher Platz)
  let lastPts = null, lastRank = 0;
  ranking.forEach((r, i) => { r.rank = r.punkte === lastPts ? lastRank : i + 1; lastPts = r.punkte; lastRank = r.rank; });
  void pm;
  // Nachträge (Wild außerhalb der Jagdtage): nur Strecke, keine Punkte
  const perSpeciesTage = addCounts({}, perSpecies);
  const nachtraege = seasonNachtraege(season);
  const perNachtrag = {};
  nachtraege.forEach(n => { perNachtrag[n.art] = (perNachtrag[n.art] || 0) + n.anzahl; });
  addCounts(perSpecies, perNachtrag);
  return { days, ranking, perSpecies, perSpeciesHund, total: sumCounts(perSpecies),
    perSpeciesTage, totalTage: sumCounts(perSpeciesTage), nachtraege, perNachtrag, totalNachtrag: sumCounts(perNachtrag) };
}

/* ================= Daten laden / speichern ================= */
function ghHeaders(auth) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (auth && state.cfg.token) h.Authorization = `Bearer ${state.cfg.token}`;
  return h;
}
function ghUrl() {
  const { owner, repo, path, branch } = state.cfg;
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch || 'main')}`;
}

async function fetchRemote() {
  const { owner, repo } = state.cfg;
  // 1) GitHub-API (sofort aktuell nach dem Speichern)
  if (owner && repo) {
    try {
      const r = await fetch(ghUrl() + `&t=${Date.now()}`, { headers: ghHeaders(true), cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        state.sha = j.sha;
        return JSON.parse(b64decodeUtf8(j.content));
      }
      if (r.status === 401) toast('GitHub-Token ungültig – bitte in den Einstellungen prüfen.', 5000);
    } catch { /* weiter mit Fallback */ }
  }
  // 2) Datei direkt von GitHub Pages / lokal
  const r = await fetch(`data/strecke.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('Daten nicht erreichbar');
  return r.json();
}

async function load(fromUnlock = false) {
  const cached = lsGet(LS_DATA, null);
  if (cached && !fromUnlock) { state.data = normalize(cached); render(); }
  if (state.pending && cached) { showPendingBanner(); return; }
  try {
    const remote = normalize(await openData(await fetchRemote()));
      if ($('#lock')) $('#lock').hidden = true;
    state.data = remote; lsSet(LS_DATA, remote);
    render();
    if (state.schalenFresh) migrateSchalen();
  } catch (e) {
    if (e instanceof NeedPassword) { if (!fromUnlock && state.pw) { state.pw = ''; lsSet(LS_PW, undefined); } showLock(e.message); return; }
    if (!cached) {
      $('#view-tage').innerHTML = `<div class="card pad empty"><img src="icons/logo.png" alt=""><p>Keine Daten erreichbar. Bitte Internetverbindung prüfen.</p></div>`;
    } else toast('Offline – zeige zuletzt geladenen Stand.');
  }
}

/** Neue Wildart vor „Sonstiges“ einsortieren */
function insertSpecies(d, w) {
  const i = d.wildarten.findIndex(x => x.id === 'sonstiges');
  i < 0 ? d.wildarten.push(w) : d.wildarten.splice(i, 0, w);
}
function addSpecies(name, punkte = 1) {
  const n = name.trim();
  const ex = species().find(w => w.name.toLowerCase() === n.toLowerCase());
  if (ex) return ex.id;
  let id = slug(n), i = 2;
  while (species().some(w => w.id === id)) id = `${slug(n)}-${i++}`;
  insertSpecies(state.data, { id, name: n, punkte: Number(punkte) || 0, eigen: true });
  return id;
}
const speciesUsed = id => state.data.jagdtage.some(t =>
    Object.values(t.strecke || {}).some(c => c[id]) || Object.values(t.hund || {}).some(c => c[id]) ||
    (t.gaeste || []).some(g => g.erlegt?.[id]) || t.revier?.[id]) ||
  (state.data.nachtraege || []).some(n => n.art === id);

function normalize(d) {
  d.wildarten ||= []; d.schuetzen ||= []; d.jagdtage ||= []; d.nachtraege ||= []; d.schalenwild ||= [];
  if (!d.wildarten.some(w => w.id === 'kraehe')) insertSpecies(d, { id: 'kraehe', name: 'Krähe', punkte: 1 });
  d.jagdtage.forEach(t => { t.art ||= 'normal'; t.strecke ||= {}; t.hund ||= {}; if (t.art !== 'normal') t.gaeste ||= []; if (t.art === 'venslage') t.revier ||= {}; t.sonderkoenig ||= ''; t.bemerkung ||= ''; t.id ||= t.datum; });
  return d;
}

let saving = false;
async function persist(message) {
  state.data.stand = new Date().toISOString();
  lsSet(LS_DATA, state.data);
  state.pending = true; lsSet(LS_PENDING, true);
  render();
  return pushRemote(message);
}

async function pushRemote(message = 'Streckenbericht aktualisiert') {
  if (!isAdmin()) { showPendingBanner(); return false; }
  if (saving) return false;
  saving = true;
  showBanner('Speichere …', 'info');
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      // aktuellen sha holen
      const g = await fetch(ghUrl() + `&t=${Date.now()}`, { headers: ghHeaders(true), cache: 'no-store' });
      let sha;
      if (g.ok) sha = (await g.json()).sha; else if (g.status !== 404) throw new Error(`GitHub ${g.status}`);
      const body = { message, content: b64encodeUtf8(JSON.stringify(await sealData(state.data), null, 2) + '\n'), branch: state.cfg.branch || 'main' };
      if (sha) body.sha = sha;
      const { owner, repo, path } = state.cfg;
      const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'PUT', headers: { ...ghHeaders(true), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (r.ok) {
        state.sha = (await r.json()).content?.sha;
        state.pending = false; lsSet(LS_PENDING, undefined);
        hideBanner(); toast('Gespeichert ✓ – für alle sichtbar.');
        return true;
      }
      if (r.status === 409 || r.status === 422) continue; // sha veraltet → nochmal
      if (r.status === 401 || r.status === 403) throw new Error('Keine Schreibrechte (Token prüfen)');
      throw new Error(`GitHub ${r.status}`);
    }
    throw new Error('Konflikt beim Speichern');
  } catch (e) {
    showPendingBanner(e.message);
    return false;
  } finally { saving = false; }
}

/* ================= Reh- & Dammwild: eigenes Repository ================= */
function ghFileUrl(repo, path, ref = true) {
  const { owner, branch } = state.cfg;
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}` + (ref ? `?ref=${encodeURIComponent(branch || 'main')}` : '');
}
/** Liest die Reh-/Dammwild-Datei; null-Inhalt = Datei existiert noch nicht */
async function fetchSchalenRemote(auth) {
  const { owner, repo2, branch } = state.cfg;
  if (!owner || !repo2) throw new Error('kein Repository');
  try {
    const r = await fetch(ghFileUrl(repo2, SCHALEN_PATH) + `&t=${Date.now()}`, { headers: ghHeaders(auth), cache: 'no-store' });
    if (r.status === 404) return { data: normalizeSchalen(null), sha: undefined };
    if (r.ok) { const j = await r.json(); return { data: normalizeSchalen(await openData(JSON.parse(b64decodeUtf8(j.content)))), sha: j.sha }; }
    if (auth) throw new Error(`GitHub ${r.status}`);
  } catch (e) { if (auth || e instanceof NeedPassword) throw e; }
  // Fallback ohne API-Limit (kann bis zu 5 Min. verzögert sein)
  const r = await fetch(`https://raw.githubusercontent.com/${owner}/${repo2}/${branch || 'main'}/${SCHALEN_PATH}?t=${Date.now()}`, { cache: 'no-store' });
  if (r.status === 404) return { data: normalizeSchalen(null) };
  if (!r.ok) throw new Error('Reh-/Dammwild-Daten nicht erreichbar');
  return { data: normalizeSchalen(await openData(await r.json())) };
}
function applySchalenOp(d, op) {
  if (op.type === 'replace') { d.eintraege = clone(op.eintraege || []); return d; }
  d.eintraege = d.eintraege.filter(x => x.id !== (op.rec?.id || op.id));
  if (op.type === 'upsert') d.eintraege.push(op.rec);
  return d;
}
async function loadSchalen() {
  try {
    const { data } = await fetchSchalenRemote(canSchalen());
    state.schalen = data;
    state.schalenOps.forEach(op => applySchalenOp(state.schalen, op)); // eigene, noch nicht hochgeladene Einträge
    lsSet(LS_SCHALEN, state.schalen);
    state.schalenFresh = true;
    if (state.data) render();
    if (state.schalenOps.length) pushSchalen();
    else migrateSchalen();
  } catch (e) { if (e instanceof NeedPassword) showLock(e.message); /* sonst offline: Cache bleibt */ }
}
/** Einmalige Übernahme alter Reh-/Dammwild-Einträge aus der Hauptdatei (Version 1.5) */
async function migrateSchalen() {
  const old = state.data?.schalenwild;
  if (!old?.length || !isAdmin() || state.pending || migrateSchalen.busy) return;
  migrateSchalen.busy = true;
  old.forEach(rec => { if (!state.schalen.eintraege.some(x => x.id === rec.id)) queueSchalenOp({ type: 'upsert', rec }); });
  try { if (await pushSchalen('Reh-/Dammwild aus Hauptdatei übernommen')) { delete state.data.schalenwild; await persist('Reh-/Dammwild in eigenes Repository verschoben'); } }
  finally { migrateSchalen.busy = false; }
}
function queueSchalenOp(op) {
  state.schalenOps.push(op); lsSet(LS_SCHALEN_OPS, state.schalenOps);
  applySchalenOp(state.schalen, op); lsSet(LS_SCHALEN, state.schalen);
}
let savingSchalen = false;
async function pushSchalen(message = 'Reh-/Dammwild aktualisiert', force = false) {
  if (!state.schalenOps.length && !force) return true;
  if (!canSchalen()) { showSchalenBanner('Zugang fehlt – bitte in den Einstellungen eintragen.'); return false; }
  if (savingSchalen) return false;
  savingSchalen = true;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const ops = [...state.schalenOps];
      let data, sha;
      if (ops.some(op => op.type === 'replace')) {
        // Wiederherstellung: kompletter Stand wird ersetzt – alten Inhalt nicht lesen (evtl. altes Passwort)
        const g = await fetch(ghFileUrl(state.cfg.repo2, SCHALEN_PATH) + `&t=${Date.now()}`, { headers: ghHeaders(true), cache: 'no-store' });
        if (g.ok) sha = (await g.json()).sha; else if (g.status !== 404) throw new Error(`GitHub ${g.status}`);
        data = normalizeSchalen(null);
      } else {
        // immer den neuesten Stand holen und nur die eigenen Änderungen darauf anwenden
        ({ data, sha } = await fetchSchalenRemote(true));
      }
      ops.forEach(op => applySchalenOp(data, op));
      data.stand = new Date().toISOString();
      const body = { message, content: b64encodeUtf8(JSON.stringify(await sealData(data), null, 2) + '\n'), branch: state.cfg.branch || 'main' };
      if (sha) body.sha = sha;
      const r = await fetch(ghFileUrl(state.cfg.repo2, SCHALEN_PATH, false), { method: 'PUT', headers: { ...ghHeaders(true), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) {
        state.schalen = data;
        state.schalenOps = state.schalenOps.slice(ops.length); lsSet(LS_SCHALEN_OPS, state.schalenOps);
        lsSet(LS_SCHALEN, state.schalen);
        hideBanner(); toast('Gespeichert ✓ – für alle sichtbar.');
        if (state.data) render();
        return true;
      }
      if (r.status === 409 || r.status === 422) continue;
      if (r.status === 401 || r.status === 403 || r.status === 404) throw new Error('Keine Schreibrechte für Reh & Damm (Token prüfen)');
      throw new Error(`GitHub ${r.status}`);
    }
    throw new Error('Konflikt beim Speichern – bitte erneut senden');
  } catch (e) { showSchalenBanner(e.message); return false; }
  finally { savingSchalen = false; }
}
function showSchalenBanner(err) {
  showBanner(`<span>Reh-/Dammwild-Einträge noch nicht hochgeladen${err ? ` (${esc(err)})` : ''}.</span><button class="btn" id="retrySchalen">Erneut senden</button>`);
  $('#retrySchalen')?.addEventListener('click', () => pushSchalen());
}

/* ================= Meldungen („Wild melden“) =================
   Eigenes Repository <repo>-meldungen, Datei meldungen.json (mit dem Passwort verschlüsselt).
   Der Melde-Zugang (Token nur für dieses Repo) liegt in der verschlüsselten Hauptdatei –
   nur wer das Passwort kennt, kann melden. */
const MELD_PATH = 'meldungen.json';
const meldRepo = () => state.data?.melde?.repo || (state.cfg.repo ? `${state.cfg.repo}-meldungen` : '');
const meldToken = () => state.data?.melde?.token || '';
const canMelden = () => !!(meldToken() && state.cfg.owner && meldRepo());
state.meldungen = [];
function meldHeaders() { return { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${meldToken()}` }; }
async function fetchMeldungen() {
  const r = await fetch(ghFileUrl(meldRepo(), MELD_PATH) + `&t=${Date.now()}`, { headers: meldHeaders(), cache: 'no-store' });
  if (r.status === 404) return { list: [], sha: undefined };
  if (!r.ok) throw new Error(`Meldungen: GitHub ${r.status}`);
  const j = await r.json();
  const d = await openData(JSON.parse(b64decodeUtf8(j.content)));
  return { list: Array.isArray(d?.eintraege) ? d.eintraege : [], sha: j.sha };
}
/** Änderung sicher anwenden: neuesten Stand holen, Änderung drauf, speichern (bei Konflikt wiederholen) */
async function changeMeldungen(fn, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { list, sha } = await fetchMeldungen();
    const next = fn(list);
    const body = { message, content: b64encodeUtf8(JSON.stringify(await sealData({ version: 1, eintraege: next }), null, 2) + '\n'), branch: state.cfg.branch || 'main' };
    if (sha) body.sha = sha;
    const r = await fetch(ghFileUrl(meldRepo(), MELD_PATH, false), { method: 'PUT', headers: { ...meldHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { state.meldungen = next; updateBadge(); return true; }
    if (r.status === 409 || r.status === 422) continue;
    throw new Error(r.status === 401 || r.status === 403 || r.status === 404 ? 'Melde-Zugang ungültig – bitte Sebastian Bescheid geben.' : `GitHub ${r.status}`);
  }
  throw new Error('Konflikt beim Speichern – bitte nochmal versuchen.');
}
async function loadMeldungen() {
  if (!isAdmin() || !canMelden()) return;
  try { state.meldungen = (await fetchMeldungen()).list; updateBadge(); if (state.tab === 'start') renderStart(); } catch { /* offline */ }
}
/** Zahl der offenen Meldungen am App-Symbol (nur beim Admin) */
function updateBadge() {
  if (!isAdmin() || !('setAppBadge' in navigator)) return;
  const n = state.meldungen.length;
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}
/* Push über ntfy.sh: geheimer Kanal, gespeichert verschlüsselt in den Hauptdaten.
   Einfache POST-Anfrage ohne eigene Header → kein CORS-Preflight. Inhalt ohne Namen. */
const ntfyTopic = () => state.data?.melde?.ntfy || '';
function newNtfyTopic() {
  const a = crypto.getRandomValues(new Uint8Array(12));
  return 'jg-thuine-' + Array.from(a, b => (b % 36).toString(36)).join('');
}
async function sendPush(topic, title, message) {
  if (!topic) return false;
  const q = new URLSearchParams({ title, tags: 'deer', click: location.origin + location.pathname });
  try { const r = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}?${q}`, { method: 'POST', body: message }); return r.ok; }
  catch { return false; }
}
const meldText = m => m.typ === 'schalen'
  ? `${katName(m.art, m.kat)} (${SCHALEN[m.art]?.name || ''})${m.fallwild ? ' – Fallwild' : ''}`
  : `${m.anzahl}× ${speciesName(m.art)}`;

function openMelden() {
  const members = state.data.schuetzen.filter(s => isMember(s, seasonOf(todayISO())));
  const m = { von: state.cfg.ich && shooterById(state.cfg.ich) ? state.cfg.ich : '', datum: todayISO(), typ: 'nieder', art: 'fuchs', anzahl: 1, sArt: 'reh', kat: 'rehbock', fallwild: false, bemerkung: '' };
  const draw = () => {
    const body = `
      <p class="hint">Deine Meldung geht direkt an Sebastian. Er prüft sie und trägt sie in die Strecke ein.</p>
      <label class="field"><span>Wer meldet?</span><select id="mlVon"><option value="">Bitte wählen …</option>${members.map(s => `<option value="${esc(s.id)}" ${s.id === m.von ? 'selected' : ''}>${esc(s.vollname || s.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Datum</span><input type="date" id="mlDate" value="${esc(m.datum)}"></label>
      <div class="seg seg2" role="radiogroup" aria-label="Bereich">
        <button type="button" data-mltyp="nieder" class="${m.typ === 'nieder' ? 'on' : ''}">Niederwild</button>
        <button type="button" data-mltyp="schalen" class="${m.typ === 'schalen' ? 'on' : ''}">Reh / Damm</button>
      </div>
      ${m.typ === 'nieder' ? `
        <label class="field"><span>Wildart</span><select id="mlArt">${species().map(w => `<option value="${w.id}" ${w.id === m.art ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
        <div class="stepper big-stepper"><span class="lab">Anzahl</span><span class="ctl"><button type="button" id="mlMinus" aria-label="weniger">−</button><output id="mlCount">${m.anzahl}</output><button type="button" id="mlPlus" aria-label="mehr">+</button></span></div>`
      : `
        <div class="seg seg2" role="radiogroup" aria-label="Wildart">${Object.entries(SCHALEN).map(([k, v]) => `<button type="button" data-mlsart="${k}" class="${m.sArt === k ? 'on' : ''}">${v.name}</button>`).join('')}</div>
        <label class="field"><span>Kategorie</span><select id="mlKat">${SCHALEN[m.sArt].kat.map(([k, l]) => `<option value="${k}" ${k === m.kat ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="check-row"><input type="checkbox" id="mlFall" ${m.fallwild ? 'checked' : ''}> <span><b>Fallwild</b><small>z. B. Verkehrsunfall</small></span></label>`}
      <label class="field"><span>Bemerkung (optional)</span><input type="text" id="mlBem" value="${esc(m.bemerkung)}" placeholder="z. B. Ort, Uhrzeit, Ursache"></label>`;
    openSheet('Wild melden', body, `<button class="btn secondary" data-close>Abbrechen</button><button class="btn" id="mlSend">Melden</button>`);
    const sync = () => {
      m.von = $('#mlVon').value; m.datum = $('#mlDate').value || m.datum; m.bemerkung = $('#mlBem').value.trim();
      if ($('#mlArt')) m.art = $('#mlArt').value;
      if ($('#mlKat')) m.kat = $('#mlKat').value;
      if ($('#mlFall')) m.fallwild = $('#mlFall').checked;
    };
    $$('[data-mltyp]').forEach(b => b.addEventListener('click', () => { sync(); m.typ = b.dataset.mltyp; draw(); }));
    $$('[data-mlsart]').forEach(b => b.addEventListener('click', () => { sync(); if (m.sArt !== b.dataset.mlsart) { m.sArt = b.dataset.mlsart; m.kat = SCHALEN[m.sArt].kat[0][0]; } draw(); }));
    $('#mlMinus')?.addEventListener('click', () => { m.anzahl = Math.max(1, m.anzahl - 1); $('#mlCount').textContent = m.anzahl; });
    $('#mlPlus')?.addEventListener('click', () => { m.anzahl++; $('#mlCount').textContent = m.anzahl; });
    $('#mlSend').addEventListener('click', async e => {
      sync();
      if (!m.von) { toast('Bitte auswählen, wer meldet.'); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m.datum)) { toast('Bitte ein Datum wählen.'); return; }
      if (!state.cfg.ich) { state.cfg.ich = m.von; lsSet(LS_CFG, state.cfg); }
      const rec = { id: `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, zeit: new Date().toISOString(), von: m.von, datum: m.datum, typ: m.typ };
      if (m.typ === 'nieder') Object.assign(rec, { art: m.art, anzahl: m.anzahl });
      else Object.assign(rec, { art: m.sArt, kat: m.kat, fallwild: !!m.fallwild });
      if (m.bemerkung) rec.bemerkung = m.bemerkung;
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Wird gesendet …';
      try {
        await changeMeldungen(list => [...list, rec], `Meldung: ${meldText(rec)} von ${shooterName(rec.von)}`);
        closeSheet(); toast('Gemeldet ✓ – danke! Sebastian trägt es ein.', 4000);
        sendPush(ntfyTopic(), 'Neue Wildmeldung', `${meldText(rec)} am ${dateDE(rec.datum)} – in der App übernehmen`);
      } catch (err) { btn.disabled = false; btn.textContent = 'Melden'; toast(err.message || 'Senden fehlgeschlagen – Internet prüfen.', 4500); }
    });
  };
  draw();
}

function openMeldungen() {
  const list = [...state.meldungen].sort((a, b) => a.zeit.localeCompare(b.zeit));
  const body = list.length ? `<div class="card"><ul class="nt-list">${list.map(m => `
      <li>
        <span class="nt-date">${dateDE(m.datum)}</span>
        <span class="nt-what"><b>${esc(meldText(m))}</b><small>von ${esc(shooterName(m.von))}${m.bemerkung ? ` · ${esc(m.bemerkung)}` : ''}</small></span>
      </li>
      <li class="ml-actions"><button class="btn" data-mlok="${esc(m.id)}">Übernehmen</button><button class="btn danger" data-mlno="${esc(m.id)}">Verwerfen</button></li>`).join('')}</ul></div>
      <p class="hint">„Übernehmen“ öffnet den Eintrag vorausgefüllt – prüfen und speichern, dann verschwindet die Meldung.</p>`
    : '<p class="sub" style="text-align:center">Keine offenen Meldungen.</p>';
  openSheet(`Meldungen (${list.length})`, body, '<button class="btn secondary" data-close>Schließen</button>');
  $$('[data-mlok]').forEach(b => b.addEventListener('click', () => {
    const m = list.find(x => x.id === b.dataset.mlok); if (!m) return;
    state.pendingMeldung = m.id;
    closeSheet();
    if (m.typ === 'schalen') openSchalen(null, { datum: m.datum, art: m.art, kat: m.kat, fallwild: !!m.fallwild, schuetze: m.fallwild ? '' : m.von, ursache: m.fallwild ? (m.bemerkung || '') : '', bemerkung: m.fallwild ? '' : (m.bemerkung || '') });
    else openNachtrag(null, { datum: m.datum, art: m.art, anzahl: m.anzahl, text: [shooterName(m.von), m.bemerkung].filter(Boolean).join(', ') });
  }));
  $$('[data-mlno]').forEach(b => b.addEventListener('click', async () => {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Wirklich?'; return; }
    try { await changeMeldungen(l => l.filter(x => x.id !== b.dataset.mlno), 'Meldung verworfen'); openMeldungen(); renderStart(); }
    catch (err) { toast(err.message, 4000); }
  }));
}
/** Nach dem Speichern eines übernommenen Eintrags die Meldung entfernen */
async function finishMeldung() {
  const id = state.pendingMeldung; state.pendingMeldung = null;
  if (!id) return;
  try { await changeMeldungen(l => l.filter(x => x.id !== id), 'Meldung übernommen'); renderStart(); } catch { toast('Eintrag gespeichert – Meldung bitte manuell verwerfen.', 4000); }
}

/* ================= Banner ================= */
function showBanner(html, kind = '') {
  const b = $('#banner'); b.className = 'banner ' + kind; b.innerHTML = html; b.hidden = false;
}
function hideBanner() { $('#banner').hidden = true; }
function showPendingBanner(err) {
  if (!state.pending) return;
  const msg = isAdmin()
    ? `<span>Änderungen noch nicht hochgeladen${err ? ` (${esc(err)})` : ''}.</span><button class="btn" id="retryPush">Erneut senden</button>`
    : `<span>Änderungen nur auf diesem Gerät gespeichert – GitHub-Zugang in den Einstellungen fehlt.</span><button class="btn" id="openCfg">Einstellungen</button>`;
  showBanner(msg);
  $('#retryPush')?.addEventListener('click', () => pushRemote('Streckenbericht aktualisiert'));
  $('#openCfg')?.addEventListener('click', openSettings);
}

/* ================= Rendering ================= */
function render() {
  if (!state.data) return;
  const seasons = allSeasons();
  // Beim Öffnen immer das aktuelle Jagdjahr (1.4.–31.3.) – ältere Jahre über die Auswahl oben
  if (!state.season || !seasons.includes(state.season)) state.season = seasonOf(todayISO());
  const sel = $('#seasonSelect');
  sel.innerHTML = seasons.map(s => `<option value="${s}" ${s === state.season ? 'selected' : ''}>${s}</option>`).join('');
  renderTage(); renderStrecke(); renderKoenig(); renderSchalen(); renderStart();
  if (state.tab === 'berichte') renderBerichte();
}

function chipsFor(perSpecies, perHund = {}) {
  return species().filter(w => perSpecies[w.id]).map(w =>
    `<span class="chip ${perHund[w.id] ? 'dog' : ''}"><b>${perSpecies[w.id]}</b> ${esc(w.name)}${perHund[w.id] ? ` <small>(${perHund[w.id]}× Hund)</small>` : ''}</span>`).join('');
}
const names = ids => ids.map(id => esc(shooterName(id))).join(', ');

function renderTage() {
  const el = $('#view-tage');
  const st = seasonStats(state.season);
  const leader = st.ranking[0];
  const leaders = leader ? st.ranking.filter(r => r.rank === 1) : [];
  let html = `
    <div class="stats">
      <div class="card stat"><div class="v">${st.days.length}</div><div class="l">Jagdtage</div></div>
      <div class="card stat"><div class="v">${st.total}</div><div class="l">Stück Strecke</div></div>
      ${koenigGesperrt(state.season) && !isAdmin()
        ? `<div class="card stat leader"><div class="v">🔒</div><div class="l">Jagdkönig noch geheim</div></div>`
        : `<div class="card stat leader"><div class="v">${leader ? `<span class="crown">♛</span> ${names(leaders.map(l => l.id))}` : '–'}</div><div class="l">${leader ? `führt mit ${fmt(leader.punkte)} Pkt.` : 'Jagdkönig'}</div></div>`}
    </div>`;
  if (isAdmin()) {
    html += `<div class="btn-row">
      <button class="btn" id="btnPhoto">📷 Erlegerliste fotografieren</button>
      <button class="btn secondary" id="btnManual">Manuell erfassen</button>
    </div>`;
  }
  html += `<h2 class="section">Jagdtage ${esc(state.season)}</h2>`;
  if (!st.days.length) {
    html += `<div class="card pad empty"><img src="icons/logo.png" alt=""><p>Für das Jagdjahr ${esc(state.season)} ist noch kein Jagdtag erfasst.</p></div>`;
  } else {
    html += [...st.days].reverse().map(d => {
      const ds = dayStats(d);
      return `<button class="day" data-day="${esc(d.id)}">
        <div class="day-top"><span class="day-date">${dateDE(d.datum, true)}</span><span class="day-total">${ds.total} Stück${isVenslage(d) ? ' in Thuine' : ''}</span></div>
        ${isVenslage(d) ? `<div class="badge">Jagd mit Venslage · Gesamtstrecke ${ds.totalAll} Stück</div>` : ''}
        ${isTreibjagd(d) ? `<div class="badge">Große Treibjagd · ${ds.guests.length} Gäste mit Strecke</div>` : ''}
        <div class="chips">${chipsFor(ds.perSpecies, ds.perSpeciesHund) || '<span class="sub">keine Strecke</span>'}</div>
        <div class="kings">
          ${ds.koenig.length ? `<div><span class="k"><span class="crown">♛</span> Jagdkönig</span> ${dayNames(ds, ds.koenig)} · ${fmt(ds.koenigPts)} Pkt.</div>` : ''}
          ${ds.vize.length ? `<div><span class="k">Vizekönig</span> ${dayNames(ds, ds.vize)} · ${fmt(ds.vizePts)} Pkt.</div>` : ''}
          ${d.sonderkoenig ? `<div><span class="k">Sonderkönig</span> ${esc(sonderName(d.sonderkoenig))}</div>` : ''}
        </div>
      </button>`;
    }).join('');
  }
  html += `<p class="foot-note">Stand: ${state.data.stand ? new Date(state.data.stand).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '–'} · v${APP_VERSION}</p>`;
  el.innerHTML = html;
  $$('.day', el).forEach(b => b.addEventListener('click', () => openDay(b.dataset.day)));
  $('#btnPhoto')?.addEventListener('click', startPhoto);
  $('#btnManual')?.addEventListener('click', () => openEditor(null));
}

function renderStrecke() {
  const el = $('#view-strecke');
  const st = seasonStats(state.season);
  const hundTotal = sumCounts(st.perSpeciesHund);
  let html = `
    <div class="card hero">
      <img src="icons/logo.png" alt="">
      <div><div class="big">${st.total}</div><div class="lbl">Stück Gesamtstrecke<br>Jagdjahr ${esc(state.season)}</div></div>
    </div>
    <div class="species-grid">
      ${species().map(w => {
        const n = st.perSpecies[w.id] || 0;
        const nt = st.perNachtrag[w.id] || 0;
        return `<div class="card sp ${n ? '' : 'zero'}"><div class="n">${n}</div><div class="t">${esc(w.name)}</div>${nt ? `<div class="p">davon ${nt} Nachtrag</div>` : ''}</div>`;
      }).join('')}
    </div>
    <h2 class="section">Nachträge ${esc(state.season)}</h2>
    <p class="hint">Wild, das außerhalb der Jagdtage erlegt wurde (z. B. Tauben, Krähen, Fuchs). Es zählt zur Strecke, aber nicht zum Jagdkönig.</p>
    ${isAdmin() ? '<button class="btn block" id="btnNachtrag">+ Wild nachtragen</button>' : ''}
    ${st.nachtraege.length ? `<div class="card"><ul class="nt-list">${[...st.nachtraege].reverse().map(n => `
      <li${isAdmin() ? ` data-nt="${esc(n.id)}" tabindex="0" role="button"` : ''}>
        <span class="nt-date">${dateDE(n.datum)}</span>
        <span class="nt-what"><b>${n.anzahl}</b> ${esc(speciesName(n.art))}${n.text ? `<small>${esc(n.text)}</small>` : ''}</span>
        ${isAdmin() ? '<span class="nt-edit" aria-hidden="true">›</span>' : ''}
      </li>`).join('')}</ul></div>` : '<p class="sub" style="text-align:center">Noch keine Nachträge in diesem Jagdjahr.</p>'}`;

  // Vergleich über alle Jagdjahre
  const seasons = allSeasons().filter(s => seasonDays(s).length || seasonNachtraege(s).length);
  if (seasons.length) {
    const cols = species().filter(w => seasons.some(s => seasonStats(s).perSpecies[w.id]));
    html += `<h2 class="section">Jagdjahre im Vergleich</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Jagdjahr</th><th>Tage</th>${cols.map(w => `<th>${esc(w.name)}</th>`).join('')}<th class="pts">Σ</th></tr></thead>
      <tbody>${seasons.map(s => {
        const x = seasonStats(s);
        return `<tr><td>${s}</td><td>${x.days.length}</td>${cols.map(w => `<td class="${x.perSpecies[w.id] ? '' : 'zero'}">${x.perSpecies[w.id] || 0}</td>`).join('')}<td class="pts">${x.total}</td></tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }
  el.innerHTML = html;
  $('#btnNachtrag')?.addEventListener('click', () => openNachtrag(null));
  $$('[data-nt]', el).forEach(li => li.addEventListener('click', () => openNachtrag(li.dataset.nt)));
}

const speciesName = id => species().find(w => w.id === id)?.name || id;

/* ================= Reh- & Dammwild ================= */
const SCHALEN = {
  reh: { name: 'Rehwild', kat: [['rehbock', 'Rehbock'], ['ricke', 'Ricke'], ['schmalreh', 'Schmalreh'], ['kitz', 'Kitz']] },
  damm: { name: 'Dammwild', kat: [['hirsch-1a', 'Hirsch 1a'], ['hirsch-1b', 'Hirsch 1b'], ['hirsch-2a', 'Hirsch 2a'], ['hirsch-2b', 'Hirsch 2b'], ['hirsch-3a', 'Hirsch 3a'], ['hirsch-3b', 'Hirsch 3b'],
    ['alttier', 'Alttier'], ['schmaltier', 'Schmaltier'], ['spiesser', 'Spießer'], ['kalb', 'Kalb'], ['hirschkalb', 'Hirschkalb']] },
};
const katName = (art, k) => SCHALEN[art]?.kat.find(x => x[0] === k)?.[1] || k;
const FALLWILD_URSACHEN = ['Verkehrsunfall', 'Mähtod', 'Krankheit', 'Hund', 'Zaun', 'Unbekannt'];

function schalenStats(season) {
  const list = (state.schalen?.eintraege || []).filter(x => seasonOf(x.datum) === season).sort((a, b) => a.datum.localeCompare(b.datum));
  const cnt = {}; // art -> kat -> {erlegt, fallwild}
  for (const x of list) {
    const c = ((cnt[x.art] ||= {})[x.kat] ||= { erlegt: 0, fallwild: 0 });
    x.fallwild ? c.fallwild++ : c.erlegt++;
  }
  const tot = art => Object.values(cnt[art] || {}).reduce((a, c) => ({ erlegt: a.erlegt + c.erlegt, fallwild: a.fallwild + c.fallwild }), { erlegt: 0, fallwild: 0 });
  const perShooter = {};
  for (const x of list.filter(x => !x.fallwild && x.schuetze)) {
    const p = (perShooter[x.schuetze] ||= { reh: 0, damm: 0, list: [] });
    p[x.art]++; p.list.push(x);
  }
  return { list, erlegt: list.filter(x => !x.fallwild), fallwild: list.filter(x => x.fallwild), cnt, tot, perShooter };
}

function renderSchalen() {
  const el = $('#view-schalen');
  if (!el || !state.data) return;
  const st = schalenStats(state.season);
  const catTable = art => {
    const t = st.tot(art);
    const rows = SCHALEN[art].kat.map(([k, lbl]) => { const c = st.cnt[art]?.[k] || { erlegt: 0, fallwild: 0 }; return { lbl, ...c }; });
    return `<div class="table-wrap"><table>
      <thead><tr><th>${SCHALEN[art].name}</th><th>Erlegt</th><th>Fallwild</th><th class="pts">Σ</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.lbl)}</td><td class="${r.erlegt ? '' : 'zero'}">${r.erlegt}</td><td class="${r.fallwild ? '' : 'zero'}">${r.fallwild}</td><td class="pts ${r.erlegt + r.fallwild ? '' : 'zero'}">${r.erlegt + r.fallwild}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Gesamt</td><td>${t.erlegt}</td><td>${t.fallwild}</td><td>${t.erlegt + t.fallwild}</td></tr></tfoot>
    </table></div>`;
  };
  const item = x => `<li${canSchalen() ? ` data-sw="${esc(x.id)}" tabindex="0" role="button"` : ''}>
      <span class="nt-date">${dateDE(x.datum)}</span>
      <span class="nt-what"><b>${esc(katName(x.art, x.kat))}</b> <span class="sub">${SCHALEN[x.art]?.name || ''}</span>
        <small>${x.fallwild ? `Fallwild${x.ursache ? ` · ${esc(x.ursache)}` : ''}` : esc(shooterName(x.schuetze))}${x.bemerkung ? ` · ${esc(x.bemerkung)}` : ''}${x.von ? ` · eingetragen von ${esc(shooterName(x.von))}` : ''}</small></span>
      ${canSchalen() ? '<span class="nt-edit" aria-hidden="true">›</span>' : ''}
    </li>`;
  const tr = st.tot('reh'), td = st.tot('damm');
  const shooters = Object.entries(st.perShooter).sort((a, b) => (b[1].reh + b[1].damm) - (a[1].reh + a[1].damm) || shooterName(a[0]).localeCompare(shooterName(b[0]), 'de'));
  el.innerHTML = `
    <h2 class="section" style="margin-top:2px">Reh- &amp; Dammwildjagd ${esc(state.season)}</h2>
    <div class="stats">
      <div class="card stat"><div class="v">${tr.erlegt + tr.fallwild}</div><div class="l">Rehwild${tr.fallwild ? ` · ${tr.fallwild} Fallwild` : ''}</div></div>
      <div class="card stat"><div class="v">${td.erlegt + td.fallwild}</div><div class="l">Dammwild${td.fallwild ? ` · ${td.fallwild} Fallwild` : ''}</div></div>
      <div class="card stat"><div class="v">${st.fallwild.length}</div><div class="l">Fallwild gesamt</div></div>
    </div>
    ${canSchalen() ? '<button class="btn block" id="btnSchalen">+ Erlegung / Fallwild eintragen</button>' : ''}
    ${state.schalenOps.length ? `<div class="alert">${state.schalenOps.length} Änderung(en) noch nicht hochgeladen.</div>` : ''}
    <h2 class="section">Übersicht ${esc(state.season)}</h2>
    ${catTable('reh')}
    ${catTable('damm')}
    <h2 class="section">Erlegt</h2>
    ${st.erlegt.length ? `<div class="card"><ul class="nt-list">${[...st.erlegt].reverse().map(item).join('')}</ul></div>` : '<p class="sub" style="text-align:center">Noch nichts erlegt in diesem Jagdjahr.</p>'}
    <h2 class="section">Fallwild</h2>
    ${st.fallwild.length ? `<div class="card"><ul class="nt-list">${[...st.fallwild].reverse().map(item).join('')}</ul></div>` : '<p class="sub" style="text-align:center">Kein Fallwild in diesem Jagdjahr.</p>'}
    ${shooters.length ? `<h2 class="section">Je Schütze</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Schütze</th><th>Reh</th><th>Damm</th><th>Was / wann</th></tr></thead>
      <tbody>${shooters.map(([id, p]) => `<tr><td>${esc(shooterName(id))}</td><td class="${p.reh ? '' : 'zero'}">${p.reh}</td><td class="${p.damm ? '' : 'zero'}">${p.damm}</td><td class="wrap">${p.list.map(x => `${esc(katName(x.art, x.kat))} (${dateDE(x.datum).slice(0, 6)})`).join(', ')}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}
    <p class="hint" style="text-align:center">Reh- und Dammwild zählt nicht zum Niederwild-Streckenbericht und nicht zum Jagdkönig.</p>`;
  $('#btnSchalen')?.addEventListener('click', () => openSchalen(null));
  $$('[data-sw]', el).forEach(li => li.addEventListener('click', () => openSchalen(li.dataset.sw)));
}

function openSchalen(id, prefill = null) {
  const ex = id ? state.schalen.eintraege.find(x => x.id === id) : null;
  const ich = state.cfg.ich && shooterById(state.cfg.ich) ? state.cfg.ich : '';
  const x = ex ? clone(ex) : Object.assign({ id: null, datum: todayISO(), art: 'reh', kat: 'rehbock', fallwild: false, schuetze: ich, ursache: '', bemerkung: '' }, prefill || {});
  const draw = () => {
    const members = state.data.schuetzen.filter(s => isMember(s, seasonOf(x.datum || todayISO())) || s.id === x.schuetze);
    const body = `
      <label class="field"><span>Datum</span><input type="date" id="swDate" value="${esc(x.datum)}"></label>
      <div class="seg seg2" role="radiogroup" aria-label="Wildart">
        ${Object.entries(SCHALEN).map(([k, v]) => `<button type="button" role="radio" aria-checked="${x.art === k}" class="${x.art === k ? 'on' : ''}" data-swart="${k}">${v.name}</button>`).join('')}
      </div>
      <label class="field"><span>Kategorie</span><select id="swKat">${SCHALEN[x.art].kat.map(([k, l]) => `<option value="${k}" ${k === x.kat ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="check-row"><input type="checkbox" id="swFall" ${x.fallwild ? 'checked' : ''}> <span><b>Fallwild</b><small>z. B. Verkehrsunfall – ohne Schützen</small></span></label>
      ${x.fallwild
        ? `<label class="field"><span>Ursache (optional)</span><input type="text" id="swUrs" list="swUrsList" value="${esc(x.ursache || '')}" placeholder="z. B. Verkehrsunfall"><datalist id="swUrsList">${FALLWILD_URSACHEN.map(u => `<option value="${u}">`).join('')}</datalist></label>`
        : `<label class="field"><span>Schütze</span><select id="swSchuetze"><option value="">Schütze wählen …</option>${members.map(s => `<option value="${esc(s.id)}" ${s.id === x.schuetze ? 'selected' : ''}>${esc(s.vollname || s.name)}</option>`).join('')}</select></label>`}
      <label class="field"><span>Bemerkung (optional)</span><input type="text" id="swBem" value="${esc(x.bemerkung || '')}" placeholder="z. B. Ort, Gewicht"></label>`;
    const foot = ex ? `<button class="btn danger" id="swDel">Löschen</button><button class="btn" id="swSave">Speichern</button>`
                    : `<button class="btn secondary" data-close>Abbrechen</button><button class="btn" id="swSave">Speichern</button>`;
    openSheet(ex ? 'Eintrag bearbeiten' : 'Reh- / Dammwild eintragen', body, foot);
    const sync = () => {
      x.datum = $('#swDate').value || x.datum; x.kat = $('#swKat').value;
      x.bemerkung = $('#swBem').value.trim();
      if ($('#swSchuetze')) x.schuetze = $('#swSchuetze').value;
      if ($('#swUrs')) x.ursache = $('#swUrs').value.trim();
    };
    $$('[data-swart]').forEach(b => b.addEventListener('click', () => { sync(); if (x.art !== b.dataset.swart) { x.art = b.dataset.swart; x.kat = SCHALEN[x.art].kat[0][0]; } draw(); }));
    $('#swFall').addEventListener('change', e => { sync(); x.fallwild = e.target.checked; draw(); });
    $('#swDate').addEventListener('change', () => { sync(); draw(); });
    $('#swSave').addEventListener('click', () => {
      sync();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x.datum)) { toast('Bitte ein Datum wählen.'); return; }
      if (!x.fallwild && !x.schuetze) { toast('Bitte den Schützen wählen oder „Fallwild“ ankreuzen.'); return; }
      const rec = { id: ex?.id || `sw-${Date.now().toString(36)}`, datum: x.datum, art: x.art, kat: x.kat, fallwild: !!x.fallwild };
      if (x.fallwild) { if (x.ursache) rec.ursache = x.ursache; } else rec.schuetze = x.schuetze;
      if (x.bemerkung) rec.bemerkung = x.bemerkung;
      rec.von = ex?.von || ich || undefined;
      if (ex && ich && ich !== ex.von) rec.geaendertVon = ich;
      rec.zeit = new Date().toISOString();
      queueSchalenOp({ type: 'upsert', rec });
      state.season = seasonOf(rec.datum);
      closeSheet(); switchTab('schalen'); render();
      pushSchalen(`${SCHALEN[rec.art].name}: ${katName(rec.art, rec.kat)}${rec.fallwild ? ' (Fallwild)' : ''} ${dateDE(rec.datum)}${ich ? ` – eingetragen von ${shooterName(ich)}` : ''}`).then(ok => { if (ok) finishMeldung(); });
    });
    $('#swDel')?.addEventListener('click', e => {
      const b = e.currentTarget;
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Wirklich löschen?'; return; }
      queueSchalenOp({ type: 'delete', id: ex.id });
      closeSheet(); render();
      pushSchalen(`Reh-/Dammwild-Eintrag gelöscht${ich ? ` von ${shooterName(ich)}` : ''}`);
    });
  };
  draw();
}

/* ================= Nachträge ================= */
function openNachtrag(id, prefill = null) {
  const ex = id ? state.data.nachtraege.find(n => n.id === id) : null;
  const n = ex ? clone(ex) : Object.assign({ id: null, datum: todayISO(), art: 'taube', anzahl: 1, text: '' }, prefill || {});
  const body = `
    <p class="hint">Nachträge zählen zum Streckenbericht, aber nicht zum Jagdkönig.</p>
    <label class="field"><span>Datum</span><input type="date" id="ntDate" value="${esc(n.datum)}"></label>
    <label class="field"><span>Wildart</span>
      <select id="ntArt">${species().map(w => `<option value="${w.id}" ${w.id === n.art ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}<option value="__neu">+ Neue Wildart …</option></select>
    </label>
    <div class="card pad" id="ntNew" hidden>
      <div class="grid2">
        <label class="field"><span>Name der neuen Wildart</span><input type="text" id="ntNewName" placeholder="z. B. Elster"></label>
        <label class="field"><span>Punkte (falls sie mal an einem Jagdtag fällt)</span><input type="number" id="ntNewPts" step="0.5" min="0" value="1"></label>
      </div>
    </div>
    <div class="stepper big-stepper"><span class="lab">Anzahl</span><span class="ctl">
      <button type="button" id="ntMinus" aria-label="weniger">−</button><output id="ntCount">${n.anzahl}</output><button type="button" id="ntPlus" aria-label="mehr">+</button>
    </span></div>
    <label class="field"><span>Erlegt von / Bemerkung (optional)</span><input type="text" id="ntText" value="${esc(n.text)}" placeholder="z. B. Sebastian Bruns, Taubenjagd"></label>`;
  const foot = ex ? `<button class="btn danger" id="ntDel">Löschen</button><button class="btn" id="ntSave">Speichern</button>`
                  : `<button class="btn secondary" data-close>Abbrechen</button><button class="btn" id="ntSave">Speichern</button>`;
  openSheet(ex ? 'Nachtrag bearbeiten' : 'Wild nachtragen', body, foot);
  let count = n.anzahl;
  const upd = () => ($('#ntCount').textContent = count);
  $('#ntMinus').addEventListener('click', () => { count = Math.max(1, count - 1); upd(); });
  $('#ntPlus').addEventListener('click', () => { count++; upd(); });
  $('#ntArt').addEventListener('change', e => { $('#ntNew').hidden = e.target.value !== '__neu'; if (!$('#ntNew').hidden) $('#ntNewName').focus(); });
  $('#ntSave').addEventListener('click', () => {
    const datum = $('#ntDate').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) { toast('Bitte ein Datum wählen.'); return; }
    let art = $('#ntArt').value;
    if (art === '__neu') {
      const name = $('#ntNewName').value.trim();
      if (!name) { toast('Bitte einen Namen für die neue Wildart eingeben.'); return; }
      art = addSpecies(name, $('#ntNewPts').value);
    }
    const rec = { id: ex?.id || `n-${Date.now().toString(36)}`, datum, art, anzahl: count, text: $('#ntText').value.trim() };
    state.data.nachtraege = state.data.nachtraege.filter(x => x.id !== rec.id);
    state.data.nachtraege.push(rec);
    state.season = seasonOf(datum);
    closeSheet(); switchTab('strecke');
    persist(`Nachtrag: ${count} ${speciesName(art)} (${dateDE(datum)})`).then(ok => { if (ok) finishMeldung(); });
  });
  $('#ntDel')?.addEventListener('click', e => {
    const b = e.currentTarget;
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Wirklich löschen?'; return; }
    state.data.nachtraege = state.data.nachtraege.filter(x => x.id !== ex.id);
    closeSheet(); persist('Nachtrag gelöscht');
  });
}

/* Jagdkönig des laufenden Jagdjahres: nur Admin sieht ihn, bis er freigegeben wird.
   Vergangene Jagdjahre sind immer sichtbar. */
const koenigGesperrt = season => season === seasonOf(todayISO()) && !state.data?.koenigFrei?.[season];
function koenigFreigabeCard(season) {
  const zu = koenigGesperrt(season);
  return `<div class="card pad kf-card ${zu ? 'zu' : 'frei'}">
    <div><b>${zu ? '🔒 Nur für dich sichtbar' : '👁 Für alle sichtbar'}</b><small>${zu ? 'Die anderen sehen den Jagdkönig ' + esc(season) + ' erst nach der Freigabe.' : 'Alle Jäger sehen die Rangliste ' + esc(season) + '.'}</small></div>
    <button class="btn ${zu ? '' : 'secondary'}" id="kfToggle">${zu ? 'Für alle freigeben' : 'Wieder sperren'}</button>
  </div>`;
}
function wireKoenigFreigabe(season) {
  $('#kfToggle')?.addEventListener('click', async e => {
    const b = e.currentTarget, zu = koenigGesperrt(season);
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = zu ? 'Wirklich freigeben?' : 'Wirklich sperren?'; return; }
    state.data.koenigFrei = Object.assign({}, state.data.koenigFrei);
    if (zu) state.data.koenigFrei[season] = true; else delete state.data.koenigFrei[season];
    renderKoenig();
    await persist(zu ? `Jagdkönig ${season} freigegeben` : `Jagdkönig ${season} gesperrt`);
    toast(zu ? 'Jagdkönig ist jetzt für alle sichtbar.' : 'Jagdkönig ist wieder nur für dich sichtbar.', 3500);
  });
}
function renderKoenig() {
  const el = $('#view-koenig');
  const st = seasonStats(state.season);
  const rk = st.ranking;
  if (koenigGesperrt(state.season) && !isAdmin()) {
    el.innerHTML = `<div class="card pad empty"><img src="icons/logo.png" alt=""><p><b>Der Jagdkönig ${esc(state.season)} ist noch geheim.</b></p><p class="sub">Die Rangliste wird von Sebastian freigegeben. Die Jagdkönige der vergangenen Jagdjahre kannst du oben über die Auswahl des Jagdjahres ansehen.</p></div>`;
    return;
  }
  const kf = isAdmin() && state.season === seasonOf(todayISO()) ? koenigFreigabeCard(state.season) : '';
  if (!rk.length) {
    el.innerHTML = kf + `<div class="card pad empty"><img src="icons/logo.png" alt=""><p>Noch keine Punkte im Jagdjahr ${esc(state.season)}.</p></div>`;
    wireKoenigFreigabe(state.season);
    return;
  }
  const byRank = r => rk.filter(x => x.rank === r);
  const ranks = [...new Set(rk.map(r => r.rank))].slice(0, 3);
  const pod = (r, cls) => {
    const people = byRank(r);
    if (!people.length) return `<div></div>`;
    return `<div class="pod ${cls}">
      ${cls === 'p1' ? '<div class="crown-big">♛</div>' : ''}
      <div class="rank">${r}. PLATZ</div>
      <div class="nm">${names(people.map(p => p.id))}</div>
      <div class="pt">${fmt(people[0].punkte)} <small>Pkt.</small></div>
    </div>`;
  };
  const max = rk[0].punkte || 1;
  const last = st.days[st.days.length - 1];
  let html = kf + `
    <div class="sub" style="text-align:center">Stand nach ${st.days.length} Jagdtag${st.days.length === 1 ? '' : 'en'}${last ? ` · zuletzt ${dateDE(last.datum)}` : ''}</div>
    <div class="podium">${pod(ranks[1], 'p2')}${pod(ranks[0], 'p1')}${pod(ranks[2], 'p3')}</div>
    <h2 class="section">Rangliste ${esc(state.season)}</h2>
    <div class="card"><ol class="rank-list">
      ${rk.map(r => {
        const parts = species().filter(w => r.erlegt[w.id] || r.hund[w.id]).map(w => {
          const e = r.erlegt[w.id] || 0, h = r.hund[w.id] || 0;
          return `${e + h} ${w.name}${h ? ` (${h}× Hund)` : ''}`;
        });
        const titles = [r.siege ? `${r.siege}× Tageskönig` : '', r.vize ? `${r.vize}× Vize` : '', r.sonder ? `${r.sonder}× Sonderkönig` : ''].filter(Boolean);
        return `<li class="rank-item ${r.rank <= 3 ? 'top' : ''} ${r.punkte ? '' : 'zero'}">
          <div class="rank-no">${r.rank}.</div>
          <div>
            <div class="rank-name">${esc(shooterName(r.id))}</div>
            <div class="rank-meta">${esc(parts.join(' · '))}${titles.length ? ` — ${esc(titles.join(', '))}` : ''}</div>
            <div class="bar"><i style="width:${Math.max(2, (r.punkte / max) * 100)}%"></i></div>
          </div>
          <div class="rank-pts">${fmt(r.punkte)}<small>${r.stueck} Stück</small></div>
        </li>`;
      }).join('')}
    </ol></div>
    <p class="hint" style="text-align:center">Punkte: ${species().map(w => `${esc(w.name)} ${fmt(w.punkte)}`).join(' · ')}. Vom Hund gegriffenes Wild zählt zur Strecke, bringt aber keine Punkte.</p>`;
  el.innerHTML = html;
  wireKoenigFreigabe(state.season);
}

/* ================= Sheet ================= */
/* ================= Zurück-Taste (Android) =================
   Verlauf: Start (Ebene 0) → Bereich (Ebene 1) → offenes Fenster (Ebene 2).
   „Zurück“ schließt erst ein Fenster, dann geht es zur Startseite, erst dort wird die App verlassen. */
let ignorePops = 0;
const histLvl = () => (history.state && history.state.sb) || 0;
function histBack() { ignorePops++; history.back(); }
window.addEventListener('popstate', () => {
  if (ignorePops > 0) { ignorePops--; return; }
  if (!$('#sheet').hidden) { closeSheet(true); return; }
  if (state.tab !== 'start') { switchTab('start', true); }
});

function openSheet(title, body, foot = '') {
  if ($('#sheet').hidden) history.pushState({ sb: histLvl() + 1, sheet: true }, '');
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = body;
  $('#sheetFoot').innerHTML = foot;
  $('#sheet').hidden = false;
  $('#sheetBody').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}
function closeSheet(fromPop = false) {
  if (!fromPop && !$('#sheet').hidden && history.state && history.state.sheet) histBack();
  $('#sheet').hidden = true; document.body.style.overflow = '';
  editor = null;
}
document.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });

/* ================= Jagdtag-Detail ================= */
function openDay(id) {
  const d = state.data.jagdtage.find(x => x.id === id);
  if (!d) return;
  const ds = dayStats(d);
  const v = isVenslage(d), tj = isTreibjagd(d), g = hasGuests(d);
  const cols = species().filter(w => ds.perSpecies[w.id] || ds.perSpeciesAll[w.id]);
  const rowHtml = r => `<tr><td>${esc(r.gast ? r.plain : r.name)}${r.gast && r.gastgeber ? `<small class="host">Gast von ${esc(shooterName(r.gastgeber))}</small>` : ''}</td>${cols.map(w => {
    const e = r.erlegt[w.id] || 0, h = r.hund[w.id] || 0;
    return `<td class="${e + h ? '' : 'zero'}">${e + h}${h ? `<span class="dogmark">H</span>` : ''}</td>`;
  }).join('')}<td class="pts">${fmt(r.punkte)}</td></tr>`;
  const sumRow = (label, counts, total) => `<tr><td>${label}</td>${cols.map(w => `<td>${counts[w.id] || 0}</td>`).join('')}<td>${total} St.</td></tr>`;
  const body = `
    ${g ? `<div class="badge">${DAY_TYPES[d.art]}</div>` : ''}
    <div class="chips">${chipsFor(ds.perSpecies, ds.perSpeciesHund)}</div>
    ${v ? '<p class="hint">In den Streckenbericht geht nur die Zeile „Erlegt in Thuine“. Tageskönige werden über alle Jäger ermittelt, für den Jahres-Jagdkönig zählen nur unsere Schützen.</p>' : ''}
    ${tj ? '<p class="hint">Das gesamte Wild (auch das der Gäste) geht in den Streckenbericht. Tageskönige werden über alle Jäger ermittelt, für den Jahres-Jagdkönig zählen nur unsere Schützen.</p>' : ''}
    <div class="table-wrap"><table>
      <thead><tr><th>${g ? 'Thuine' : 'Schütze'}</th>${cols.map(w => `<th>${esc(w.name)}</th>`).join('')}<th class="pts">Punkte</th></tr></thead>
      <tbody>${ds.own.map(rowHtml).join('')}
      ${g ? `<tr class="subhead"><td colspan="${cols.length + 2}">${v ? 'Venslage' : 'Gäste'}</td></tr>${ds.guests.map(rowHtml).join('') || `<tr><td colspan="${cols.length + 2}" class="zero">–</td></tr>`}` : ''}</tbody>
      <tfoot>${v ? sumRow('Erlegt in Thuine', ds.perSpecies, ds.total) + sumRow('Gesamtstrecke', ds.perSpeciesAll, ds.totalAll) : sumRow('Gesamtstrecke', ds.perSpecies, ds.total)}</tfoot>
    </table></div>
    ${Object.keys(ds.perSpeciesHund).length ? '<p class="hint"><span class="dogmark">H</span> = davon vom Hund gegriffen (zählt zur Strecke, ohne Punkte)</p>' : ''}
    <div class="card pad kings" style="margin-top:12px">
      <div><span class="k"><span class="crown">♛</span> Jagdkönig</span> ${ds.koenig.length ? `${dayNames(ds, ds.koenig)} · ${fmt(ds.koenigPts)} Pkt.` : '–'}</div>
      <div><span class="k">Vizekönig</span> ${ds.vize.length ? `${dayNames(ds, ds.vize)} · ${fmt(ds.vizePts)} Pkt.` : '–'}</div>
      <div><span class="k">Sonderkönig</span> ${esc(sonderName(d.sonderkoenig)) || '–'}</div>
    </div>
    ${d.bemerkung ? `<div class="card pad"><div class="sub">Bemerkung</div>${esc(d.bemerkung)}</div>` : ''}`;
  const foot = isAdmin()
    ? `<button class="btn danger" id="delDay">Löschen</button><button class="btn" id="editDay">Bearbeiten</button>`
    : '';
  openSheet(`Jagdtag ${dateDE(d.datum, true)}`, body, foot);
  $('#editDay')?.addEventListener('click', () => openEditor(d.id));
  $('#delDay')?.addEventListener('click', e => {
    const b = e.currentTarget;
    if (b.dataset.armed) {
      state.data.jagdtage = state.data.jagdtage.filter(x => x.id !== d.id);
      closeSheet(); persist(`Jagdtag ${dateDE(d.datum)} gelöscht`);
    } else { b.dataset.armed = '1'; b.textContent = 'Wirklich löschen?'; }
  });
}

/* ================= Editor ================= */
let editor = null;

function openEditor(dayId, prefill = null) {
  const existing = dayId ? state.data.jagdtage.find(x => x.id === dayId) : null;
  const base = existing ? clone(existing) : { id: null, datum: todayISO(), art: 'normal', strecke: {}, hund: {}, gaeste: [], revier: {}, sonderkoenig: '', bemerkung: '' };
  base.art ||= 'normal'; base.gaeste ||= []; base.revier ||= {};
  editor = {
    originalId: existing?.id || null,
    day: base,
    flags: {},          // id → Hinweistext
    hinweise: [],
    unassigned: [],     // von KI gelesen, keinem Schützen zugeordnet
    open: new Set(),
    showDog: new Set(Object.keys(base.hund || {})),
    photo: null,
    openG: new Set(),
  };
  if (prefill) Object.assign(editor, prefill);
  renderEditor();
}

function editorShooters() {
  const inDay = new Set([...Object.keys(editor.day.strecke), ...Object.keys(editor.day.hund), ...Object.keys(editor.flags)]);
  const season = seasonOf(editor.day.datum || todayISO());
  return state.data.schuetzen.filter(s => isMember(s, season) || inDay.has(s.id));
}

function renderEditor() {
  const d = editor.day;
  const pm = ptsMap();
  const dupe = state.data.jagdtage.find(x => x.datum === d.datum && x.id !== editor.originalId);
  const shooters = editorShooters();
  const v = d.art === 'venslage', gd = hasGuests(d);
  const totals = {};
  for (const src of [d.strecke, d.hund]) for (const c of Object.values(src)) addCounts(totals, c);
  const allTotals = addCounts({}, totals);
  if (gd) for (const g of d.gaeste) { addCounts(allTotals, g.erlegt); addCounts(allTotals, g.hund); }
  const barCounts = v ? d.revier : allTotals;

  const alerts = [];
  if (editor.hinweise.length) alerts.push(`<div class="alert"><b>Bitte prüfen:</b><ul>${editor.hinweise.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>`);
  if (editor.photo) alerts.push(`<div class="alert info">Von der KI aus dem Foto gelesen. Bitte mit dem Zettel vergleichen und dann speichern.</div>`);
  if (dupe) alerts.push(`<div class="alert">Für den ${dateDE(d.datum)} gibt es bereits einen Jagdtag. Beim Speichern wird er <b>ersetzt</b>.</div>`);

  const unassigned = editor.unassigned.map((u, i) => `
    <div class="card pad">
      <div><b>Nicht zugeordnet:</b> „${esc(u.name)}“ – ${esc(species().filter(w => u.erlegt[w.id] || u.hund[w.id]).map(w => `${(u.erlegt[w.id] || 0) + (u.hund[w.id] || 0)} ${w.name}`).join(', ') || 'keine Strecke')}</div>
      <div class="btn-row" style="margin-top:8px">
        <select class="field-inline" data-assign="${i}" style="flex:1 1 180px;padding:8px;border-radius:10px;border:1px solid var(--line);background:var(--paper)">
          <option value="">Schütze wählen …</option>
          ${state.data.schuetzen.map(s => `<option value="${esc(s.id)}">${esc(s.vollname || s.name)} (${esc(s.name)})</option>`).join('')}
          <option value="__new">+ Als neuen Schützen „${esc(u.name)}“ anlegen</option>
        </select>
        <button class="btn ghost" data-drop="${i}">Verwerfen</button>
      </div>
    </div>`).join('');

  const rows = shooters.map(s => {
    const e = d.strecke[s.id] || {}, h = d.hund[s.id] || {};
    const cnt = sumCounts(e) + sumCounts(h);
    const open = editor.open.has(s.id) || !!editor.flags[s.id];
    const sum = species().filter(w => e[w.id] || h[w.id]).map(w => `${(e[w.id] || 0) + (h[w.id] || 0)} ${w.name}`).join(', ');
    const dogOpen = editor.showDog.has(s.id);
    return `<div class="ed-row ${cnt ? 'has' : ''} ${editor.flags[s.id] ? 'flag' : ''}" data-sid="${esc(s.id)}">
      <button class="ed-head" data-toggle="${esc(s.id)}">
        <span class="ed-name">${esc(s.name)}${s.vollname ? `<small class="ed-full">${esc(s.vollname)}</small>` : ''}</span>
        <span class="ed-sum">${esc(sum)}</span>
        <span class="ed-pts">${cnt ? fmt(pointsOf(e, pm)) : ''}</span>
      </button>
      ${editor.flags[s.id] ? `<div class="ed-flag">⚠ ${esc(editor.flags[s.id])}</div>` : ''}
      ${open ? `<div class="ed-body">
        <div class="steppers">${species().map(w => stepper(s.id, w, 'strecke', e[w.id] || 0)).join('')}</div>
        ${dogOpen ? `<div class="hint" style="margin-top:12px">Vom Hund gegriffen (zählt zur Strecke, ohne Punkte):</div>
          <div class="steppers">${species().map(w => stepper(s.id, w, 'hund', h[w.id] || 0)).join('')}</div>`
          : `<button class="ed-toggle" data-dog="${esc(s.id)}">+ Vom Hund gegriffenes Wild</button>`}
      </div>` : ''}
    </div>`;
  }).join('');

  const body = `
    <div class="ed-totals"><span>${v ? 'Erlegt in Thuine:' : 'Strecke:'}</span>${species().filter(w => barCounts[w.id]).map(w => `<span><b>${barCounts[w.id]}</b> ${esc(w.name)}</span>`).join('') || '<span class="sub">noch leer</span>'}<span style="margin-left:auto"><b>${sumCounts(barCounts)}</b> Stück${v ? ` · gesamt ${sumCounts(allTotals)}` : ''}${d.art === 'treibjagd' ? ' (inkl. Gäste)' : ''}</span></div>
    ${editor.photo ? `<details class="card pad"><summary>Foto der Erlegerliste anzeigen</summary><img class="photo-preview" src="${editor.photo}" alt="Foto der Erlegerliste" style="margin-top:10px;max-height:70vh"></details>` : ''}
    ${alerts.join('')}
    <label class="field"><span>Jagdtag</span><input type="date" id="edDate" value="${esc(d.datum)}"></label>
    <div class="seg" role="radiogroup" aria-label="Art des Jagdtages">
      ${Object.keys(DAY_TYPES).map(k => `<button type="button" role="radio" aria-checked="${d.art === k}" class="${d.art === k ? 'on' : ''}" data-art="${k}">${DAY_SHORT[k]}</button>`).join('')}
    </div>
    ${unassigned}
    ${gd ? '<div class="sec-label">Thuine</div>' : ''}
    <div class="hint">Schützen antippen, um Wild einzutragen. Die Punkte werden automatisch berechnet.</div>
    <div>${rows}</div>
    <button class="btn secondary block" id="edAddShooter">+ ${gd ? 'Neuen Thuiner Schützen' : 'Gast / neuen Schützen'} hinzufügen</button>
    ${gd ? guestEditorHtml(d) : ''}
    <label class="field"><span>Sonderkönig</span>
      <input type="text" id="edSonder" list="shooterList" value="${esc(sonderName(d.sonderkoenig))}" placeholder="optional">
      <datalist id="shooterList">${state.data.schuetzen.map(s => `<option value="${esc(s.vollname || s.name)}">`).join('')}${gd ? d.gaeste.filter(g => g.name).map(g => `<option value="${esc(g.name)}">`).join('') : ''}</datalist>
    </label>
    <label class="field"><span>Bemerkung</span><textarea id="edNote" placeholder="optional, z. B. wer gefehlt hat">${esc(d.bemerkung)}</textarea></label>`;
  const foot = `<button class="btn secondary" data-close>Abbrechen</button><button class="btn" id="edSave">Speichern</button>`;
  const scroll = $('#sheet').hidden ? 0 : $('#sheetBody').scrollTop;
  openSheet(editor.originalId ? `Jagdtag bearbeiten` : 'Neuer Jagdtag', body, foot);
  $('#sheetBody').scrollTop = scroll;
  bindEditor();
}

/** Bekannte Gast-Namen aus früheren Jagdtagen derselben Art (für Vorschläge) */
function knownGuests(art) {
  const set = new Set();
  state.data.jagdtage.filter(t => t.art === art).forEach(t => (t.gaeste || []).forEach(g => g.name && set.add(g.name)));
  return [...set].sort((a, b) => a.localeCompare(b, 'de'));
}

function guestEditorHtml(d) {
  const pm = ptsMap();
  const v = d.art === 'venslage';
  const hosts = state.data.schuetzen.filter(s => isMember(s, seasonOf(d.datum || todayISO())));
  const guests = d.gaeste.map((g, i) => {
    const e = g.erlegt || {};
    const cnt = sumCounts(e);
    const open = editor.openG.has(i) || !g.name;
    const sum = species().filter(w => e[w.id]).map(w => `${e[w.id]} ${w.name}`).join(', ');
    return `<div class="ed-row ${cnt ? 'has' : ''} ${g._flag ? 'flag' : ''}">
      <div class="g-head">
        <input type="text" class="g-name" data-gname="${i}" value="${esc(g.name)}" placeholder="${v ? 'Name, z. B. „Vogt, A.“' : 'Name des Gastes'}" list="guestList" aria-label="Name ${v ? 'Venslager Jäger' : 'Gast'}">
        <div class="g-sub">
          <span class="ed-sum">${esc(sum) || '<span class="sub">noch kein Wild</span>'}</span>
          <span class="ed-pts">${cnt ? fmt(pointsOf(e, pm)) + ' Pkt.' : ''}</span>
          <button type="button" class="icon-btn" data-gtoggle="${i}" aria-label="Wild eintragen">${open ? '▴' : '▾'}</button>
        </div>
      </div>
      ${g._flag ? `<div class="ed-flag">⚠ ${esc(g._flag)}</div>` : ''}
      ${!v ? `<div class="host-row"><label>Gast von <select data-ghost="${i}"><option value="">– unbekannt –</option>${hosts.map(s => `<option value="${esc(s.id)}" ${g.gastgeber === s.id ? 'selected' : ''}>${esc(s.vollname || s.name)}</option>`).join('')}</select></label></div>` : ''}
      ${open ? `<div class="ed-body">
        <div class="steppers">${species().map(w => stepper(String(i), w, 'gast', e[w.id] || 0)).join('')}</div>
        <button type="button" class="ed-toggle" data-gdel="${i}" style="color:var(--warn)">${v ? 'Jäger' : 'Gast'} entfernen</button>
      </div>` : ''}
    </div>`;
  }).join('');
  const head = v
    ? `<div class="sec-label">Venslage</div>
    <div class="hint">Jäger aus Venslage mit Namen eintragen. Sie zählen für die Tageskönige, aber nicht für unseren Jahres-Jagdkönig.</div>`
    : `<div class="sec-label">Gäste</div>
    <div class="hint">Die Gäste aus den freien Zeilen unter unseren Namen. Ihr Wild zählt voll zur Strecke und für die Tageskönige, aber nicht für unseren Jahres-Jagdkönig.</div>`;
  return `
    ${head}
    <datalist id="guestList">${knownGuests(d.art).map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <div>${guests}</div>
    <button class="btn secondary block" id="edAddGuest">+ ${v ? 'Venslager Jäger' : 'Gast'} hinzufügen</button>
    ${v ? venslageRevierHtml(d) : ''}`;
}

function venslageRevierHtml(d) {
  return `
    <div class="sec-label">Erlegt in Thuine</div>
    <div class="hint">Das Wild, das im Revier Thuine erlegt wurde (Zeile „Erlegt in Thuine“). Nur diese Zahlen gehen in unseren Streckenbericht.</div>
    <div class="card pad"><div class="steppers" style="margin-top:0">${species().map(w => stepper('_', w, 'revier', d.revier[w.id] || 0)).join('')}</div></div>`;
}

function stepper(sid, w, kind, val) {
  return `<div class="stepper ${kind === 'hund' ? 'dog' : ''}">
    <span class="lab">${esc(w.name)} <small>${kind === 'hund' ? '' : fmt(w.punkte)}</small></span>
    <span class="ctl">
      <button type="button" data-step="-1" data-sid="${esc(sid)}" data-w="${w.id}" data-kind="${kind}" aria-label="${esc(w.name)} weniger">−</button>
      <output>${val}</output>
      <button type="button" data-step="1" data-sid="${esc(sid)}" data-w="${w.id}" data-kind="${kind}" aria-label="${esc(w.name)} mehr">+</button>
    </span>
  </div>`;
}

function syncEditorFields() {
  if (!editor) return;
  editor.day.datum = $('#edDate')?.value || editor.day.datum;
  editor.day.sonderkoenig = $('#edSonder')?.value.trim() ?? editor.day.sonderkoenig;
  editor.day.bemerkung = $('#edNote')?.value.trim() ?? editor.day.bemerkung;
  $$('[data-gname]').forEach(i => { const g = editor.day.gaeste[Number(i.dataset.gname)]; if (g) g.name = i.value.trim(); });
  $$('[data-ghost]').forEach(i => { const g = editor.day.gaeste[Number(i.dataset.ghost)]; if (g) g.gastgeber = i.value; });
}

function bindEditor() {
  const body = $('#sheetBody');
  body.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
    syncEditorFields();
    const id = b.dataset.toggle;
    editor.open.has(id) ? editor.open.delete(id) : editor.open.add(id);
    if (editor.flags[id] && !editor.open.has(id)) delete editor.flags[id]; // geprüft
    renderEditor();
  }));
  body.querySelectorAll('[data-dog]').forEach(b => b.addEventListener('click', () => { syncEditorFields(); editor.showDog.add(b.dataset.dog); renderEditor(); }));
  body.querySelectorAll('[data-art]').forEach(b => b.addEventListener('click', () => { syncEditorFields(); editor.day.art = b.dataset.art; renderEditor(); }));
  body.querySelectorAll('[data-gtoggle]').forEach(b => b.addEventListener('click', () => {
    syncEditorFields(); const i = Number(b.dataset.gtoggle);
    editor.openG.has(i) ? editor.openG.delete(i) : editor.openG.add(i);
    delete editor.day.gaeste[i]._flag; renderEditor();
  }));
  body.querySelectorAll('[data-gdel]').forEach(b => b.addEventListener('click', () => {
    syncEditorFields(); editor.day.gaeste.splice(Number(b.dataset.gdel), 1); editor.openG.clear(); renderEditor();
  }));
  $('#edAddGuest')?.addEventListener('click', () => {
    syncEditorFields(); editor.day.gaeste.push({ name: '', erlegt: {}, hund: {} }); editor.openG.add(editor.day.gaeste.length - 1); renderEditor();
    $$('[data-gname]').at(-1)?.focus();
  });
  body.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
    const { sid, w, kind } = b.dataset;
    if (kind === 'gast' || kind === 'revier') {
      syncEditorFields();
      const c = kind === 'gast' ? (editor.day.gaeste[Number(sid)].erlegt ||= {}) : editor.day.revier;
      c[w] = Math.max(0, (c[w] || 0) + Number(b.dataset.step));
      if (!c[w]) delete c[w];
      if (kind === 'gast') editor.openG.add(Number(sid));
      renderEditor(); return;
    }
    const bucket = editor.day[kind];
    const c = (bucket[sid] ||= {});
    c[w] = Math.max(0, (c[w] || 0) + Number(b.dataset.step));
    if (!c[w]) delete c[w];
    if (!Object.keys(c).length) delete bucket[sid];
    syncEditorFields(); renderEditor();
  }));
  $('#edDate').addEventListener('change', () => { syncEditorFields(); renderEditor(); });
  body.querySelectorAll('[data-assign]').forEach(sel => sel.addEventListener('change', () => {
    syncEditorFields();
    const u = editor.unassigned[Number(sel.dataset.assign)];
    let id = sel.value;
    if (!id) return;
    if (id === '__new') id = addShooter(u.name, '', seasonOf(editor.day.datum));
    mergeCounts(editor.day.strecke, id, u.erlegt);
    mergeCounts(editor.day.hund, id, u.hund);
    if (Object.keys(u.hund).length) editor.showDog.add(id);
    editor.open.add(id);
    editor.unassigned.splice(Number(sel.dataset.assign), 1);
    renderEditor();
  }));
  body.querySelectorAll('[data-drop]').forEach(b => b.addEventListener('click', () => { syncEditorFields(); editor.unassigned.splice(Number(b.dataset.drop), 1); renderEditor(); }));
  $('#edAddShooter').addEventListener('click', () => {
    syncEditorFields();
    const wrap = document.createElement('div');
    wrap.className = 'card pad';
    wrap.innerHTML = `<label class="field"><span>Kurzname wie auf der Liste (z. B. „Muster, H.“)</span><input type="text" id="newShooter"></label>
      <label class="field" style="margin-top:8px"><span>Voller Name (z. B. „Hans Muster“)</span><input type="text" id="newShooterFull"></label>
      <div class="btn-row" style="margin-top:8px"><button class="btn" id="newShooterOk">Hinzufügen</button></div>`;
    $('#edAddShooter').replaceWith(wrap);
    $('#newShooter').focus();
    $('#newShooterOk').addEventListener('click', () => {
      const n = $('#newShooter').value.trim();
      if (!n) return;
      const id = addShooter(n, $('#newShooterFull').value.trim(), seasonOf(editor.day.datum));
      editor.open.add(id); renderEditor();
    });
  });
  $('#edSave').addEventListener('click', saveEditor);
}

function mergeCounts(bucket, id, counts) {
  for (const [k, v] of Object.entries(counts || {})) {
    if (!v) continue;
    const c = (bucket[id] ||= {}); c[k] = (c[k] || 0) + v;
  }
}

function addShooter(name, vollname = '', ab = '') {
  const existing = findShooter(name);
  if (existing) { existing.aktiv = true; if (vollname && !existing.vollname) existing.vollname = vollname; return existing.id; }
  let id = slug(name), i = 2;
  while (shooterById(id)) id = `${slug(name)}-${i++}`;
  const s = { id, name, vollname: vollname || '', aktiv: true };
  if (ab) s.ab = ab;
  state.data.schuetzen.push(s);
  return id;
}

async function saveEditor() {
  syncEditorFields();
  const d = editor.day;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.datum)) { toast('Bitte ein gültiges Datum wählen.'); return; }
  if (editor.unassigned.length) { toast('Bitte zuerst die nicht zugeordneten Einträge zuordnen oder verwerfen.', 3500); return; }
  const isV = d.art === 'venslage', withG = hasGuests(d);
  const gaeste = withG ? d.gaeste.map(g => {
    const o = { name: (g.name || '').trim(), erlegt: g.erlegt || {}, hund: g.hund || {} };
    if (!isV && g.gastgeber) o.gastgeber = g.gastgeber;
    return o;
  }).filter(g => g.name || sumCounts(g.erlegt)) : [];
  if (gaeste.some(g => !g.name)) { toast(`Bitte bei allen ${isV ? 'Venslager Jägern' : 'Gästen'} einen Namen eintragen.`, 3500); return; }
  d.id = d.datum;
  // bestehende Einträge (alter Stand + gleicher Tag) ersetzen
  state.data.jagdtage = state.data.jagdtage.filter(x => x.id !== editor.originalId && x.datum !== d.datum);
  const rec = { id: d.id, datum: d.datum, art: DAY_TYPES[d.art] ? d.art : 'normal', sonderkoenig: d.sonderkoenig, bemerkung: d.bemerkung, strecke: d.strecke, hund: d.hund };
  if (withG) rec.gaeste = gaeste;
  if (isV) rec.revier = d.revier;
  state.data.jagdtage.push(rec);
  state.data.jagdtage.sort((a, b) => a.datum.localeCompare(b.datum));
  state.season = seasonOf(d.datum);
  const msg = `Jagdtag ${dateDE(d.datum)} ${editor.originalId ? 'geändert' : 'erfasst'}`;
  closeSheet();
  switchTab('tage');
  await persist(msg);
}

/* ================= Foto → KI ================= */
function startPhoto() {
  if (!state.cfg.apiKey) {
    toast('Für die Foto-Auswertung bitte zuerst den Anthropic-API-Schlüssel in den Einstellungen eintragen.', 4500);
    openSettings(); return;
  }
  const inp = $('#photoInput');
  inp.value = '';
  inp.onchange = () => inp.files[0] && analysePhoto(inp.files[0]);
  inp.click();
}

async function imageToJpeg(file, maxSide = 1800) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Bild konnte nicht gelesen werden')); i.src = url; });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

function buildPrompt() {
  const list = state.data.schuetzen.map(s => `${s.id} = ${s.name}${s.vollname ? ` (${s.vollname})` : ''}`).join('\n');
  const arten = species().map(w => `${w.id} (${w.name})`).join(', ');
  return `Du liest eine handschriftlich ausgefüllte "Erlegerliste" (Streckenbericht einer Treibjagd) von einem Foto aus.

Aufbau des Zettels: Oben "Jagdtag" mit Datum (z. B. 18.10.25). Darunter eine Tabelle: Spalte "Name" (vorgedruckte Schützen), dann Spalten für Wildarten und ganz rechts "Punkte" (handschriftlich, nur zur Kontrolle). Unten "Gesamtstrecke" und die Felder Jagdkönig, Vizekönig, Sonderkönig.
Aktuelle Vorlage (ab 2026): Spalten "Hase", "Fasan", "Kanin.", "Taube", "Schnepf" (= schnepfe), "Sonstige". Ältere Zettel haben nur "Hase", "Fasan", "Kanin.", "Taube", "Sonstig".
Die Spalte "Sonstige"/"Sonstig": Hier steht meist Zahl + Wildart als Wort (z. B. "1 Ente", "1 Fuchs", "1 Schnepfe"). Ordne das der passenden Wildart-ID zu (ente, fuchs, schnepfe, taube, kaninchen …). Nur wenn keine erkennbare Wildart dabeisteht, zählt es als "sonstiges". Scherz-Vermerke wie "Ast" sind kein Wild.

Bekannte Schützen (id = Name auf dem Zettel (voller Name)):
${list}

Wildarten-IDs: ${arten}

Regeln:
- Lies für jede Zeile die Anzahl je Wildart-Spalte. Leere Zellen = 0. Nimm nur Zeilen auf, in denen etwas erlegt wurde.
- Ist in einer Zelle zusätzlich ein Wort notiert (z. B. "1 Schnepfe" in der Spalte Sonstig), ordne es der passenden Wildart-ID zu (hier: schnepfe). Unbekanntes bleibt "sonstiges". "Kanin." = kaninchen.
- Steht bei einer Zahl "Hund" (z. B. "1 Hund" in der Hasen-Spalte), hat der Hund das Stück gegriffen: trage es unter "hund" ein, NICHT unter "erlegt".
- "punkte_zettel" = die handschriftliche Zahl in der Punkte-Spalte (bei Korrekturen der zuletzt gültige Wert), sonst null.
- Ordne jede Zeile der passenden id aus der Liste zu. Steht dort ein Name, der nicht in der Liste ist, setze "schuetze_id": null und gib den Namen in "name_zettel" an.
- Handschriftliche Vermerke wie "fehlt" beim Namen gehören in "bemerkung" (z. B. "Beckhuis fehlte").
- Datum als YYYY-MM-DD; zweistellige Jahre sind 20xx.
- "sonderkoenig": der handschriftliche Eintrag im Feld Sonderkönig (möglichst als Name aus der Liste, z. B. "Geerdes, W."), sonst "".
- Wenn du dir bei einer Zahl oder Zuordnung unsicher bist, schreibe es in "unsicher" der Zeile bzw. in "hinweise".
- Durchgestrichene oder übermalte Zahlen gelten nicht, nur der zuletzt gültige Wert.
- Spalten "Bezahlt" (Haken) und "Eingesammelt wird: … €" ignorieren.

SONDERFALL "Jagdtag mit Venslage": Steht unten auf dem Zettel "Jagdtag mit Venslage" bzw. gibt es unter unserer Tabelle eine zweite Tabelle "Venslage" mit handschriftlich eingetragenen Namen, dann:
- "art": "venslage" (sonst "normal").
- Unsere vorgedruckten Schützen oben wie gewohnt in "eintraege".
- Die handschriftlichen Jäger der Venslage-Tabelle in "gaeste": [{"name":"wie geschrieben, möglichst als \"Nachname, Initial\" (z. B. A. Vogt → \"Vogt, A.\")","erlegt":{...},"punkte_zettel":null,"unsicher":null}]. Nur Jäger mit Strecke aufnehmen. Namen sind Handschrift – wenn unsicher, in "unsicher" vermerken.
- Die Zeile "Erlegt in Thuine" (gelb) als "revier": {"hase":0,...} – das ist das Wild aus dem Revier Thuine, unabhängig davon, wer es geschossen hat.
- Einträge wie "Ast" oder andere Scherz-Vermerke sind KEIN Wild: nicht zählen, sondern in "bemerkung" erwähnen (z. B. "Brockhaus: Ast").
- Die Zeile "Gesamtstrecke" nur zur Kontrolle nutzen; wenn unsere Zeilen + Venslage nicht zur Gesamtstrecke passen, in "hinweise" vermerken.

SONDERFALL "Große Treibjagd": Steht oben "Große Treibjagd" und gibt es unter JEDEM vorgedruckten Namen eine freie Zeile, in die handschriftlich ein Jagdgast eingetragen ist, dann:
- "art": "treibjagd".
- Unsere vorgedruckten Schützen wie gewohnt in "eintraege".
- Jeder handschriftlich eingetragene Gast in "gaeste": [{"name":"wie geschrieben","gastgeber":"id des Schützen, unter dessen Namen die Gastzeile steht","erlegt":{...},"punkte_zettel":null,"unsicher":null}]. Gäste ohne Strecke weglassen. Nicht lesbare Namen: "name":"" und in "unsicher" vermerken.
- Spalten "Beitrag bez." und "Kostenbeitrag" ignorieren.

Antworte ausschließlich mit JSON in genau diesem Format, ohne weiteren Text:
{"datum":"YYYY-MM-DD","art":"normal | venslage | treibjagd","eintraege":[{"schuetze_id":"id oder null","name_zettel":"...","erlegt":{"hase":0},"hund":{},"punkte_zettel":null,"unsicher":null}],"gaeste":[],"revier":{},"sonderkoenig":"","bemerkung":"","hinweise":[]}`;
}

async function analysePhoto(file) {
  openSheet('Foto wird ausgewertet', `<div class="empty"><div class="spinner"></div><p>Die KI liest die Erlegerliste … das dauert etwa 10–30 Sekunden.</p></div>`, `<button class="btn secondary" data-close>Abbrechen</button>`);
  const ctrl = new AbortController();
  const closeBtn = $('#sheetFoot [data-close]');
  closeBtn?.addEventListener('click', () => ctrl.abort());
  try {
    const dataUrl = await imageToJpeg(file);
    const b64 = dataUrl.split(',')[1];
    const model = state.cfg.model || FALLBACK_MODEL;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': state.cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model, max_tokens: 3000,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: buildPrompt() },
        ] }],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || `API-Fehler ${r.status}`);
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Antwort der KI enthielt kein JSON.');
    const parsed = JSON.parse(m[0]);
    if ($('#sheet').hidden) return; // abgebrochen
    applyAiResult(parsed, dataUrl);
  } catch (e) {
    if (e.name === 'AbortError') return;
    openSheet('Auswertung fehlgeschlagen', `<div class="alert">${esc(e.message)}</div><p class="hint">Du kannst es erneut versuchen oder den Jagdtag manuell erfassen.</p>`,
      `<button class="btn secondary" id="failManual">Manuell erfassen</button><button class="btn" id="failRetry">Neues Foto</button>`);
    $('#failManual').addEventListener('click', () => openEditor(null));
    $('#failRetry').addEventListener('click', startPhoto);
  }
}

function cleanCounts(obj) {
  const valid = new Set(species().map(w => w.id));
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const n = Math.round(Number(v));
    if (!n || n < 0) continue;
    const key = valid.has(k) ? k : 'sonstiges';
    out[key] = (out[key] || 0) + n;
  }
  return out;
}

function applyAiResult(res, photo) {
  const day = { id: null, datum: /^\d{4}-\d{2}-\d{2}$/.test(res.datum || '') ? res.datum : todayISO(), strecke: {}, hund: {}, sonderkoenig: res.sonderkoenig || '', bemerkung: res.bemerkung || '' };
  const flags = {}; const hinweise = [...(res.hinweise || [])]; const unassigned = []; const open = new Set(); const showDog = new Set();
  if (!res.datum) hinweise.push('Datum nicht lesbar – bitte eintragen.');
  const pm = ptsMap();
  for (const e of res.eintraege || []) {
    const erlegt = cleanCounts(e.erlegt), hund = cleanCounts(e.hund);
    if (!sumCounts(erlegt) && !sumCounts(hund)) continue;
    let id = e.schuetze_id && shooterById(e.schuetze_id) ? e.schuetze_id : null;
    if (!id && e.name_zettel) id = findShooter(e.name_zettel)?.id || null;
    if (!id) { unassigned.push({ name: e.name_zettel || 'Unbekannt', erlegt, hund }); continue; }
    mergeCounts(day.strecke, id, erlegt);
    mergeCounts(day.hund, id, hund);
    if (sumCounts(hund)) showDog.add(id);
    const calc = pointsOf(day.strecke[id] || {}, pm);
    const notes = [];
    if (e.punkte_zettel != null && Number(e.punkte_zettel) !== calc) notes.push(`Zettel: ${fmt(Number(e.punkte_zettel))} Pkt., berechnet: ${fmt(calc)} Pkt.`);
    if (e.unsicher) notes.push(`KI unsicher: ${e.unsicher}`);
    if (notes.length) { flags[id] = notes.join(' · '); open.add(id); }
  }
  // Sonderkönig auf bekannten Namen abbilden
  if (day.sonderkoenig) {
    const s = findShooter(day.sonderkoenig);
    if (s) day.sonderkoenig = s.vollname || s.name;
  }
  // Venslage
  const openG = new Set();
  day.art = DAY_TYPES[res.art] ? res.art : ((res.gaeste || []).length ? 'venslage' : 'normal');
  day.gaeste = []; day.revier = {};
  if (hasGuests(day)) {
    if (day.art === 'venslage') day.revier = cleanCounts(res.revier);
    for (const g of res.gaeste || []) {
      const erlegt = cleanCounts(g.erlegt);
      if (!sumCounts(erlegt)) continue;
      const guest = { name: String(g.name || '').trim(), erlegt, hund: {} };
      if (day.art === 'treibjagd' && g.gastgeber && shooterById(g.gastgeber)) guest.gastgeber = g.gastgeber;
      const notes = [];
      const calc = pointsOf(erlegt, pm);
      if (g.punkte_zettel != null && Number(g.punkte_zettel) !== calc) notes.push(`Zettel: ${fmt(Number(g.punkte_zettel))} Pkt., berechnet: ${fmt(calc)} Pkt.`);
      if (g.unsicher) notes.push(`KI unsicher: ${g.unsicher}`);
      if (!guest.name) notes.push('Name nicht lesbar – bitte eintragen');
      if (notes.length) { guest._flag = notes.join(' · '); openG.add(day.gaeste.length); }
      day.gaeste.push(guest);
    }
    if (day.art === 'venslage' && !sumCounts(day.revier)) hinweise.push('Zeile „Erlegt in Thuine“ nicht erkannt – bitte unten eintragen.');
  }
  // Sonderkönig ggf. Venslager Name
  if (day.sonderkoenig && !findShooter(day.sonderkoenig)) {
    const g = day.gaeste.find(x => x.name.toLowerCase() === day.sonderkoenig.toLowerCase());
    if (g) day.sonderkoenig = g.name;
  }
  const existing = state.data.jagdtage.find(x => x.datum === day.datum);
  openEditor(null);
  Object.assign(editor, { day, flags, hinweise, unassigned, open, showDog, photo, openG, originalId: existing ? existing.id : null });
  if (existing) editor.hinweise.unshift(`Für den ${dateDE(day.datum)} ist bereits ein Jagdtag gespeichert – er wird beim Speichern ersetzt.`);
  renderEditor();
}

/* ================= Einstellungen ================= */
function openSettings() {
  const c = state.cfg;
  const body = `
    <div class="alert info">${isAdmin() ? '<b>Voller Zugang.</b> Du kannst alles erfassen und verwalten.' : canSchalen() ? '<b>Zugang Reh & Damm.</b> Du kannst Reh- und Dammwild eintragen, alles andere nur ansehen.' : '<b>Ansichtsmodus.</b> Zum Ansehen brauchst du nichts einzutragen.'}</div>
    <fieldset><legend>Zugang</legend>
      <label class="field"><span>Ich bin</span>
        <select id="cfIch"><option value="">– bitte wählen –</option>${state.data.schuetzen.filter(s => isMember(s, seasonOf(todayISO())) || s.id === c.ich).map(s => `<option value="${esc(s.id)}" ${s.id === c.ich ? 'selected' : ''}>${esc(s.vollname || s.name)}</option>`).join('')}</select>
      </label>
      <label class="field"><span>Berechtigung</span>
        <select id="cfMode">
          <option value="" ${!c.mode ? 'selected' : ''}>Nur ansehen</option>
          <option value="schalen" ${c.mode === 'schalen' ? 'selected' : ''}>Reh- & Dammwild eintragen</option>
          <option value="voll" ${c.mode === 'voll' ? 'selected' : ''}>Voller Zugang (Verwaltung)</option>
        </select>
      </label>
      <label class="field"><span>Zugriffs-Token (nur auf diesem Gerät gespeichert)</span><input id="cfToken" type="password" value="${esc(c.token)}" placeholder="github_pat_…" autocomplete="off"></label>
      <p class="hint">Den Token bekommst du von Sebastian. Er wird nur auf diesem Gerät gespeichert.</p>
      ${c.mode === 'voll' ? `<details><summary>Speicherort (GitHub)</summary>
        <div class="grid2" style="margin-top:10px">
          <label class="field"><span>Konto</span><input id="cfOwner" value="${esc(c.owner)}" autocapitalize="off" autocorrect="off"></label>
          <label class="field"><span>Repository Hauptdaten</span><input id="cfRepo" value="${esc(c.repo)}" autocapitalize="off" autocorrect="off"></label>
        </div>
        <label class="field" style="margin-top:10px"><span>Repository Reh- & Dammwild</span><input id="cfRepo2" value="${esc(c.repo2)}" autocapitalize="off" autocorrect="off"></label>
      </details>` : ''}
    </fieldset>
    ${isAdmin() ? `<fieldset><legend>Meldungen</legend>
      <label class="field"><span>Melde-Zugang (Token nur für das Repository „${esc(meldRepo())}“)</span><input id="cfMeldToken" type="password" value="${esc(meldToken())}" placeholder="github_pat_…" autocomplete="off"></label>
      <p class="hint">Damit können alle Jäger über „Erlegtes Wild melden“ Meldungen an dich schicken. Der Zugang wird verschlüsselt in den gemeinsamen Daten gespeichert – nur wer das Passwort kennt, kann melden. ${canMelden() ? '✓ Aktiv.' : '<b>Noch nicht eingerichtet.</b>'}</p>
      <label class="field" style="margin-top:10px"><span>Push-Kanal (ntfy)</span><input id="cfNtfy" type="text" value="${esc(ntfyTopic())}" placeholder="leer = keine Push-Nachricht" autocomplete="off" autocapitalize="off" autocorrect="off"></label>
      <div class="ml-actions"><button type="button" class="btn secondary" id="cfNtfyNew">Kanal erzeugen</button><button type="button" class="btn secondary" id="cfNtfyTest">Test senden</button></div>
      <p class="hint">In der kostenlosen App <b>ntfy</b> auf „+“ tippen und genau diesen Kanalnamen abonnieren (Server ntfy.sh). Dann kommt bei jeder Meldung eine Push-Nachricht – ohne Namen, nur Wildart und Datum.</p>
      ${'setAppBadge' in navigator && 'Notification' in window ? `<button type="button" class="btn secondary block" id="cfBadge" style="margin-top:8px">${Notification.permission === 'granted' ? '✓ Zahl am App-Symbol aktiv' : 'Zahl am App-Symbol erlauben'}</button>` : ''}
    </fieldset>` : ''}
    ${isAdmin() ? `<fieldset><legend>Datenschutz</legend>
      <label class="field"><span>Passwort der Jagdgemeinschaft</span><input id="cfPw" type="text" value="${esc(state.pw)}" placeholder="mind. 6 Zeichen" autocomplete="off" autocapitalize="off" autocorrect="off"></label>
      <p class="hint">${state.pw ? 'Die Daten werden verschlüsselt gespeichert. Alle Jäger brauchen dieses Passwort zum Ansehen.' : '<b>Noch kein Passwort gesetzt – die Daten sind im Klartext lesbar.</b>'} Ändern: neues Passwort eintragen und übernehmen, danach müssen alle Jäger das neue Passwort einmal eingeben. <b>Passwort gut aufbewahren – ohne es sind die Daten nicht mehr lesbar.</b></p>
    </fieldset>` : ''}
    <fieldset ${c.mode === 'voll' ? '' : 'hidden'}><legend>Foto-Auswertung (KI)</legend>
      <label class="field"><span>Anthropic-API-Schlüssel (nur auf diesem Gerät gespeichert)</span><input id="cfKey" type="password" value="${esc(c.apiKey)}" placeholder="sk-ant-…" autocomplete="off"></label>
      <label class="field"><span>Modell</span>
        <select id="cfModel">${c.model ? `<option value="${esc(c.model)}" selected>${esc(c.model)}</option>` : `<option value="">Standard (${FALLBACK_MODEL})</option>`}</select>
      </label>
      <button class="btn secondary block" id="cfLoadModels">Verfügbare Modelle laden</button>
    </fieldset>
    ${isAdmin() ? `
    <fieldset><legend>Schützen</legend>
      <div id="cfShooters">${state.data.schuetzen.map(s => shooterCfgRow(s)).join('')}</div>
      <button class="btn secondary block" id="cfAddShooter" style="margin-top:10px">+ Neuer Schütze</button>
      <p class="hint">„ab“/„bis“ = Jagdjahre, in denen der Schütze dabei ist. Außerhalb davon erscheint er nicht mehr beim Erfassen, seine alten Ergebnisse bleiben erhalten. Der Kurzname muss so lauten wie auf der Erlegerliste.</p>
    </fieldset>
    <fieldset><legend>Wildarten &amp; Punkte</legend>
      <div id="cfSpecies">${species().map(w => `<div class="list-row" data-wrow="${w.id}"><span class="nm">${esc(w.name)}</span><input type="number" step="0.5" min="0" data-wpts="${w.id}" value="${w.punkte}">${w.eigen && !speciesUsed(w.id) ? `<button type="button" class="icon-btn" data-wdel="${w.id}" aria-label="${esc(w.name)} entfernen" title="Entfernen">✕</button>` : '<span class="icon-spacer"></span>'}</div>`).join('')}</div>
      <div class="list-row"><input type="text" id="cfNewSpecies" placeholder="Neue Wildart"><input type="number" step="0.5" min="0" id="cfNewSpeciesPts" value="1" aria-label="Punkte"><button type="button" class="icon-btn" id="cfAddSpecies" aria-label="Wildart hinzufügen" title="Hinzufügen">＋</button></div>
      <p class="hint">Achtung: Punktänderungen gelten rückwirkend für alle Jagdjahre. Eigene Wildarten lassen sich entfernen, solange sie nirgends eingetragen sind.</p>
    </fieldset>
    <fieldset><legend>Datensicherung</legend>
      <div class="btn-row"><button class="btn secondary" id="cfExport">Sicherung speichern</button><button class="btn secondary" id="cfImport">Sicherung einspielen</button></div>
      <p class="hint">Die Sicherung enthält Niederwild <b>und</b> Reh- &amp; Dammwild – <b>unverschlüsselt</b>. Nur im eigenen Ordner aufbewahren (z. B. OneDrive), nicht weitergeben. Mit ihr lässt sich auch ein vergessenes Passwort zurücksetzen.</p>
      <input type="file" id="cfImportFile" accept="application/json,.json" hidden>
    </fieldset>` : ''}
    <p class="hint" style="text-align:center">Version ${APP_VERSION}</p>`;
  openSheet('Einstellungen', body, `<button class="btn secondary" data-close>Abbrechen</button><button class="btn" id="cfSave">Übernehmen</button>`);

  const removed = new Set();
  $('#cfNtfyNew')?.addEventListener('click', () => { $('#cfNtfy').value = newNtfyTopic(); toast('Neuer Kanal – jetzt in der ntfy-App abonnieren und „Übernehmen“ tippen.', 4500); });
  $('#cfNtfyTest')?.addEventListener('click', async () => {
    const t = $('#cfNtfy').value.trim(); if (!t) { toast('Erst einen Kanal erzeugen.'); return; }
    toast(await sendPush(t, 'Streckenbericht', 'Test – Push-Nachrichten funktionieren ✓') ? 'Test gesendet – kommt die Nachricht an?' : 'Senden fehlgeschlagen – Internet prüfen.', 4000);
  });
  $('#cfBadge')?.addEventListener('click', async e => {
    const b = e.currentTarget;
    try { const p = await Notification.requestPermission(); if (p === 'granted') { b.textContent = '✓ Zahl am App-Symbol aktiv'; updateBadge(); } else toast('Nicht erlaubt – änderbar in den Handy-Einstellungen unter Mitteilungen → Strecke.', 4500); }
    catch { toast('Auf dem iPhone geht das nur in der App vom Home-Bildschirm.', 4000); }
  });
  $$('[data-wdel]').forEach(b => b.addEventListener('click', () => { removed.add(b.dataset.wdel); b.closest('.list-row').remove(); }));
  $('#cfAddSpecies')?.addEventListener('click', () => {
    const name = $('#cfNewSpecies').value.trim(); if (!name) return;
    if (species().some(w => w.name.toLowerCase() === name.toLowerCase()) || $$('[data-newspecies]').some(i => i.dataset.newspecies.toLowerCase() === name.toLowerCase())) { toast('Diese Wildart gibt es schon.'); return; }
    $('#cfSpecies').insertAdjacentHTML('beforeend', `<div class="list-row"><span class="nm">${esc(name)} <small class="sub">(neu)</small></span><input type="number" step="0.5" min="0" data-newspecies="${esc(name)}" value="${esc($('#cfNewSpeciesPts').value || '1')}"><span class="icon-spacer"></span></div>`);
    $('#cfNewSpecies').value = '';
  });
  $('#cfAddShooter')?.addEventListener('click', () => {
    const tmp = { id: `neu-${Date.now()}`, name: '', vollname: '', ab: seasonOf(todayISO()), _neu: true };
    $('#cfShooters').insertAdjacentHTML('beforeend', shooterCfgRow(tmp));
    $$('#cfShooters [data-sname]').at(-1)?.focus();
  });
  $('#cfLoadModels').addEventListener('click', async () => {
    const key = $('#cfKey').value.trim();
    if (!key) { toast('Bitte zuerst den API-Schlüssel eintragen.'); return; }
    try {
      const r = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message || r.status);
      const models = (j.data || []).map(m => m.id);
      const pick = state.cfg.model || models.find(m => m.includes('sonnet')) || models[0] || FALLBACK_MODEL;
      $('#cfModel').innerHTML = models.map(m => `<option value="${esc(m)}" ${m === pick ? 'selected' : ''}>${esc(m)}</option>`).join('');
      toast('Schlüssel gültig ✓ – Modelle geladen.');
    } catch (e) { toast('Schlüssel/Modelle: ' + e.message, 4500); }
  });
  $('#cfExport')?.addEventListener('click', saveBackup);
  $('#cfImport')?.addEventListener('click', () => $('#cfImportFile').click());
  $('#cfImportFile')?.addEventListener('change', async e => {
    try {
      const src = parseBackup(JSON.parse(await e.target.files[0].text()));
      closeSheet();
      await restoreData(src);
      toast(src.schalen ? 'Sicherung eingespielt (Niederwild + Reh & Damm).' : 'Sicherung eingespielt (nur Niederwild).', 4000);
    } catch (err) { toast('Import fehlgeschlagen: ' + err.message, 4000); }
  });
  $('#cfSave').addEventListener('click', async () => {
    const before = JSON.stringify({ s: state.data.schuetzen, w: state.data.wildarten });
    const modeBefore = state.cfg.mode;
    const newPw = $('#cfPw') ? $('#cfPw').value.trim() : state.pw;
    if (newPw !== state.pw && newPw.length < 6) { toast('Das Passwort muss mindestens 6 Zeichen haben.', 3500); return; }
    const pwChanged = newPw !== state.pw;
    const newMeld = $('#cfMeldToken') ? $('#cfMeldToken').value.trim() : meldToken();
    const newNtfy = $('#cfNtfy') ? $('#cfNtfy').value.trim() : ntfyTopic();
    const meldChanged = newMeld !== meldToken() || newNtfy !== ntfyTopic();
    if (meldChanged) {
      state.data.melde = Object.assign({}, state.data.melde, { token: newMeld, ntfy: newNtfy });
      if (!newMeld) delete state.data.melde.token;
      if (!newNtfy) delete state.data.melde.ntfy;
    }
    Object.assign(state.cfg, {
      owner: $('#cfOwner')?.value.trim() ?? state.cfg.owner, repo: $('#cfRepo')?.value.trim() ?? state.cfg.repo, repo2: $('#cfRepo2')?.value.trim() ?? state.cfg.repo2,
      token: $('#cfToken').value.trim(), apiKey: $('#cfKey').value.trim(), model: $('#cfModel').value,
      mode: $('#cfMode').value, ich: $('#cfIch').value,
    });
    if (pwChanged) { state.pwOld = state.pw; state.pw = newPw; lsSet(LS_PW, newPw); }
    if (!pwChanged) loadSchalen();
    lsSet(LS_CFG, state.cfg);
    $$('.sh-cfg').forEach(row => {
      const id = row.dataset.sid;
      const kurz = $('[data-sname]', row).value.trim(), voll = $('[data-sfull]', row).value.trim();
      const ab = $('[data-sab]', row).value, bis = $('[data-sbis]', row).value;
      let s = shooterById(id);
      if (!s) { if (!kurz) return; s = shooterById(addShooter(kurz, voll)); }
      if (kurz) s.name = kurz;
      s.vollname = voll;
      s.aktiv = true;
      if (ab) s.ab = ab; else delete s.ab;
      if (bis) s.bis = bis; else delete s.bis;
    });
    $$('[data-wpts]').forEach(i => { const w = species().find(x => x.id === i.dataset.wpts); const v = Number(i.value); if (w && v >= 0) w.punkte = v; });
    if (removed.size) state.data.wildarten = state.data.wildarten.filter(w => !removed.has(w.id));
    $$('[data-newspecies]').forEach(i => addSpecies(i.dataset.newspecies, i.value));
    closeSheet();
    if (pwChanged) {
      await persist('Daten verschlüsselt');
      await pushSchalen('Reh-/Dammwild verschlüsselt', true);
      if (canMelden()) { try { await changeMeldungen(l => l, 'Meldungen neu verschlüsselt'); } catch { /* egal */ } }
      state.pwOld = '';
      toast('Daten sind jetzt mit dem Passwort verschlüsselt.', 4000);
    } else if (meldChanged || JSON.stringify({ s: state.data.schuetzen, w: state.data.wildarten }) !== before) { await persist(meldChanged ? 'Melde-Zugang geändert' : 'Schützen/Punkte geändert'); loadMeldungen(); }
    else { render(); if (state.pending) pushRemote(); else load(); }
  });
}

function shooterCfgRow(s) {
  const opts = (val, empty) => `<option value="">${empty}</option>` + seasonRange().map(x => `<option value="${x}" ${x === val ? 'selected' : ''}>${x}</option>`).join('');
  return `<div class="sh-cfg" data-sid="${esc(s.id)}">
    <input type="text" data-sname value="${esc(s.name)}" placeholder="Kurzname (Liste)" aria-label="Kurzname">
    <input type="text" data-sfull value="${esc(s.vollname || '')}" placeholder="Voller Name" aria-label="Voller Name">
    <label>ab <select data-sab>${opts(s.ab, 'immer')}</select></label>
    <label>bis <select data-sbis>${opts(s.bis, 'offen')}</select></label>
  </div>`;
}

/* ================= Sicherung & Wiederherstellung ================= */
function makeBackup() {
  return { typ: 'streckenbericht-sicherung', version: 1, erstellt: new Date().toISOString(), niederwild: state.data, schalenwild: state.schalen };
}
function saveBackup() {
  const blob = new Blob([JSON.stringify(makeBackup(), null, 2)], { type: 'application/json' });
  shareOrDownload(blob, `Streckenbericht_Sicherung_${todayISO()}.json`);
}
/** Liest Sicherung (neues Format oder alte reine Niederwild-Datei) */
function parseBackup(obj) {
  if (obj?.enc) throw new Error('Diese Datei ist verschlüsselt – bitte eine Sicherung aus „Sicherung speichern“ verwenden.');
  const main = obj?.typ === 'streckenbericht-sicherung' ? obj.niederwild : obj;
  if (!main || !Array.isArray(main.jagdtage) || !Array.isArray(main.schuetzen)) throw new Error('Unbekanntes Dateiformat');
  const sw = obj?.typ === 'streckenbericht-sicherung' ? obj.schalenwild : null;
  return { main: normalize(clone(main)), schalen: sw ? normalizeSchalen(clone(sw)) : null, erstellt: obj?.erstellt };
}
/** Spielt einen Stand ein und speichert ihn (mit aktuellem Passwort verschlüsselt) */
async function restoreData({ main, schalen }, label = 'Daten aus Sicherung eingespielt') {
  state.data = main;
  lsSet(LS_DATA, main);
  await persist(label);
  if (schalen) {
    state.schalenOps = [];
    queueSchalenOp({ type: 'replace', eintraege: schalen.eintraege });
    await pushSchalen(label);
  }
  render();
}

/* „Passwort vergessen?“ auf dem Sperrbildschirm – nur mit vollem Zugang */
function openReset() {
  const cachedMain = lsGet(LS_DATA, null), cachedSch = lsGet(LS_SCHALEN, null);
  const hasCache = !!(cachedMain && Array.isArray(cachedMain.jagdtage));
  const box = $('#resetBox');
  box.hidden = false; $('#lockForm').hidden = true;
  box.innerHTML = `
    <h2>Passwort vergessen</h2>
    <p class="sub" style="text-align:left">Nur für den vollen Zugang (Verwaltung). Du spielst einen bekannten Stand ein und vergibst ein neues Passwort. Danach müssen alle Jäger das neue Passwort einmal eingeben.</p>
    ${isAdmin() ? '' : `<label class="field" style="text-align:left"><span>Dein GitHub-Token (voller Zugang)</span><input type="password" id="rsToken" placeholder="github_pat_…" autocomplete="off"></label>`}
    <fieldset style="text-align:left"><legend>Welcher Stand?</legend>
      ${hasCache ? `<label class="check-row"><input type="radio" name="rsSrc" value="cache" checked> <span><b>Stand auf diesem Gerät</b><small>zuletzt geladen: ${cachedMain.stand ? new Date(cachedMain.stand).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : 'unbekannt'}${cachedSch?.eintraege ? ` · ${cachedSch.eintraege.length} Reh-/Dammwild-Einträge` : ''}</small></span></label>` : ''}
      <label class="check-row"><input type="radio" name="rsSrc" value="file" ${hasCache ? '' : 'checked'}> <span><b>Sicherungsdatei einspielen</b><small>aus „Sicherung speichern“</small></span></label>
      <input type="file" id="rsFile" accept="application/json,.json">
    </fieldset>
    <label class="field" style="text-align:left"><span>Neues Passwort (mind. 6 Zeichen)</span><input type="text" id="rsPw" autocomplete="off" autocapitalize="off" autocorrect="off"></label>
    <label class="field" style="text-align:left"><span>Neues Passwort wiederholen</span><input type="text" id="rsPw2" autocomplete="off" autocapitalize="off" autocorrect="off"></label>
    <p id="rsMsg" class="err"></p>
    <button type="button" class="btn block" id="rsGo">Wiederherstellen & neu verschlüsseln</button>
    <button type="button" class="btn ghost block" id="rsBack">Zurück</button>`;
  $('#rsBack').addEventListener('click', () => { box.hidden = true; $('#lockForm').hidden = false; });
  $('#rsGo').addEventListener('click', async () => {
    const msg = t => { $('#rsMsg').textContent = t; };
    const pw = $('#rsPw').value.trim();
    if (pw.length < 6) return msg('Das Passwort muss mindestens 6 Zeichen haben.');
    if (pw !== $('#rsPw2').value.trim()) return msg('Die beiden Passwörter stimmen nicht überein.');
    if (!isAdmin()) {
      const t = $('#rsToken')?.value.trim();
      if (!t) return msg('Bitte deinen GitHub-Token eintragen.');
      Object.assign(state.cfg, { token: t, mode: 'voll' }); lsSet(LS_CFG, state.cfg);
    }
    let src;
    try {
      const mode = $('input[name=rsSrc]:checked')?.value;
      if (mode === 'cache') src = { main: normalize(clone(cachedMain)), schalen: cachedSch ? normalizeSchalen(clone(cachedSch)) : null };
      else {
        const f = $('#rsFile').files[0];
        if (!f) return msg('Bitte eine Sicherungsdatei auswählen.');
        src = parseBackup(JSON.parse(await f.text()));
      }
    } catch (err) { return msg(err.message); }
    $('#rsGo').disabled = true; msg('');
    try {
      state.pw = pw; state.pwOld = ''; lsSet(LS_PW, pw);
      state.pending = false; lsSet(LS_PENDING, undefined);
      await restoreData(src, 'Wiederherstellung mit neuem Passwort');
      if (state.pending || state.schalenOps.length) throw new Error('Speichern auf GitHub fehlgeschlagen – Token prüfen.');
      box.hidden = true; $('#lockForm').hidden = false; $('#lock').hidden = true;
      toast('Wiederhergestellt ✓ – neues Passwort ist aktiv.', 4500);
    } catch (err) { msg(err.message); }
    finally { $('#rsGo').disabled = false; }
  });
}

/* ================= Teilen / Download ================= */
async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } // nur die Datei teilen – ein Titel/Text erzeugt auf dem iPhone eine zusätzliche „Text.txt“
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ================= PDF-Export ================= */
let pdfLibs = null;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('PDF-Modul nicht geladen')); document.head.appendChild(s); });
}
async function getPdf() {
  if (!pdfLibs) pdfLibs = (async () => {
    await loadScript('vendor/jspdf.umd.min.js');
    await loadScript('vendor/jspdf.plugin.autotable.min.js');
  })();
  await pdfLibs;
  return window.jspdf.jsPDF;
}
let logoData = null;
async function getLogo() {
  if (logoData) return logoData;
  const r = await fetch('icons/icon-192.png'); const b = await r.blob();
  logoData = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
  return logoData;
}

const PDF = { green: [31, 74, 36], ink: [34, 48, 29], muted: [102, 105, 79], soft: [207, 216, 184], paper: [242, 240, 223], brass: [155, 122, 50] };

async function pdfBase(title, season) {
  const jsPDF = await getPdf();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const logo = await getLogo().catch(() => null);
  if (logo) doc.addImage(logo, 'PNG', 14, 10, 22, 22);
  doc.setTextColor(...PDF.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('JAGDGEMEINSCHAFT THUINE', 40, 16);
  doc.setTextColor(...PDF.green); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.text(title, 40, 24);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...PDF.ink);
  doc.text(`Jagdjahr ${season}  ·  erstellt am ${dateDE(todayISO())}`, 40, 30);
  doc.setDrawColor(...PDF.soft); doc.setLineWidth(0.6); doc.line(14, 36, 196, 36);
  return doc;
}
function pdfFooter(doc) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...PDF.muted);
    doc.text(`Streckenbericht · Jagdgemeinschaft Thuine`, 14, 290);
    doc.text(`Seite ${i} von ${n}`, 196, 290, { align: 'right' });
  }
}
const tableStyle = {
  theme: 'grid',
  styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 1.8, lineColor: [201, 203, 171], lineWidth: 0.2, textColor: PDF.ink },
  headStyles: { fillColor: PDF.green, textColor: [244, 241, 222], fontStyle: 'bold' },
  footStyles: { fillColor: PDF.soft, textColor: PDF.ink, fontStyle: 'bold' },
  alternateRowStyles: { fillColor: [247, 246, 236] },
  margin: { left: 14, right: 14 },
};
function sectionTitle(doc, text, y) {
  if (y > 265) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(...PDF.green);
  doc.text(text, 14, y);
  return y + 3;
}
const numRight = (from = 1, to = 99) => d => { if (d.section !== 'body' && d.column.index >= from && d.column.index <= to) d.cell.styles.halign = 'right'; };
const safeSeason = s => s.replace('/', '-');

async function exportStrecke(season) {
  try {
    toast('PDF wird erstellt …');
    const st = seasonStats(season);
    const doc = await pdfBase('Streckenbericht', season);
    const cols = species().filter(w => st.perSpecies[w.id]);
    let y = sectionTitle(doc, 'Gesamtstrecke', 45);
    const hundTotal = sumCounts(st.perSpeciesHund);
    const hasNt = st.totalNachtrag > 0;
    doc.autoTable({ ...tableStyle, startY: y,
      head: [['Wildart', ...(hasNt ? ['Jagdtage', 'Nachträge'] : []), 'Stück', ...(hundTotal ? ['davon Hund'] : [])]],
      body: species().map(w => [w.name, ...(hasNt ? [String(st.perSpeciesTage[w.id] || 0), String(st.perNachtrag[w.id] || 0)] : []), String(st.perSpecies[w.id] || 0), ...(hundTotal ? [String(st.perSpeciesHund[w.id] || '')] : [])]),
      foot: [['Gesamt', ...(hasNt ? [String(st.totalTage), String(st.totalNachtrag)] : []), String(st.total), ...(hundTotal ? [String(hundTotal)] : [])]],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      tableWidth: hasNt ? 140 : 100, didParseCell: numRight(1),
    });
    y = doc.lastAutoTable.finalY + 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...PDF.muted);
    doc.text(`${st.days.length} Jagdtage${st.days.length ? `: ${st.days.map(d => dateDE(d.datum)).join(', ')}` : ''}`, 14, y, { maxWidth: 182 });
    y += 12;
    y = sectionTitle(doc, 'Strecke je Jagdtag', y);
    doc.autoTable({ ...tableStyle, startY: y,
      head: [['Jagdtag', ...cols.map(w => w.name), 'Gesamt']],
      body: st.days.map(d => { const ds = dayStats(d); return [dateDE(d.datum) + (isVenslage(d) ? '\nmit Venslage*' : isTreibjagd(d) ? '\nGr. Treibjagd**' : ''), ...cols.map(w => ds.perSpecies[w.id] ? String(ds.perSpecies[w.id]) + (ds.perSpeciesHund[w.id] ? ` (${ds.perSpeciesHund[w.id]} H)` : '') : '–'), String(ds.total)]; }),
      foot: [
        ...(hasNt ? [['Nachträge', ...cols.map(w => String(st.perNachtrag[w.id] || '–')), String(st.totalNachtrag)]] : []),
        ['Gesamt', ...cols.map(w => String(st.perSpecies[w.id] || 0)), String(st.total)]],
      columnStyles: Object.fromEntries([...cols.map((_, i) => [i + 1, { halign: 'right' }]), [cols.length + 1, { halign: 'right', fontStyle: 'bold' }]]),
      didParseCell: numRight(1),
    });
    y = doc.lastAutoTable.finalY + 10;
    if (hasNt) {
      y = sectionTitle(doc, 'Nachträge (außerhalb der Jagdtage)', y);
      doc.autoTable({ ...tableStyle, startY: y,
        head: [['Datum', 'Wildart', 'Anzahl', 'Erlegt von / Bemerkung']],
        body: st.nachtraege.map(n => [dateDE(n.datum), speciesName(n.art), String(n.anzahl), n.text || '–']),
        columnStyles: { 0: { cellWidth: 26 }, 2: { halign: 'right', cellWidth: 18 } }, didParseCell: numRight(2, 2),
      });
      y = doc.lastAutoTable.finalY + 10;
    }
    const notes = [];
    if (hundTotal) notes.push('H = vom Hund gegriffen (zählt zur Strecke, ohne Punkte).');
    if (st.days.some(isVenslage)) notes.push('* Jagd mit Venslage: In der Strecke steht nur das im Revier Thuine erlegte Wild.');
    if (st.days.some(isTreibjagd)) notes.push('** Große Treibjagd: Die Strecke enthält auch das Wild der Gäste.');
    if (notes.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...PDF.muted); doc.text(notes.join('  '), 14, doc.lastAutoTable.finalY + 6, { maxWidth: 182 }); }
    pdfFooter(doc);
    await shareOrDownload(doc.output('blob'), `Streckenbericht_${safeSeason(season)}.pdf`);
  } catch (e) { toast('Export fehlgeschlagen: ' + e.message, 4500); }
}

async function exportKoenig(season) {
  try {
    toast('PDF wird erstellt …');
    const st = seasonStats(season);
    const doc = await pdfBase('Jagdkönig', season);
    let y = 45;
    const top = st.ranking.filter(r => r.rank === 1);
    if (top.length) {
      doc.setFillColor(244, 236, 208); doc.setDrawColor(216, 196, 143);
      doc.roundedRect(14, y - 5, 182, 16, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...PDF.brass);
      doc.text(`Jagdkönig ${season}: ${top.map(r => shooterName(r.id)).join(', ')}  –  ${fmt(top[0].punkte)} Punkte`, 20, y + 4.5);
      y += 20;
    }
    y = sectionTitle(doc, 'Rangliste', y);
    const cols = species().filter(w => st.ranking.some(r => r.erlegt[w.id] || r.hund[w.id]));
    doc.autoTable({ ...tableStyle, startY: y,
      head: [['Platz', 'Schütze', ...cols.map(w => w.name), 'Stück', 'Punkte', 'Tageskönig']],
      body: st.ranking.map(r => [`${r.rank}.`, shooterName(r.id), ...cols.map(w => { const e = r.erlegt[w.id] || 0, h = r.hund[w.id] || 0; return e + h ? `${e + h}${h ? ` (${h} H)` : ''}` : '–'; }), String(r.stueck), fmt(r.punkte), r.siege ? `${r.siege}×` : '–']),
      columnStyles: Object.fromEntries([[0, { halign: 'right', cellWidth: 12 }], ...cols.map((_, i) => [i + 2, { halign: 'right' }]), [cols.length + 2, { halign: 'right' }], [cols.length + 3, { halign: 'right', fontStyle: 'bold' }], [cols.length + 4, { halign: 'center' }]]),
      didParseCell: numRight(2, cols.length + 3),
    });
    y = doc.lastAutoTable.finalY + 10;
    y = sectionTitle(doc, 'Einzelnachweis je Schütze', y);
    const pm = ptsMap();
    const body = [];
    for (const r of st.ranking) {
      body.push([{ content: `${r.rank}. ${shooterName(r.id)}  –  ${fmt(r.punkte)} Punkte, ${r.stueck} Stück`, colSpan: 3, styles: { fillColor: PDF.soft, fontStyle: 'bold' } }]);
      for (const t of r.tage) {
        const parts = species().filter(w => t.erlegt[w.id] || t.hund[w.id]).map(w => {
          const e = t.erlegt[w.id] || 0, h = t.hund[w.id] || 0;
          return [e ? `${e}× ${w.name} (${fmt(e * pm[w.id])} P.)` : '', h ? `${h}× ${w.name} vom Hund (0 P.)` : ''].filter(Boolean).join(', ');
        });
        body.push([dateDE(t.datum) + (t.art === 'venslage' ? '\nmit Venslage' : t.art === 'treibjagd' ? '\nGr. Treibjagd' : ''), parts.join(', '), fmt(t.punkte)]);
      }
    }
    doc.autoTable({ ...tableStyle, startY: y, head: [['Jagdtag', 'Erlegt', 'Punkte']], body, didParseCell: numRight(2, 2),
      alternateRowStyles: {}, columnStyles: { 0: { cellWidth: 26 }, 2: { halign: 'right', cellWidth: 20 } } });
    y = doc.lastAutoTable.finalY + 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...PDF.muted);
    if (y > 280) { doc.addPage(); y = 20; }
    doc.text(`Punkte: ${species().map(w => `${w.name} ${fmt(w.punkte)}`).join(', ')}. H = vom Hund gegriffen (zählt zur Strecke, ohne Punkte). Gleiche Punktzahl = gleicher Platz. Gewertet wird nur die Stammmannschaft, Gäste und Venslager Jäger zählen nicht mit.`, 14, y, { maxWidth: 182 });
    pdfFooter(doc);
    await shareOrDownload(doc.output('blob'), `Jagdkoenig_${safeSeason(season)}.pdf`);
  } catch (e) { toast('Export fehlgeschlagen: ' + e.message, 4500); }
}

async function exportSchalen(season) {
  try {
    toast('PDF wird erstellt …');
    const st = schalenStats(season);
    const doc = await pdfBase('Reh- & Dammwild', season);
    let y = 45;
    for (const art of ['reh', 'damm']) {
      y = sectionTitle(doc, SCHALEN[art].name, y);
      const t = st.tot(art);
      doc.autoTable({ ...tableStyle, startY: y, tableWidth: 120,
        head: [['Kategorie', 'Erlegt', 'Fallwild', 'Gesamt']],
        body: SCHALEN[art].kat.map(([k, l]) => { const c = st.cnt[art]?.[k] || { erlegt: 0, fallwild: 0 }; return [l, String(c.erlegt), String(c.fallwild), String(c.erlegt + c.fallwild)]; }),
        foot: [['Gesamt', String(t.erlegt), String(t.fallwild), String(t.erlegt + t.fallwild)]],
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right', fontStyle: 'bold' } }, didParseCell: numRight(1),
      });
      y = doc.lastAutoTable.finalY + 10;
    }
    y = sectionTitle(doc, 'Erlegt', y);
    doc.autoTable({ ...tableStyle, startY: y,
      head: [['Datum', 'Wildart', 'Kategorie', 'Schütze', 'Bemerkung']],
      body: st.erlegt.length ? st.erlegt.map(x => [dateDE(x.datum), SCHALEN[x.art].name, katName(x.art, x.kat), shooterName(x.schuetze), x.bemerkung || '–']) : [[{ content: 'Keine Erlegungen', colSpan: 5 }]],
      columnStyles: { 0: { cellWidth: 24 } },
    });
    y = doc.lastAutoTable.finalY + 10;
    y = sectionTitle(doc, 'Fallwild', y);
    doc.autoTable({ ...tableStyle, startY: y,
      head: [['Datum', 'Wildart', 'Kategorie', 'Ursache', 'Bemerkung']],
      body: st.fallwild.length ? st.fallwild.map(x => [dateDE(x.datum), SCHALEN[x.art].name, katName(x.art, x.kat), x.ursache || '–', x.bemerkung || '–']) : [[{ content: 'Kein Fallwild', colSpan: 5 }]],
      columnStyles: { 0: { cellWidth: 24 } },
    });
    const sh = Object.entries(st.perShooter);
    if (sh.length) {
      y = doc.lastAutoTable.finalY + 10;
      y = sectionTitle(doc, 'Je Schütze', y);
      doc.autoTable({ ...tableStyle, startY: y,
        head: [['Schütze', 'Rehwild', 'Dammwild', 'Erlegt']],
        body: sh.sort((a, b) => (b[1].reh + b[1].damm) - (a[1].reh + a[1].damm)).map(([id, p]) => [shooterName(id), String(p.reh), String(p.damm), p.list.map(x => `${katName(x.art, x.kat)} (${dateDE(x.datum)})`).join(', ')]),
        columnStyles: { 1: { halign: 'right', cellWidth: 20 }, 2: { halign: 'right', cellWidth: 22 } }, didParseCell: numRight(1, 2),
      });
    }
    pdfFooter(doc);
    await shareOrDownload(doc.output('blob'), `Reh-Dammwild_${safeSeason(season)}.pdf`);
  } catch (e) { toast('Export fehlgeschlagen: ' + e.message, 4500); }
}

async function exportGesamt(season) {
  try {
    toast('PDF wird erstellt …');
    const st = seasonStats(season);
    const sw = schalenStats(season);
    const doc = await pdfBase('Gesamtstreckenbericht', season);
    // Niederwild
    let y = sectionTitle(doc, 'Niederwild', 45);
    const rows = species().filter(w => st.perSpecies[w.id]).map(w => [w.name, String(st.perSpecies[w.id])]);
    doc.autoTable({ ...tableStyle, startY: y, tableWidth: 100,
      head: [['Wildart', 'Stück']],
      body: rows.length ? rows : [[{ content: 'Keine Strecke', colSpan: 2 }]],
      foot: [['Gesamt Niederwild', String(st.total)]],
      columnStyles: { 1: { halign: 'right' } }, didParseCell: numRight(1),
    });
    y = doc.lastAutoTable.finalY + 12;
    // Schalenwild
    y = sectionTitle(doc, 'Schalenwild', y);
    const body = [];
    for (const art of ['reh', 'damm']) {
      const t = sw.tot(art);
      body.push([{ content: SCHALEN[art].name, colSpan: 4, styles: { fillColor: PDF.soft, fontStyle: 'bold' } }]);
      const cats = SCHALEN[art].kat.filter(([k]) => { const c = sw.cnt[art]?.[k]; return c && (c.erlegt || c.fallwild); });
      if (!cats.length) body.push([{ content: 'Keine Strecke', colSpan: 4 }]);
      cats.forEach(([k, l]) => { const c = sw.cnt[art][k]; body.push([l, String(c.erlegt), String(c.fallwild), String(c.erlegt + c.fallwild)]); });
      body.push([{ content: `Summe ${SCHALEN[art].name}`, styles: { fontStyle: 'bold' } }, String(t.erlegt), String(t.fallwild), { content: String(t.erlegt + t.fallwild), styles: { fontStyle: 'bold' } }]);
    }
    const tr = sw.tot('reh'), td = sw.tot('damm');
    doc.autoTable({ ...tableStyle, startY: y, tableWidth: 140, alternateRowStyles: {},
      head: [['Kategorie', 'Erlegt', 'Fallwild', 'Gesamt']],
      body,
      foot: [['Gesamt Schalenwild', String(tr.erlegt + td.erlegt), String(tr.fallwild + td.fallwild), String(tr.erlegt + tr.fallwild + td.erlegt + td.fallwild)]],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } }, didParseCell: numRight(1),
    });
    y = doc.lastAutoTable.finalY + 8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...PDF.muted);
    doc.text('Niederwild inkl. Nachträge außerhalb der Jagdtage. Bei der Jagd mit Venslage zählt nur das im Revier Thuine erlegte Wild.', 14, y, { maxWidth: 182 });
    pdfFooter(doc);
    await shareOrDownload(doc.output('blob'), `Gesamtstrecke_${safeSeason(season)}.pdf`);
  } catch (e) { toast('Export fehlgeschlagen: ' + e.message, 4500); }
}

/* ================= Navigation ================= */
/** Bereiche: Start → Niederwild (Strecke, Jagdtage, Jagdkönig) oder Schalenwild (Reh & Damm) */
const sectionOf = tab => tab === 'start' ? 'start' : tab === 'schalen' ? 'schalen' : tab === 'berichte' ? 'berichte' : 'nieder';
function switchTab(tab, fromPop = false) {
  const sec = sectionOf(tab);
  if (!fromPop) {
    if (sec !== 'start' && histLvl() < 1) history.pushState({ sb: 1 }, '');
    else if (sec === 'start' && histLvl() === 1 && !(history.state && history.state.sheet)) histBack();
  }
  state.tab = tab;
  $('.tabbar').hidden = sec === 'start';
  $$('.tab').forEach(t => { t.classList.toggle('active', t.dataset.tab === tab); t.hidden = !!t.dataset.sec && t.dataset.sec !== sec; });
  $$('.view').forEach(v => (v.hidden = v.dataset.view !== tab));
  document.body.classList.toggle('on-start', sec === 'start');
  if (tab === 'start') renderStart();
  if (tab === 'berichte') renderBerichte();
  window.scrollTo({ top: 0 });
}

/* ================= Seite Streckenberichte (alle PDF-Downloads) ================= */
function renderBerichte() {
  const el = $('#view-berichte');
  if (!el || !state.data) return;
  const aktuell = seasonOf(todayISO());
  const reports = [
    ['gesamt', 'Gesamtstreckenbericht', 'Niederwild und Schalenwild – nur die Gesamtstrecke'],
    ['strecke', 'Streckenbericht Niederwild', 'Gesamtstrecke und alle Jagdtage'],
    ['schalen', 'Streckenbericht Reh- & Dammwild', 'Erlegungen und Fallwild'],
    ['koenig', 'Jagdkönig', 'Rangliste mit Wild je Schütze'],
  ];
  el.innerHTML = `
    <h2 class="section" style="margin-top:4px">Streckenberichte</h2>
    <p class="sub" style="margin-top:-4px">Antippen, um den Bericht als PDF zu speichern oder zu teilen.</p>
    ${allSeasons().map(season => {
      const list = reports.filter(([k]) => k !== 'koenig' || season !== aktuell || isAdmin());
      return `<div class="card rep-card">
        <div class="rep-season">Jagdjahr ${esc(season)}${season === aktuell ? ' <small>laufend</small>' : ''}</div>
        ${list.map(([k, t, d]) => `<button class="rep-row" data-rep="${k}" data-season="${esc(season)}">
          <span class="rep-ico" aria-hidden="true">⤓</span>
          <span class="rep-txt"><b>${esc(t)}${k === 'koenig' && season === aktuell ? ' <small>(nur für dich)</small>' : ''}</b><small>${esc(d)}</small></span>
        </button>`).join('')}
      </div>`;
    }).join('')}`;
  const fns = { gesamt: exportGesamt, strecke: exportStrecke, schalen: exportSchalen, koenig: exportKoenig };
  $$('[data-rep]', el).forEach(b => b.addEventListener('click', () => fns[b.dataset.rep](b.dataset.season)));
}

function renderStart() {
  const el = $('#view-start');
  if (!el || !state.data) return;
  const st = seasonStats(state.season);
  const sw = schalenStats(state.season);
  const reh = sw.tot('reh'), damm = sw.tot('damm');
  el.innerHTML = `
    <div class="start-hero">
      <img src="icons/logo.png" alt="Jagdgemeinschaft Thuine">
      <p class="sub">Jagdjahr ${esc(state.season)}</p>
    </div>
    <button class="start-tile" data-go="strecke">
      <span class="st-title">Niederwild</span>
      <span class="st-meta">${st.total} Stück Strecke · ${st.days.length} Jagdtage</span>
      <span class="st-go" aria-hidden="true">›</span>
    </button>
    <button class="start-tile" data-go="schalen">
      <span class="st-title">Schalenwild</span>
      <span class="st-meta">Rehwild ${reh.erlegt + reh.fallwild} · Dammwild ${damm.erlegt + damm.fallwild}${sw.fallwild.length ? ` · davon ${sw.fallwild.length} Fallwild` : ''}</span>
      <span class="st-go" aria-hidden="true">›</span>
    </button>
    ${isAdmin() && state.meldungen.length ? `<button class="start-tile ml-tile" id="btnMeldungen"><span class="st-title">📬 ${state.meldungen.length} neue Meldung${state.meldungen.length === 1 ? '' : 'en'}</span><span class="st-meta">antippen zum Prüfen und Übernehmen</span><span class="st-go" aria-hidden="true">›</span></button>` : ''}
    ${canMelden() ? `<button class="start-tile" id="btnMelden">
      <span class="st-title">Wild melden</span>
      <span class="st-meta">Erlegtes Stück oder Fallwild an Sebastian schicken</span>
      <span class="st-go" aria-hidden="true">›</span>
    </button>` : ''}
    <button class="start-tile" data-go="berichte">
      <span class="st-title">Streckenberichte</span>
      <span class="st-meta">PDF-Berichte aller Jagdjahre zum Herunterladen</span>
      <span class="st-go" aria-hidden="true">›</span>
    </button>`;
  $('#btnMelden')?.addEventListener('click', openMelden);
  $('#btnMeldungen')?.addEventListener('click', openMeldungen);
  $$('[data-go]', el).forEach(b => b.addEventListener('click', () => switchTab(b.dataset.go)));
}
$$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
$('#seasonSelect').addEventListener('change', e => { state.season = e.target.value; renderTage(); renderStrecke(); renderKoenig(); renderSchalen(); renderStart(); });
$('#settingsBtn').addEventListener('click', openSettings);
ensureLockDom();
$('#lockForm')?.addEventListener('submit', unlock);
$('#forgotPw')?.addEventListener('click', openReset);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !$('#sheet').hidden) return;
  if (!state.pending) load();
  loadSchalen(); loadMeldungen();
});

/* ================= Service Worker (Update-Hinweis) ================= */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  let reloaded = false;
  const reloadOnce = () => { if (!reloaded) { reloaded = true; location.reload(); } };
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    const offer = w => {
      showBanner(`<span>Neue Version verfügbar.</span><button class="btn" id="swReload">Neu laden</button>`, 'info');
      $('#swReload').addEventListener('click', () => {
        showBanner('<span>Neue Version wird geladen …</span>', 'info');
        // iPhone-Web-Apps melden den Wechsel nicht immer zuverlässig → mehrere Wege zum Neuladen
        w.addEventListener('statechange', () => { if (w.state === 'activated') reloadOnce(); });
        w.postMessage('skipWaiting');
        setTimeout(reloadOnce, 1500);
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
}

try { history.replaceState({ sb: 0 }, ''); } catch { /* egal */ }
load().then(() => { loadSchalen(); loadMeldungen(); });
switchTab('start');
