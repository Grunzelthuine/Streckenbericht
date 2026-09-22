/* Streckenbericht · Jagdgemeinschaft Thuine
 * Daten liegen als data/strecke.json im GitHub-Repo.
 * Lesen: öffentlich (GitHub-API bzw. Pages-Datei). Schreiben: nur mit GitHub-Token (Einstellungen).
 * Foto-Auswertung: Anthropic-API mit eigenem Schlüssel (nur auf dem Gerät gespeichert).
 */
'use strict';

const APP_VERSION = '1.1.0';
const LS_DATA = 'sb.data.v1';
const LS_PENDING = 'sb.pending.v1';
const LS_CFG = 'sb.cfg.v1';
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
const b64decodeUtf8 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

/* ================= Zustand ================= */
const state = {
  data: null,
  season: null,
  tab: 'tage',
  sha: null,
  pending: !!lsGet(LS_PENDING, false),
  cfg: Object.assign(defaultCfg(), lsGet(LS_CFG, {})),
};

function defaultCfg() {
  let owner = '', repo = '';
  if (location.hostname.endsWith('.github.io')) {
    owner = location.hostname.split('.')[0];
    repo = location.pathname.split('/').filter(Boolean)[0] || `${owner}.github.io`;
  }
  return { owner, repo, branch: 'main', path: 'data/strecke.json', token: '', apiKey: '', model: '' };
}
const isAdmin = () => !!(state.cfg.token && state.cfg.owner && state.cfg.repo);

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

/** Auswertung eines Jagdtages */
function dayStats(day) {
  const pm = ptsMap();
  const ids = new Set([...Object.keys(day.strecke || {}), ...Object.keys(day.hund || {})]);
  const rows = [...ids].map(id => {
    const erlegt = day.strecke?.[id] || {};
    const hund = day.hund?.[id] || {};
    return { id, erlegt, hund, punkte: pointsOf(erlegt, pm), stueck: sumCounts(erlegt) + sumCounts(hund) };
  }).filter(r => r.stueck > 0);
  const perSpecies = {}; const perSpeciesHund = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.erlegt)) perSpecies[k] = (perSpecies[k] || 0) + v;
    for (const [k, v] of Object.entries(r.hund)) { perSpecies[k] = (perSpecies[k] || 0) + v; perSpeciesHund[k] = (perSpeciesHund[k] || 0) + v; }
  }
  const values = [...new Set(rows.map(r => r.punkte).filter(p => p > 0))].sort((a, b) => b - a);
  const koenig = values[0] != null ? rows.filter(r => r.punkte === values[0]).map(r => r.id) : [];
  const vize = values[1] != null ? rows.filter(r => r.punkte === values[1]).map(r => r.id) : [];
  rows.sort((a, b) => b.punkte - a.punkte || b.stueck - a.stueck || shooterName(a.id).localeCompare(shooterName(b.id), 'de'));
  return { rows, perSpecies, perSpeciesHund, total: sumCounts(perSpecies), koenig, koenigPts: values[0] || 0, vize, vizePts: values[1] || 0 };
}

function seasonDays(season) {
  return state.data.jagdtage.filter(d => seasonOf(d.datum) === season).sort((a, b) => a.datum.localeCompare(b.datum));
}
function allSeasons() {
  const s = new Set(state.data.jagdtage.map(d => seasonOf(d.datum)));
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
    for (const r of ds.rows) {
      const p = get(r.id);
      p.punkte += r.punkte; p.stueck += r.stueck;
      for (const [k, v] of Object.entries(r.erlegt)) { p.erlegt[k] = (p.erlegt[k] || 0) + v; perSpecies[k] = (perSpecies[k] || 0) + v; }
      for (const [k, v] of Object.entries(r.hund)) { p.hund[k] = (p.hund[k] || 0) + v; perSpecies[k] = (perSpecies[k] || 0) + v; perSpeciesHund[k] = (perSpeciesHund[k] || 0) + v; }
      p.tage.push({ datum: d.datum, erlegt: r.erlegt, hund: r.hund, punkte: r.punkte });
    }
    ds.koenig.forEach(id => get(id).siege++);
    ds.vize.forEach(id => get(id).vize++);
    const sk = (d.sonderkoenig || '').trim();
    if (sk) { const s = findShooter(sk); if (s) get(s.id).sonder++; }
  }
  const ranking = Object.values(per).sort((a, b) =>
    b.punkte - a.punkte || b.stueck - a.stueck || shooterName(a.id).localeCompare(shooterName(b.id), 'de'));
  // Platzierung mit Gleichstand (gleiche Punkte = gleicher Platz)
  let lastPts = null, lastRank = 0;
  ranking.forEach((r, i) => { r.rank = r.punkte === lastPts ? lastRank : i + 1; lastPts = r.punkte; lastRank = r.rank; });
  void pm;
  return { days, ranking, perSpecies, perSpeciesHund, total: sumCounts(perSpecies) };
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

async function load() {
  const cached = lsGet(LS_DATA, null);
  if (cached) { state.data = normalize(cached); render(); }
  if (state.pending && cached) { showPendingBanner(); return; }
  try {
    const remote = normalize(await fetchRemote());
    state.data = remote; lsSet(LS_DATA, remote);
    render();
  } catch (e) {
    if (!cached) {
      $('#view-tage').innerHTML = `<div class="card pad empty"><img src="icons/logo.png" alt=""><p>Keine Daten erreichbar. Bitte Internetverbindung prüfen.</p></div>`;
    } else toast('Offline – zeige zuletzt geladenen Stand.');
  }
}

function normalize(d) {
  d.wildarten ||= []; d.schuetzen ||= []; d.jagdtage ||= [];
  d.jagdtage.forEach(t => { t.strecke ||= {}; t.hund ||= {}; t.sonderkoenig ||= ''; t.bemerkung ||= ''; t.id ||= t.datum; });
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
      const body = { message, content: b64encodeUtf8(JSON.stringify(state.data, null, 2) + '\n'), branch: state.cfg.branch || 'main' };
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
  if (!state.season || !seasons.includes(state.season)) {
    const latest = [...state.data.jagdtage].sort((a, b) => b.datum.localeCompare(a.datum))[0];
    state.season = latest ? seasonOf(latest.datum) : seasons[0];
  }
  const sel = $('#seasonSelect');
  sel.innerHTML = seasons.map(s => `<option value="${s}" ${s === state.season ? 'selected' : ''}>${s}</option>`).join('');
  renderTage(); renderStrecke(); renderKoenig();
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
      <div class="card stat leader"><div class="v">${leader ? `<span class="crown">♛</span> ${names(leaders.map(l => l.id))}` : '–'}</div><div class="l">${leader ? `führt mit ${fmt(leader.punkte)} Pkt.` : 'Jagdkönig'}</div></div>
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
        <div class="day-top"><span class="day-date">${dateDE(d.datum, true)}</span><span class="day-total">${ds.total} Stück</span></div>
        <div class="chips">${chipsFor(ds.perSpecies, ds.perSpeciesHund) || '<span class="sub">keine Strecke</span>'}</div>
        <div class="kings">
          ${ds.koenig.length ? `<div><span class="k"><span class="crown">♛</span> Jagdkönig</span> ${names(ds.koenig)} · ${fmt(ds.koenigPts)} Pkt.</div>` : ''}
          ${ds.vize.length ? `<div><span class="k">Vizekönig</span> ${names(ds.vize)} · ${fmt(ds.vizePts)} Pkt.</div>` : ''}
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
      <div><div class="big">${st.total}</div><div class="lbl">Stück Gesamtstrecke · Jagdjahr ${esc(state.season)}<br>${st.days.length} Jagdtage${hundTotal ? ` · davon ${hundTotal} vom Hund gegriffen` : ''}</div></div>
    </div>
    <div class="species-grid">
      ${species().map(w => {
        const n = st.perSpecies[w.id] || 0;
        return `<div class="card sp ${n ? '' : 'zero'}"><div class="n">${n}</div><div class="t">${esc(w.name)}</div><div class="p">${fmt(w.punkte)} Pkt.</div></div>`;
      }).join('')}
    </div>
    <div class="btn-row"><button class="btn secondary" id="expStrecke">⤓ Streckenbericht als PDF</button></div>`;

  // Vergleich über alle Jagdjahre
  const seasons = allSeasons().filter(s => seasonDays(s).length);
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
  $('#expStrecke').addEventListener('click', () => exportStrecke(state.season));
}

function renderKoenig() {
  const el = $('#view-koenig');
  const st = seasonStats(state.season);
  const rk = st.ranking;
  if (!rk.length) {
    el.innerHTML = `<div class="card pad empty"><img src="icons/logo.png" alt=""><p>Noch keine Punkte im Jagdjahr ${esc(state.season)}.</p></div>`;
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
  let html = `
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
    <p class="hint" style="text-align:center">Punkte: ${species().map(w => `${esc(w.name)} ${fmt(w.punkte)}`).join(' · ')}. Vom Hund gegriffenes Wild zählt zur Strecke, bringt aber keine Punkte.</p>
    <div class="btn-row"><button class="btn secondary" id="expKoenig">⤓ Jagdkönig-Übersicht als PDF</button></div>`;
  el.innerHTML = html;
  $('#expKoenig').addEventListener('click', () => exportKoenig(state.season));
}

/* ================= Sheet ================= */
function openSheet(title, body, foot = '') {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = body;
  $('#sheetFoot').innerHTML = foot;
  $('#sheet').hidden = false;
  $('#sheetBody').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#sheet').hidden = true; document.body.style.overflow = '';
  editor = null;
}
document.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });

/* ================= Jagdtag-Detail ================= */
function openDay(id) {
  const d = state.data.jagdtage.find(x => x.id === id);
  if (!d) return;
  const ds = dayStats(d);
  const cols = species().filter(w => ds.perSpecies[w.id]);
  const body = `
    <div class="chips">${chipsFor(ds.perSpecies, ds.perSpeciesHund)}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Schütze</th>${cols.map(w => `<th>${esc(w.name)}</th>`).join('')}<th class="pts">Punkte</th></tr></thead>
      <tbody>${ds.rows.map(r => `<tr><td>${esc(shooterName(r.id))}</td>${cols.map(w => {
        const e = r.erlegt[w.id] || 0, h = r.hund[w.id] || 0;
        return `<td class="${e + h ? '' : 'zero'}">${e + h}${h ? `<span class="dogmark">H</span>` : ''}</td>`;
      }).join('')}<td class="pts">${fmt(r.punkte)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Gesamtstrecke</td>${cols.map(w => `<td>${ds.perSpecies[w.id]}</td>`).join('')}<td>${ds.total} St.</td></tr></tfoot>
    </table></div>
    ${Object.keys(ds.perSpeciesHund).length ? '<p class="hint"><span class="dogmark">H</span> = davon vom Hund gegriffen (zählt zur Strecke, ohne Punkte)</p>' : ''}
    <div class="card pad kings" style="margin-top:12px">
      <div><span class="k"><span class="crown">♛</span> Jagdkönig</span> ${ds.koenig.length ? `${names(ds.koenig)} · ${fmt(ds.koenigPts)} Pkt.` : '–'}</div>
      <div><span class="k">Vizekönig</span> ${ds.vize.length ? `${names(ds.vize)} · ${fmt(ds.vizePts)} Pkt.` : '–'}</div>
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
  const base = existing ? clone(existing) : { id: null, datum: todayISO(), strecke: {}, hund: {}, sonderkoenig: '', bemerkung: '' };
  editor = {
    originalId: existing?.id || null,
    day: base,
    flags: {},          // id → Hinweistext
    hinweise: [],
    unassigned: [],     // von KI gelesen, keinem Schützen zugeordnet
    open: new Set(),
    showDog: new Set(Object.keys(base.hund || {})),
    photo: null,
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
  const totals = {};
  for (const src of [d.strecke, d.hund]) for (const c of Object.values(src)) for (const [k, v] of Object.entries(c)) totals[k] = (totals[k] || 0) + v;

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
    <div class="ed-totals"><span>Strecke:</span>${species().filter(w => totals[w.id]).map(w => `<span><b>${totals[w.id]}</b> ${esc(w.name)}</span>`).join('') || '<span class="sub">noch leer</span>'}<span style="margin-left:auto"><b>${sumCounts(totals)}</b> Stück</span></div>
    ${editor.photo ? `<details class="card pad"><summary>Foto der Erlegerliste anzeigen</summary><img class="photo-preview" src="${editor.photo}" alt="Foto der Erlegerliste" style="margin-top:10px;max-height:70vh"></details>` : ''}
    ${alerts.join('')}
    <label class="field"><span>Jagdtag</span><input type="date" id="edDate" value="${esc(d.datum)}"></label>
    ${unassigned}
    <div class="hint">Schützen antippen, um Wild einzutragen. Die Punkte werden automatisch berechnet.</div>
    <div>${rows}</div>
    <button class="btn secondary block" id="edAddShooter">+ Gast / neuen Schützen hinzufügen</button>
    <label class="field"><span>Sonderkönig</span>
      <input type="text" id="edSonder" list="shooterList" value="${esc(sonderName(d.sonderkoenig))}" placeholder="optional">
      <datalist id="shooterList">${state.data.schuetzen.map(s => `<option value="${esc(s.vollname || s.name)}">`).join('')}</datalist>
    </label>
    <label class="field"><span>Bemerkung</span><textarea id="edNote" placeholder="optional, z. B. wer gefehlt hat">${esc(d.bemerkung)}</textarea></label>`;
  const foot = `<button class="btn secondary" data-close>Abbrechen</button><button class="btn" id="edSave">Speichern</button>`;
  const scroll = $('#sheet').hidden ? 0 : $('#sheetBody').scrollTop;
  openSheet(editor.originalId ? `Jagdtag bearbeiten` : 'Neuer Jagdtag', body, foot);
  $('#sheetBody').scrollTop = scroll;
  bindEditor();
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
  body.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
    const { sid, w, kind } = b.dataset;
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
  d.id = d.datum;
  // bestehende Einträge (alter Stand + gleicher Tag) ersetzen
  state.data.jagdtage = state.data.jagdtage.filter(x => x.id !== editor.originalId && x.datum !== d.datum);
  state.data.jagdtage.push({ id: d.id, datum: d.datum, sonderkoenig: d.sonderkoenig, bemerkung: d.bemerkung, strecke: d.strecke, hund: d.hund });
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

Aufbau des Zettels: Oben "Jagdtag" mit Datum (z. B. 18.10.25). Darunter eine Tabelle: Spalte "Name" (vorgedruckte Schützen), dann Spalten für Wildarten (z. B. Hase, Fasan, Kanin., Taube, Schnepfe, Ente, Fuchs, Sonstig) und ganz rechts "Punkte" (handschriftlich, nur zur Kontrolle). Unten "Gesamtstrecke" und die Felder Jagdkönig, Vizekönig, Sonderkönig.

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

Antworte ausschließlich mit JSON in genau diesem Format, ohne weiteren Text:
{"datum":"YYYY-MM-DD","eintraege":[{"schuetze_id":"id oder null","name_zettel":"...","erlegt":{"hase":0},"hund":{},"punkte_zettel":null,"unsicher":null}],"sonderkoenig":"","bemerkung":"","hinweise":[]}`;
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
  const existing = state.data.jagdtage.find(x => x.datum === day.datum);
  openEditor(null);
  Object.assign(editor, { day, flags, hinweise, unassigned, open, showDog, photo, originalId: existing ? existing.id : null });
  if (existing) editor.hinweise.unshift(`Für den ${dateDE(day.datum)} ist bereits ein Jagdtag gespeichert – er wird beim Speichern ersetzt.`);
  renderEditor();
}

/* ================= Einstellungen ================= */
function openSettings() {
  const c = state.cfg;
  const body = `
    <div class="alert info">${isAdmin() ? '<b>Bearbeitungsmodus aktiv.</b> Du kannst Jagdtage erfassen und speichern.' : '<b>Ansichtsmodus.</b> Zum Erfassen und Speichern GitHub-Zugang eintragen. Alle anderen brauchen nur den Link.'}</div>
    <fieldset><legend>Speicherort (GitHub)</legend>
      <div class="grid2">
        <label class="field"><span>Konto</span><input id="cfOwner" value="${esc(c.owner)}" autocapitalize="off" autocorrect="off"></label>
        <label class="field"><span>Repository</span><input id="cfRepo" value="${esc(c.repo)}" autocapitalize="off" autocorrect="off"></label>
      </div>
      <label class="field"><span>Zugriffs-Token (nur auf diesem Gerät gespeichert)</span><input id="cfToken" type="password" value="${esc(c.token)}" placeholder="github_pat_…" autocomplete="off"></label>
      <p class="hint">Fine-grained Token mit Zugriff nur auf dieses Repository, Berechtigung „Contents: Read and write“.</p>
    </fieldset>
    <fieldset><legend>Foto-Auswertung (KI)</legend>
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
      ${species().map(w => `<div class="list-row"><span class="nm">${esc(w.name)}</span><input type="number" step="0.5" min="0" data-wpts="${w.id}" value="${w.punkte}"></div>`).join('')}
      <p class="hint">Achtung: Punktänderungen gelten rückwirkend für alle Jagdjahre.</p>
    </fieldset>
    <fieldset><legend>Datensicherung</legend>
      <div class="btn-row"><button class="btn secondary" id="cfExport">JSON sichern</button><button class="btn secondary" id="cfImport">JSON einspielen</button></div>
      <input type="file" id="cfImportFile" accept="application/json,.json" hidden>
    </fieldset>` : ''}
    <p class="hint" style="text-align:center">Version ${APP_VERSION}</p>`;
  openSheet('Einstellungen', body, `<button class="btn secondary" data-close>Abbrechen</button><button class="btn" id="cfSave">Übernehmen</button>`);

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
  $('#cfExport')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    shareOrDownload(blob, `strecke_${todayISO()}.json`);
  });
  $('#cfImport')?.addEventListener('click', () => $('#cfImportFile').click());
  $('#cfImportFile')?.addEventListener('change', async e => {
    try {
      const d = normalize(JSON.parse(await e.target.files[0].text()));
      if (!Array.isArray(d.jagdtage) || !Array.isArray(d.schuetzen)) throw new Error('Unbekanntes Format');
      state.data = d; closeSheet(); persist('Daten aus Sicherung eingespielt');
    } catch (err) { toast('Import fehlgeschlagen: ' + err.message, 4000); }
  });
  $('#cfSave').addEventListener('click', async () => {
    const before = JSON.stringify({ s: state.data.schuetzen, w: state.data.wildarten });
    Object.assign(state.cfg, {
      owner: $('#cfOwner').value.trim(), repo: $('#cfRepo').value.trim(),
      token: $('#cfToken').value.trim(), apiKey: $('#cfKey').value.trim(), model: $('#cfModel').value,
    });
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
    closeSheet();
    if (JSON.stringify({ s: state.data.schuetzen, w: state.data.wildarten }) !== before) await persist('Schützen/Punkte geändert');
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

/* ================= Teilen / Download ================= */
async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
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
    doc.autoTable({ ...tableStyle, startY: y,
      head: [['Wildart', 'Stück', ...(hundTotal ? ['davon Hund'] : [])]],
      body: species().map(w => [w.name, String(st.perSpecies[w.id] || 0), ...(hundTotal ? [String(st.perSpeciesHund[w.id] || '')] : [])]),
      foot: [['Gesamt', String(st.total), ...(hundTotal ? [String(hundTotal)] : [])]],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      tableWidth: 100, didParseCell: numRight(1),
    });
    y = doc.lastAutoTable.finalY + 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...PDF.muted);
    doc.text(`${st.days.length} Jagdtage${st.days.length ? `: ${st.days.map(d => dateDE(d.datum)).join(', ')}` : ''}`, 14, y, { maxWidth: 182 });
    y += 12;
    y = sectionTitle(doc, 'Strecke je Jagdtag', y);
    doc.autoTable({ ...tableStyle, startY: y,
      head: [['Jagdtag', ...cols.map(w => w.name), 'Gesamt']],
      body: st.days.map(d => { const ds = dayStats(d); return [dateDE(d.datum), ...cols.map(w => ds.perSpecies[w.id] ? String(ds.perSpecies[w.id]) + (ds.perSpeciesHund[w.id] ? ` (${ds.perSpeciesHund[w.id]} H)` : '') : '–'), String(ds.total)]; }),
      foot: [['Gesamt', ...cols.map(w => String(st.perSpecies[w.id] || 0)), String(st.total)]],
      columnStyles: Object.fromEntries([...cols.map((_, i) => [i + 1, { halign: 'right' }]), [cols.length + 1, { halign: 'right', fontStyle: 'bold' }]]),
      didParseCell: numRight(1),
    });
    y = doc.lastAutoTable.finalY + 10;
    y = sectionTitle(doc, 'Tageskönige', y);
    doc.autoTable({ ...tableStyle, startY: y,
      head: [['Jagdtag', 'Jagdkönig', 'Vizekönig', 'Sonderkönig']],
      body: st.days.map(d => { const ds = dayStats(d); return [dateDE(d.datum), ds.koenig.length ? `${ds.koenig.map(shooterName).join(', ')} (${fmt(ds.koenigPts)})` : '–', ds.vize.length ? `${ds.vize.map(shooterName).join(', ')} (${fmt(ds.vizePts)})` : '–', sonderName(d.sonderkoenig) || '–']; }),
    });
    if (hundTotal) { doc.setFontSize(8.5); doc.setTextColor(...PDF.muted); doc.text('H = vom Hund gegriffen (zählt zur Strecke, ohne Punkte)', 14, doc.lastAutoTable.finalY + 6); }
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
        body.push([dateDE(t.datum), parts.join(', '), fmt(t.punkte)]);
      }
    }
    doc.autoTable({ ...tableStyle, startY: y, head: [['Jagdtag', 'Erlegt', 'Punkte']], body, didParseCell: numRight(2, 2),
      alternateRowStyles: {}, columnStyles: { 0: { cellWidth: 26 }, 2: { halign: 'right', cellWidth: 20 } } });
    y = doc.lastAutoTable.finalY + 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...PDF.muted);
    if (y > 280) { doc.addPage(); y = 20; }
    doc.text(`Punkte: ${species().map(w => `${w.name} ${fmt(w.punkte)}`).join(', ')}. H = vom Hund gegriffen (zählt zur Strecke, ohne Punkte). Gleiche Punktzahl = gleicher Platz.`, 14, y, { maxWidth: 182 });
    pdfFooter(doc);
    await shareOrDownload(doc.output('blob'), `Jagdkoenig_${safeSeason(season)}.pdf`);
  } catch (e) { toast('Export fehlgeschlagen: ' + e.message, 4500); }
}

/* ================= Navigation ================= */
function switchTab(tab) {
  state.tab = tab;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.view').forEach(v => (v.hidden = v.dataset.view !== tab));
  window.scrollTo({ top: 0 });
}
$$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
$('#seasonSelect').addEventListener('change', e => { state.season = e.target.value; renderTage(); renderStrecke(); renderKoenig(); });
$('#settingsBtn').addEventListener('click', openSettings);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && $('#sheet').hidden && !state.pending) load(); });

/* ================= Service Worker (Update-Hinweis) ================= */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(reg => {
    const offer = w => {
      showBanner(`<span>Neue Version verfügbar.</span><button class="btn" id="swReload">Neu laden</button>`, 'info');
      $('#swReload').addEventListener('click', () => w.postMessage('skipWaiting'));
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

load();
