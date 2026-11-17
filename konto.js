/* Konten für Jagd Thuine & Hochsitze (gemeinsames Modul, in beiden Apps identisch)
 * Spricht mit dem Konten-Server (Cloudflare Worker), Adresse in config.js (JAGD_CFG.api).
 * - Anmelden / Konto beantragen / Passwort ändern / Abmelden
 * - Kontenverwaltung für Admins (freigeben, Rollen, Einzelrechte, sperren, löschen, Protokoll)
 * - Push-Benachrichtigungen (Gerät anmelden, Test, Senden für Admins)
 * Die App übergibt in Konto.init() ihre Oberflächen-Funktionen (Sheet, Toast) und Rückrufe.
 */
'use strict';
window.Konto = (() => {
  const CFG = self.JAGD_CFG || {};
  const API = String(CFG.api || '').replace(/\/$/, '');
  const APP = CFG.app || '';
  const LSK = (CFG.lsPrefix || '') + 'konto.v1';
  const LSI = (CFG.lsPrefix || '') + 'konto.info.v1';
  const ld = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
  const sv = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];

  let st = ld(LSK, {}) || {};           // { token, user, pw: {app: pw} }
  let inf = ld(LSI, null);               // /info (Apps, Rechte, VAPID, nurKonten)
  let H = { ui: null };                  // Rückrufe der App
  const save = () => sv(LSK, st);

  /* ---------- Server ---------- */
  async function api(method, path, body, { auth = true, signal } = {}) {
    if (!API) throw new Error('Kein Konten-Server eingerichtet.');
    let r;
    try {
      r = await fetch(API + path, {
        method, cache: 'no-store', signal,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth && st.token ? { Authorization: 'Bearer ' + st.token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { if (e.name === 'AbortError') throw e; throw new Error('Keine Verbindung zum Server.'); }
    let j = {}; try { j = await r.json(); } catch { /* leer */ }
    if (!r.ok) {
      const e = new Error(j.fehler || `Server-Fehler ${r.status}`); e.status = r.status;
      if (auth && st.token && r.status === 401) { abmelden(true); }
      throw e;
    }
    return j;
  }
  async function info(force = false) {
    if (inf && !force && Date.now() - (inf._t || 0) < 6 * 3600e3) return inf;
    try { inf = await api('GET', '/info', null, { auth: false }); inf._t = Date.now(); sv(LSI, inf); } catch (e) { if (!inf) throw e; }
    return inf;
  }

  /* ---------- Zustand ---------- */
  const enabled = () => !!API;
  const loggedIn = () => !!(st.token && st.user && st.user.status === 'aktiv');
  const user = () => st.user || null;
  const rolle = (app = APP) => !loggedIn() ? '' : st.user.super ? 'admin' : (st.user.apps?.[app]?.rolle || 'ansehen');
  const isAdmin = (app = APP) => rolle(app) === 'admin';
  const hatZugang = (app = APP) => loggedIn() && rolle(app) !== 'kein';
  const can = (recht, app = APP) => isAdmin(app) || (hatZugang(app) && (st.user.apps?.[app]?.rechte || []).includes(recht));
  const isAnyAdmin = () => loggedIn() && (st.user.super || Object.values(st.user.apps || {}).some(a => a.rolle === 'admin'));
  const token = () => st.token || '';
  const ghBase = () => API + '/gh';
  const dataPw = (app = APP) => st.pw?.[app] || '';
  /** Konto auf diesem Gerät beantragt, aber noch nicht angemeldet: { name, t } */
  const beantragt = () => (!loggedIn() && st.beantragt) || null;

  function uebernehmen(j) {
    if (j.token) st.token = j.token;
    st.user = j.user; st.pw = j.pw || {}; st.pwFehlt = j.pwFehlt || []; delete st.beantragt;
    save();
  }
  /** Nach Anmeldung/Aktualisierung: Daten-Passwort an die App geben bzw. als Admin hinterlegen */
  async function nachAnmeldung() {
    const pw = dataPw();
    if (pw && H.getPw && H.getPw() !== pw && H.setPw) await H.setPw(pw);
    if (!pw && isAdmin() && H.getPw && H.getPw()) { try { await setDataPw(H.getPw(), true); } catch { /* später */ } }
    H.onChange?.();
  }
  async function refresh() {
    if (!st.token || !API) return false;
    try { uebernehmen(await api('GET', '/konto/ich')); await nachAnmeldung(); return true; }
    catch (e) { if (e.status === 403) { st.user = Object.assign({}, st.user, { status: 'gesperrt' }); save(); H.onChange?.(); } return false; }
  }
  function abmelden(still = false) {
    const war = loggedIn();
    st = {}; save();
    if (war) { H.onChange?.(); if (!still) toast('Abgemeldet.'); else toast('Anmeldung abgelaufen – bitte neu anmelden.', 4500); }
  }
  async function setDataPw(pw, still = false) {
    if (!isAdmin() || !pw) return false;
    await api('POST', '/admin/datenpw', { app: APP, pw });
    st.pw = Object.assign({}, st.pw, { [APP]: pw }); save();
    if (!still) toast('Daten-Passwort im Server hinterlegt ✓');
    return true;
  }

  /* ---------- Oberfläche (nutzt Sheet & Toast der App) ---------- */
  const toast = (m, ms) => H.ui?.toast(m, ms);
  const sheet = (title, body, foot, over) => { H.ui.openSheet(title, body, foot, !!over); injectStyle(); };
  const close = () => H.ui.closeSheet();
  function injectStyle() {
    if ($('#kontoStyle')) return;
    const s = document.createElement('style'); s.id = 'kontoStyle';
    s.textContent = `
.kt-list{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:12px;background:var(--paper);overflow:hidden}
.kt-list li{display:flex;align-items:center;gap:10px;padding:10px 12px;border-top:1px solid var(--line)}
.kt-list li:first-child{border-top:0}
.kt-list .kt-n{flex:1;min-width:0}
.kt-list .kt-n b{display:block;overflow-wrap:anywhere}
.kt-list .kt-n small{display:block;color:var(--muted);font-size:12.5px;line-height:1.35}
.kt-list button.kt-row{all:unset;cursor:pointer;display:flex;align-items:center;gap:10px;flex:1;min-width:0}
.kt-tag{display:inline-block;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:99px;background:var(--green-soft);color:var(--green);white-space:nowrap}
.kt-tag.w{background:var(--brass-soft);color:#6b4d10}.kt-tag.x{background:var(--warn-soft);color:var(--warn)}
.kt-box{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--paper)}
.kt-box h3{margin:0 0 8px;font-size:15px;color:var(--green)}
.kt-seg{display:flex;gap:4px;flex-wrap:wrap}
.kt-seg button{flex:1;min-height:38px;border:1px solid var(--line);background:var(--bg);border-radius:9px;font:inherit;font-size:14px;color:var(--ink);padding:4px 6px}
.kt-seg button.on{background:var(--green);border-color:var(--green);color:#fff;font-weight:600}
.kt-chk{display:flex;gap:10px;align-items:flex-start;margin-top:8px;font-size:14.5px}
.kt-chk input{width:20px;height:20px;margin-top:1px;accent-color:var(--green);flex:none}
.kt-sub{margin-top:10px;font-size:13px;font-weight:600;color:var(--muted)}
.kt-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.kt-krit{list-style:none;margin:6px 0 6px;padding:0;font-size:13.5px;color:var(--muted)}.kt-krit li.ok{color:var(--green);font-weight:600}
.kt-msg{min-height:1.2em;color:var(--warn);font-size:14px;margin:0}
.kt-log{list-style:none;margin:0;padding:0;font-size:13.5px}
.kt-log li{padding:7px 0;border-top:1px solid var(--line)}.kt-log li:first-child{border-top:0}
.kt-log small{display:block;color:var(--muted)}
.kt-me{display:flex;align-items:center;gap:10px}
.kt-ava{width:38px;height:38px;border-radius:50%;background:var(--green);color:#fff;display:grid;place-items:center;font-weight:700;flex:none}
.kt-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.kt-btns .btn{flex:1 1 auto}
#ktTest{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 2px);transform:translateX(-50%);z-index:2000;background:#b3261e;color:#fff;font:700 11px/1 sans-serif;letter-spacing:.08em;padding:3px 8px;border-radius:99px;pointer-events:none}
`;
    document.head.appendChild(s);
  }
  const rolleTxt = r => ({ admin: 'Admin', ansehen: 'Ansehen', kein: 'kein Zugang' }[r] || r);
  const appName = a => inf?.apps?.[a]?.name || a;
  const initials = n => String(n || '?').split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();

  /** Anmelden / Konto beantragen */
  async function openLogin({ over = false, mode = 'login', onDone } = {}) {
    try { await info(); } catch { /* offline – trotzdem anzeigen */ }
    const erster = !!inf?.ersterNutzer;
    if (erster) mode = 'neu';
    const kriterien = () => {
      const a = $('#ktPw')?.value || '', b = $('#ktPw2')?.value || '';
      const li = (ok, t) => `<li class="${ok ? 'ok' : ''}">${ok ? '✓' : '○'} ${t}</li>`;
      const box = $('#ktKrit'); if (box) box.innerHTML = li(a.length >= 6, 'mindestens 6 Zeichen') + li(a && a === b, 'beide Eingaben gleich');
    };
    const draw = () => {
      const neu = mode === 'neu';
      sheet(neu ? 'Konto beantragen' : 'Mit Konto anmelden', `
        ${neu ? `<p class="hint">${erster ? '<b>Du bist der Erste.</b> Dein Konto wird automatisch Haupt-Admin und ist sofort aktiv.' : 'Nach dem Beantragen gibt Sebastian (bzw. ein Admin) dein Konto frei. Danach kannst du dich hier anmelden.'}</p>`
        : '<p class="hint">Melde dich mit deinem Vor- und Nachnamen und deinem Passwort an. Noch kein Konto? Unten „Konto beantragen“.</p>'}
        <div class="kt-2"><label class="field"><span>Vorname</span><input id="ktVor" autocomplete="given-name" autocapitalize="words" placeholder="z. B. Werner"></label>
        <label class="field"><span>Nachname</span><input id="ktNach" autocomplete="family-name" autocapitalize="words" placeholder="z. B. Gebbe"></label></div>
        <label class="field"><span>${neu ? 'Passwort wählen' : 'Passwort'}</span><input type="password" id="ktPw" autocomplete="${neu ? 'new-password' : 'current-password'}"></label>
        ${neu ? '<label class="field"><span>Passwort wiederholen</span><input type="password" id="ktPw2" autocomplete="new-password"></label><ul class="kt-krit" id="ktKrit"></ul>' : ''}
        <p class="kt-msg" id="ktMsg"></p>
        ${neu ? '' : '<button type="button" class="btn ghost block" id="ktVergessen">Passwort vergessen?</button>'}
        ${erster ? '' : `<button type="button" class="btn ghost block" id="ktSwitch">${neu ? 'Ich habe schon ein Konto – anmelden' : 'Noch kein Konto? Konto beantragen'}</button>`}`,
        `<button class="btn secondary" data-close>Abbrechen</button><button class="btn" id="ktGo">${neu ? 'Beantragen' : 'Anmelden'}</button>`, over);
      $('#ktSwitch')?.addEventListener('click', () => { mode = neu ? 'login' : 'neu'; draw(); });
      $('#ktVergessen')?.addEventListener('click', () => openVergessen({ over, vor: $('#ktVor').value, nach: $('#ktNach').value }));
      if (neu) { kriterien(); $$('#ktPw, #ktPw2').forEach(i => i.addEventListener('input', kriterien)); }
      const go = async () => {
        const msg = t => { $('#ktMsg').textContent = t; };
        const vor = $('#ktVor').value.trim(), nach = $('#ktNach').value.trim(), pw = $('#ktPw').value;
        if (!vor || !nach) return msg('Bitte Vor- und Nachnamen eintragen.');
        const name = `${vor} ${nach}`;
        if (!pw) return msg('Bitte das Passwort eingeben.');
        if (neu) { if (pw.length < 6) return msg('Das Passwort braucht mindestens 6 Zeichen.'); if (pw !== $('#ktPw2').value) return msg('Die beiden Passwörter sind verschieden.'); }
        const b = $('#ktGo'); b.disabled = true; msg('');
        try {
          const j = await api('POST', neu ? '/konto/registrieren' : '/konto/anmelden', { name, pw }, { auth: false });
          if (j.wartend) {
            st.beantragt = { name: j.user?.name || name, t: Date.now() }; save(); H.onChange?.();
            sheet('Konto beantragt', `<p>Danke, <b>${esc(j.user.name)}</b>! Dein Konto ist beantragt.</p><p class="hint">Sebastian wurde benachrichtigt. Sobald er dein Konto freigegeben hat, meldest du dich hier mit Namen und Passwort an.</p>`, '<button class="btn" data-close>OK</button>', over);
            return;
          }
          uebernehmen(j); inf && (inf.ersterNutzer = false, sv(LSI, inf));
          close();
          toast(`Angemeldet als ${j.user.name} ✓`);
          await nachAnmeldung();
          if (!dataPw() && hatZugang()) toast(isAdmin() ? 'Bitte einmal das Passwort der Jagdgemeinschaft eingeben – es wird dann im Server hinterlegt.' : 'Für dein Konto ist noch kein Daten-Passwort hinterlegt – bitte Sebastian Bescheid geben.', 6000);
          onDone?.(j);
          setTimeout(async () => { try { await H.nachAnmeldung?.(j); } catch { /* egal */ } pushFrage(); }, 700);
        } catch (e) { msg(e.message); b.disabled = false; }
      };
      $('#ktGo').addEventListener('click', go);
      $$('#ktVor, #ktNach, #ktPw, #ktPw2').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }));
      setTimeout(() => $('#ktVor')?.focus(), 60);
    };
    draw();
  }
  /** Passwort vergessen: Admins werden benachrichtigt und setzen ein Startpasswort */
  function openVergessen({ over = false, vor = '', nach = '' } = {}) {
    sheet('Passwort vergessen', `
      <p class="hint">Trag deinen Namen ein. Sebastian bekommt eine Nachricht und gibt dir ein neues Startpasswort, das du danach selbst ändern kannst.</p>
      <div class="kt-2"><label class="field"><span>Vorname</span><input id="kvVor" autocapitalize="words" value="${esc(vor)}"></label>
      <label class="field"><span>Nachname</span><input id="kvNach" autocapitalize="words" value="${esc(nach)}"></label></div>
      <p class="kt-msg" id="kvMsg"></p>`,
      '<button class="btn secondary" id="kvBack">Zurück</button><button class="btn" id="kvGo">Bescheid geben</button>', over);
    $('#kvBack').addEventListener('click', () => openLogin({ over }));
    $('#kvGo').addEventListener('click', async e => {
      const v = $('#kvVor').value.trim(), n = $('#kvNach').value.trim();
      if (!v || !n) { $('#kvMsg').textContent = 'Bitte Vor- und Nachnamen eintragen.'; return; }
      e.currentTarget.disabled = true;
      try { await api('POST', '/konto/passwort-vergessen', { name: `${v} ${n}` }, { auth: false }); } catch { /* Antwort immer gleich */ }
      sheet('Passwort vergessen', '<p>Danke! <b>Sebastian wurde benachrichtigt</b> und meldet sich mit einem neuen Startpasswort bei dir.</p>', '<button class="btn" data-close>OK</button>', over);
    });
  }
  /** Nach der Anmeldung einmal anbieten, Benachrichtigungen einzuschalten */
  async function pushFrage() {
    if (!CFG.push || !loggedIn() || !hatZugang() || !pushSupported() || Notification.permission === 'denied') return;
    if (Notification.permission === 'granted' && await Promise.race([currentSub(), new Promise(r => setTimeout(() => r(null), 2000))])) return;
    sheet('Benachrichtigungen einschalten?', `<p>${esc(pushText(false))}</p><p class="hint">Du kannst das jederzeit unter Einstellungen → Konto wieder ausschalten.</p>`,
      '<button class="btn secondary" data-close>Später</button><button class="btn" id="kpOn">🔔 Einschalten</button>');
    $('#kpOn').addEventListener('click', async e => {
      e.currentTarget.disabled = true;
      try { await pushEnable(); close(); toast('Benachrichtigungen an ✓'); } catch (err) { close(); toast(err.message, 5000); }
    });
  }

  /** Abschnitt für die Einstellungen der App */
  function settingsHtml() {
    if (!enabled()) return '';
    const u = user();
    if (!loggedIn()) {
      return `<fieldset><legend>Konto</legend>
        <p class="hint">${u?.status === 'gesperrt' ? '<b>Dein Konto ist gesperrt.</b> ' : ''}Mit einem eigenen Konto brauchst du kein gemeinsames Passwort und keinen Token. Sebastian gibt dein Konto frei und vergibt die Rechte.</p>
        <div class="kt-btns"><button type="button" class="btn" id="ktLogin">Anmelden</button><button type="button" class="btn secondary" id="ktNew">Konto beantragen</button></div>
      </fieldset>`;
    }
    const r = rolle(), rechte = (u.apps?.[APP]?.rechte || []).map(x => inf?.apps?.[APP]?.rechte?.[x] || x);
    return `<fieldset><legend>Konto</legend>
      <div class="kt-me"><span class="kt-ava">${esc(initials(u.name))}</span><div><b>${esc(u.name)}</b><small class="sub" style="display:block">${u.super ? 'Haupt-Admin' : rolleTxt(r)}${rechte.length && r !== 'admin' ? ' · ' + esc(rechte.join(', ')) : ''}</small></div></div>
      <div class="kt-btns">
        ${isAnyAdmin() ? '<button type="button" class="btn" id="ktAdmin">👥 Konten verwalten</button>' : ''}
        <button type="button" class="btn secondary" id="ktPwChange">Passwort ändern</button>
        <button type="button" class="btn ghost" id="ktLogout">Abmelden</button>
      </div>
      ${CFG.push ? `<div id="ktPushBox" style="margin-top:12px"></div>` : ''}
    </fieldset>`;
  }
  function wireSettings(root = document, { over = false } = {}) {
    $('#ktLogin', root)?.addEventListener('click', () => openLogin({ over }));
    $('#ktNew', root)?.addEventListener('click', () => openLogin({ over, mode: 'neu' }));
    $('#ktLogout', root)?.addEventListener('click', e => {
      const b = e.currentTarget; if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Wirklich abmelden?'; return; }
      close(); abmelden();
    });
    $('#ktPwChange', root)?.addEventListener('click', () => openPwChange());
    $('#ktAdmin', root)?.addEventListener('click', () => openAdmin());
    const pb = $('#ktPushBox', root); if (pb) drawPushBox(pb);
  }
  function openPwChange() {
    sheet('Konto-Passwort ändern', `
      <label class="field"><span>Bisheriges Passwort</span><input type="password" id="kpAlt" autocomplete="current-password"></label>
      <label class="field"><span>Neues Passwort (mind. 6 Zeichen)</span><input type="password" id="kpNeu" autocomplete="new-password"></label>
      <label class="field"><span>Wiederholen</span><input type="password" id="kpNeu2" autocomplete="new-password"></label>
      <p class="kt-msg" id="kpMsg"></p>`, '<button class="btn secondary" data-close>Abbrechen</button><button class="btn" id="kpGo">Ändern</button>');
    $('#kpGo').addEventListener('click', async () => {
      const m = t => { $('#kpMsg').textContent = t; };
      const a = $('#kpNeu').value; if (a.length < 6) return m('Mindestens 6 Zeichen.'); if (a !== $('#kpNeu2').value) return m('Die beiden Eingaben sind verschieden.');
      try { uebernehmen(await api('POST', '/konto/passwort', { alt: $('#kpAlt').value, neu: a })); close(); toast('Passwort geändert ✓'); } catch (e) { m(e.message); }
    });
  }

  /* ---------- Kontenverwaltung ---------- */
  let adm = null; // { konten, einstellungen, datenPw }
  async function openAdmin() {
    try { await info(true); adm = await api('GET', '/admin/konten'); } catch (e) { toast(e.message, 4000); return; }
    drawAdmin();
  }
  function drawAdmin() {
    const k = adm.konten, wart = k.filter(x => x.status === 'wartend'), rest = k.filter(x => x.status !== 'wartend');
    const appsTxt = x => Object.keys(inf.apps).map(a => {
      const v = x.apps[a]; const rr = v.rechte.map(r => inf.apps[a].rechte[r]?.split(' (')[0] || r);
      return `${esc(appName(a))}: ${rolleTxt(v.rolle)}${rr.length && v.rolle !== 'admin' ? ' + ' + esc(rr.join(', ')) : ''}${(v.hinweise || []).length ? ' 🔔' : ''}`;
    }).join(' · ');
    const row = x => `<li><button class="kt-row" data-ktu="${esc(x.id)}"><span class="kt-ava" style="width:32px;height:32px;font-size:13px${x.status === 'gesperrt' ? ';background:var(--muted)' : ''}">${esc(initials(x.name))}</span>
        <span class="kt-n"><b>${esc(x.name)} ${x.super ? '<span class="kt-tag">Haupt-Admin</span>' : x.status === 'gesperrt' ? '<span class="kt-tag x">gesperrt</span>' : ''}${x.pwVergessen ? ' <span class="kt-tag w">Passwort vergessen</span>' : ''}</b><small>${x.super ? 'alle Rechte' : appsTxt(x)}</small></span></button>
        ${x.status === 'wartend' ? `<button class="btn" style="min-height:36px;padding:4px 12px" data-ktok="${esc(x.id)}">Freigeben</button>` : ''}</li>`;
    const me = user();
    sheet('Konten verwalten', `
      ${wart.length ? `<h3 style="margin:0;font-size:15px;color:var(--warn)">Wartet auf Freigabe (${wart.length})</h3><ul class="kt-list">${wart.map(row).join('')}</ul>
        <p class="hint">„Freigeben“ gibt Ansehen-Zugang zu beiden Apps. Weitere Rechte: Namen antippen.</p>` : ''}
      <h3 style="margin:0;font-size:15px;color:var(--green)">Konten (${rest.length})</h3>
      <ul class="kt-list">${rest.map(row).join('')}</ul>
      <div class="kt-btns"><button class="btn secondary" id="kaNew">+ Konto anlegen</button><button class="btn secondary" id="kaLog">📜 Protokoll</button></div>
      <div class="kt-box"><h3>Daten-Passwort im Server</h3>
        <p class="hint" style="margin:0">${Object.keys(inf.apps).map(a => `${esc(appName(a))}: ${adm.datenPw[a] ? '✓ hinterlegt' : '<b style="color:var(--warn)">fehlt</b>'}`).join(' · ')}</p>
        <p class="hint">Das Passwort der Jagdgemeinschaft wird an angemeldete Konten weitergegeben – sie müssen es nicht kennen. Es wird hinterlegt, wenn ein Admin dieser App angemeldet ist, und bei jeder Passwort-Änderung automatisch aktualisiert.</p>
        ${isAdmin() && H.getPw?.() ? `<button class="btn secondary block" id="kaPw">Passwort dieser App (${esc(appName(APP))}) jetzt hinterlegen</button>` : ''}
      </div>
      ${me.super ? `<div class="kt-box"><h3>Gemeinsames Passwort abschalten</h3>
        <label class="kt-chk"><input type="checkbox" id="kaNur" ${adm.einstellungen.nurKonten ? 'checked' : ''}><span><b>Nur noch mit Konto</b><br><small class="sub">Auf dem Sperrbildschirm gibt es dann kein Passwort-Feld mehr, nur noch „Mit Konto anmelden“.</small></span></label>
        <p class="hint">Wichtig: Wer das alte Passwort kennt, kann die Daten weiter öffnen. Darum danach in jeder App unter Einstellungen das Passwort der Jagdgemeinschaft auf ein neues ändern – angemeldete Konten bekommen das neue automatisch, alle anderen nicht.</p></div>` : ''}`,
      '<button class="btn secondary" data-close>Schließen</button>');
    $$('[data-ktu]').forEach(b => b.addEventListener('click', () => openUser(b.dataset.ktu)));
    $$('[data-ktok]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await api('POST', '/admin/konto', { id: b.dataset.ktok, status: 'aktiv' }); toast('Freigegeben ✓'); await openAdmin(); } catch (e) { toast(e.message, 4000); b.disabled = false; }
    }));
    $('#kaNew').addEventListener('click', () => openUser(null));
    $('#kaLog').addEventListener('click', openProtokoll);
    $('#kaPw')?.addEventListener('click', async () => { try { await setDataPw(H.getPw()); await openAdmin(); } catch (e) { toast(e.message, 4000); } });
    $('#kaNur')?.addEventListener('change', async e => {
      try { const j = await api('POST', '/admin/einstellungen', { nurKonten: e.target.checked }); adm.einstellungen = j.einstellungen; await info(true); toast(j.einstellungen.nurKonten ? 'Nur noch Anmeldung mit Konto.' : 'Passwort-Zugang wieder erlaubt.'); H.onChange?.(); }
      catch (err) { e.target.checked = !e.target.checked; toast(err.message, 4000); }
    });
  }
  function openUser(id) {
    const x = id ? adm.konten.find(k => k.id === id) : { id: null, name: '', status: 'aktiv', apps: Object.fromEntries(Object.keys(inf.apps).map(a => [a, { rolle: 'ansehen', rechte: [], hinweise: [] }])) };
    if (!x) return;
    const me = user();
    const apps = JSON.parse(JSON.stringify(x.apps));
    const neu = !id;
    const draw = () => {
      sheet(neu ? 'Neues Konto' : x.name, `
        ${neu ? `<label class="field"><span>Vor- und Nachname</span><input id="kuName" autocapitalize="words"></label>
          <label class="field"><span>Startpasswort (mind. 6 Zeichen, bitte weitergeben)</span><input id="kuPw" autocomplete="off" autocapitalize="off" value="${esc(vorschlagPw())}"></label>`
        : `<p class="hint" style="margin:0">${x.status === 'wartend' ? '<span class="kt-tag w">wartet auf Freigabe</span>' : x.status === 'gesperrt' ? '<span class="kt-tag x">gesperrt</span>' : '<span class="kt-tag">aktiv</span>'}
            · seit ${new Date(x.erstellt).toLocaleDateString('de-DE')}${x.zuletzt ? ` · zuletzt angemeldet ${new Date(x.zuletzt).toLocaleDateString('de-DE')}` : ''}</p>`}
        ${x.super ? '<p class="hint"><b>Haupt-Admin</b> – hat in allen Apps alle Rechte.</p>' : ''}
        ${Object.keys(inf.apps).map(a => {
          const darf = me.super || me.apps?.[a]?.rolle === 'admin';
          const v = apps[a], rechte = Object.entries(inf.apps[a].rechte || {}), hinw = Object.entries(inf.apps[a].hinweise || {});
          const hinwHtml = hinw.length ? `<div class="kt-sub">🔔 Benachrichtigung bekommen bei</div>${hinw.map(([k, t]) => `<label class="kt-chk"><input type="checkbox" data-kuhinweis="${a}:${k}" ${(v.hinweise || []).includes(k) ? 'checked' : ''} ${darf ? '' : 'disabled'}><span>${esc(t)}</span></label>`).join('')}` : '';
          if (x.super) return hinw.length ? `<div class="kt-box"><h3>${esc(appName(a))}</h3>${hinwHtml}</div>` : '';
          return `<div class="kt-box"><h3>${esc(appName(a))}</h3>
            <div class="kt-seg" data-kurolle="${a}">${['kein', 'ansehen', 'admin'].map(r => `<button type="button" data-v="${r}" class="${v.rolle === r ? 'on' : ''}" ${darf ? '' : 'disabled'}>${rolleTxt(r)}</button>`).join('')}</div>
            ${rechte.length && v.rolle === 'ansehen' ? rechte.map(([k, t]) => `<label class="kt-chk"><input type="checkbox" data-kurecht="${a}:${k}" ${v.rechte.includes(k) ? 'checked' : ''} ${darf ? '' : 'disabled'}><span>${esc(t)}</span></label>`).join('') : ''}
            ${v.rolle === 'admin' ? '<p class="hint" style="margin:6px 0 0">Admin darf in dieser App alles ändern und Konten verwalten.</p>' : ''}
            ${v.rolle !== 'kein' ? hinwHtml : ''}
            ${darf ? '' : '<p class="hint" style="margin:6px 0 0">Nur ein Admin dieser App kann das ändern.</p>'}</div>`;
        }).join('')}
        ${!neu && !x.super ? `<details class="kt-box" ${x.pwVergessen ? 'open' : ''}><summary style="cursor:pointer;font-weight:600">Passwort vergessen? Neues Startpasswort</summary>
            <label class="field" style="margin-top:8px"><span>Neues Passwort</span><input id="kuNeuPw" autocomplete="off" autocapitalize="off" value="${esc(vorschlagPw())}"></label>
            <button type="button" class="btn secondary block" id="kuSetPw" style="margin-top:8px">Passwort setzen</button>
            <p class="hint">Das Passwort dem Jäger persönlich weitergeben. Er kann es danach unter Einstellungen → Konto ändern.</p></details>` : ''}
        ${!neu && !x.super && me.super ? `<div class="kt-btns">
            ${x.status === 'aktiv' ? '<button type="button" class="btn secondary" id="kuLock">Sperren</button>' : x.status === 'gesperrt' ? '<button type="button" class="btn secondary" id="kuUnlock">Entsperren</button>' : ''}
            <button type="button" class="btn danger" id="kuDel">${x.status === 'wartend' ? 'Anfrage ablehnen' : 'Konto löschen'}</button></div>`
          : !neu && x.status === 'wartend' ? '<div class="kt-btns"><button type="button" class="btn danger" id="kuDel">Anfrage ablehnen</button></div>' : ''}
        <p class="kt-msg" id="kuMsg"></p>`,
        `<button class="btn secondary" id="kuBack">Zurück</button>${false ? '' : `<button class="btn" id="kuSave">${neu ? 'Anlegen' : x.status === 'wartend' ? 'Freigeben & speichern' : 'Speichern'}</button>`}`);
      const msg = t => { $('#kuMsg').textContent = t; };
      $$('[data-kurolle]').forEach(seg => $$('button', seg).forEach(b => b.addEventListener('click', () => { sync(); apps[seg.dataset.kurolle].rolle = b.dataset.v; draw(); })));
      $('#kuBack').addEventListener('click', () => drawAdmin());
      const sync = () => { $$('[data-kurecht]').forEach(c => { const [a, r] = c.dataset.kurecht.split(':'); const s = new Set(apps[a].rechte); c.checked ? s.add(r) : s.delete(r); apps[a].rechte = [...s]; });
        $$('[data-kuhinweis]').forEach(c => { const [a, h] = c.dataset.kuhinweis.split(':'); const s = new Set(apps[a].hinweise || []); c.checked ? s.add(h) : s.delete(h); apps[a].hinweise = [...s]; }); if (neu) { x.name = $('#kuName').value; x._pw = $('#kuPw').value; } };
      if (neu) { $('#kuName').value = x.name || ''; if (x._pw) $('#kuPw').value = x._pw; }
      // Einzelrecht angehakt → passende Benachrichtigung vorauswählen (z. B. Schalenwild → Neue Wildmeldung)
      $$('[data-kurecht]').forEach(c => c.addEventListener('change', () => {
        if (!c.checked) return;
        const [a, r] = c.dataset.kurecht.split(':');
        Object.entries(inf.apps[a]?.hinweisAuto || {}).forEach(([h, rs]) => { const box = $(`[data-kuhinweis="${a}:${h}"]`); if (rs.includes(r) && box) box.checked = true; });
      }));
      $('#kuSave')?.addEventListener('click', async e => {
        sync();
        const eigeneApps = Object.entries(apps).filter(([a]) => me.super || me.apps?.[a]?.rolle === 'admin');
        const ch = x.super ? {} : Object.fromEntries(eigeneApps.map(([a, v]) => [a, { rolle: v.rolle, rechte: v.rolle === 'ansehen' ? v.rechte : [] }]));
        const hw = Object.fromEntries(eigeneApps.map(([a, v]) => [a, v.rolle === 'kein' ? [] : (v.hinweise || [])]));
        const btn = e.currentTarget; btn.disabled = true;
        try {
          if (neu) {
            if ((x.name || '').trim().split(/\s+/).length < 2) throw new Error('Bitte Vor- und Nachnamen eintragen.');
            await api('POST', '/admin/konto-neu', { name: x.name, pw: x._pw, apps: ch, hinweise: hw });
            toast(`Konto ${x.name.trim()} angelegt ✓ – Startpasswort weitergeben.`, 4500);
          } else {
            await api('POST', '/admin/konto', { id: x.id, apps: ch, hinweise: hw, ...(x.status === 'wartend' ? { status: 'aktiv' } : {}) });
            toast(x.status === 'wartend' ? 'Freigegeben ✓' : 'Gespeichert ✓');
          }
          await openAdmin();
        } catch (err) { msg(err.message); btn.disabled = false; }
      });
      $('#kuSetPw')?.addEventListener('click', async () => {
        try { await api('POST', '/admin/konto', { id: x.id, neuesPw: $('#kuNeuPw').value }); toast('Neues Passwort gesetzt ✓', 3500); } catch (err) { msg(err.message); }
      });
      const setStatus = async s => { try { await api('POST', '/admin/konto', { id: x.id, status: s }); toast(s === 'gesperrt' ? 'Gesperrt.' : 'Entsperrt.'); await openAdmin(); } catch (err) { msg(err.message); } };
      $('#kuLock')?.addEventListener('click', e => { const b = e.currentTarget; if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Wirklich sperren?'; return; } setStatus('gesperrt'); });
      $('#kuUnlock')?.addEventListener('click', () => setStatus('aktiv'));
      $('#kuDel')?.addEventListener('click', async e => {
        const b = e.currentTarget; if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Nochmal tippen zum Bestätigen'; return; }
        try { await api('DELETE', '/admin/konto?id=' + encodeURIComponent(x.id)); toast(x.status === 'wartend' ? 'Anfrage abgelehnt.' : 'Konto gelöscht.'); await openAdmin(); } catch (err) { msg(err.message); }
      });
    };
    draw();
  }
  function vorschlagPw() {
    const w = ['Hirsch', 'Fasan', 'Keiler', 'Dachs', 'Ricke', 'Hase', 'Fuchs', 'Kanzel', 'Pirsch', 'Ansitz'];
    const a = crypto.getRandomValues(new Uint32Array(3));
    return `${w[a[0] % w.length]}${w[a[1] % w.length].toLowerCase()}${100 + (a[2] % 900)}`;
  }
  async function openProtokoll() {
    let j; try { j = await api('GET', '/admin/protokoll?n=200'); } catch (e) { toast(e.message, 4000); return; }
    const dt = iso => new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
    sheet('Protokoll', `<p class="hint">Wer hat wann was geändert (neueste zuerst). Jede Änderung steht zusätzlich mit Namen im GitHub-Verlauf und lässt sich von dort wiederherstellen.</p>
      ${j.eintraege.length ? `<ul class="kt-log">${j.eintraege.map(e => `<li><b>${esc(e.wer)}</b> · ${esc(e.was)}<small>${dt(e.zeit)}${e.app && e.app !== '-' ? ' · ' + esc(appName(e.app)) : ''}</small></li>`).join('')}</ul>` : '<p class="hint">Noch keine Einträge.</p>'}`,
      '<button class="btn secondary" id="klBack">Zurück</button>');
    $('#klBack').addEventListener('click', () => drawAdmin());
  }

  /* ---------- Push ---------- */
  const LSP = (CFG.lsPrefix || '') + 'konto.push.v1';
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  async function currentSub() { try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch { return null; } }
  async function pushEnable() {
    if (!hatZugang()) throw new Error('Benachrichtigungen gibt es nur mit freigegebenem Konto – bitte zuerst anmelden.');
    if (!pushSupported()) throw new Error(isIOS() && !standalone() ? 'Auf dem iPhone geht das nur in der installierten App (Home-Bildschirm).' : 'Dieser Browser unterstützt keine Benachrichtigungen.');
    const p = await Notification.requestPermission();
    if (p !== 'granted') throw new Error('Benachrichtigungen nicht erlaubt – änderbar in den Handy-Einstellungen.');
    const { vapid } = await info(true);
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(vapid) });
    await api('POST', '/push/abo', { app: APP, sub: sub.toJSON() }, { auth: true });
    sv(LSP, { endpoint: sub.endpoint, t: Date.now() });
    return true;
  }
  async function pushDisable() {
    const sub = await currentSub();
    if (sub) { try { await api('POST', '/push/abmelden', { app: APP, endpoint: sub.endpoint }); } catch { /* egal */ } await sub.unsubscribe().catch(() => {}); }
    sv(LSP, null);
  }
  async function pushTest() {
    const sub = await currentSub(); if (!sub) throw new Error('Dieses Gerät ist nicht angemeldet.');
    const j = await api('POST', '/push/test', { app: APP, endpoint: sub.endpoint });
    if (!j.ok) throw new Error('Senden fehlgeschlagen (' + j.status + ').');
  }
  /** Admin: Nachricht an alle angemeldeten Geräte dieser App */
  async function pushSend(msg) {
    const rechte = st.user?.apps?.[APP]?.rechte || [];
    if (!CFG.push || !(isAdmin() || (hatZugang() && rechte.length))) return null;
    try { return await api('POST', '/push/senden', { app: APP, url: location.origin + location.pathname, ...msg }); } catch { return null; }
  }
  /** Hinweis an die zuständigen Personen (z. B. „Salzlecke leer gemeldet“) */
  async function hinweis(msg) {
    if (!loggedIn()) return null;
    try { return await api('POST', '/hinweis', { app: APP, url: location.origin + location.pathname, ...msg }); } catch { return null; }
  }
  /** Abo beim Start auffrischen (falls der Browser es erneuert hat) */
  async function pushKeepAlive() {
    if (!CFG.push || !pushSupported() || Notification.permission !== 'granted' || !ld(LSP, null)) return;
    const sub = await currentSub();
    const saved = ld(LSP, null);
    if (sub && (sub.endpoint !== saved.endpoint || Date.now() - saved.t > 7 * 864e5)) { try { await api('POST', '/push/abo', { app: APP, sub: sub.toJSON() }); sv(LSP, { endpoint: sub.endpoint, t: Date.now() }); } catch { /* später */ } }
    if (!sub) { try { await pushEnable(); } catch { /* egal */ } }
  }
  function b64uToBytes(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
  function pushText(an) {
    const eigene = Object.entries(inf?.apps || {}).flatMap(([a, x]) => (st.user?.apps?.[a]?.hinweise || []).map(h => x.hinweise?.[h]).filter(Boolean));
    const extra = eigene.length ? ` Außerdem, weil du dafür eingetragen bist: ${eigene.join(', ')}.` : '';
    if (APP === 'thuine') return (an ? 'Dieses Gerät bekommt Hinweise zu Terminen, Damwild-Freigabe, erlegtem Damwild und Hirschjagd-Sperre.' : 'Hinweise zu neuen Terminen, Damwild-Freigabe, erlegtem Damwild und Hirschjagd-Sperre – auch wenn die App zu ist.') + extra;
    return (an ? 'Dieses Gerät bekommt Benachrichtigungen.' : 'Benachrichtigungen auch bei geschlossener App.') + (extra || ' Welche du bekommst, legt Sebastian unter „Konten verwalten“ fest.');
  }
  async function drawPushBox(box) {
    if (!pushSupported()) {
      box.innerHTML = `<p class="hint" style="margin:0">🔔 Benachrichtigungen: ${isIOS() && !standalone() ? 'Auf dem iPhone nur in der installierten App (Teilen → „Zum Home-Bildschirm“).' : 'von diesem Browser nicht unterstützt.'}</p>`;
      return;
    }
    const sub = await currentSub();
    const an = !!sub && Notification.permission === 'granted';
    box.innerHTML = `<div class="kt-box"><h3>🔔 Benachrichtigungen ${an ? '<span class="kt-tag">an</span>' : ''}</h3>
      <p class="hint" style="margin:0">${pushText(an)}</p>
      <div class="kt-btns">${an ? '<button type="button" class="btn secondary" id="ktPushTest">Test senden</button><button type="button" class="btn ghost" id="ktPushOff">Ausschalten</button>' : '<button type="button" class="btn" id="ktPushOn">Benachrichtigungen erlauben</button>'}</div></div>`;
    $('#ktPushOn', box)?.addEventListener('click', async e => { e.currentTarget.disabled = true; try { await pushEnable(); toast('Benachrichtigungen an ✓'); } catch (err) { toast(err.message, 5000); } drawPushBox(box); });
    $('#ktPushOff', box)?.addEventListener('click', async () => { await pushDisable(); toast('Benachrichtigungen aus.'); drawPushBox(box); });
    $('#ktPushTest', box)?.addEventListener('click', async () => { try { await pushTest(); toast('Test gesendet – kommt die Nachricht?'); } catch (err) { toast(err.message, 4500); } });
  }
  /** Zähler am App-Symbol zurücksetzen (beim Öffnen der App) */
  function clearBadge() {
    try { navigator.serviceWorker?.controller?.postMessage('badge0'); } catch { /* egal */ }
    if (H.badge) H.badge(); else { try { navigator.clearAppBadge?.().catch(() => {}); } catch { /* egal */ } }
  }

  /* ---------- Start ---------- */
  function init(opts) {
    H = Object.assign({}, opts);
    injectStyle();
    if (CFG.test && !$('#ktTest')) document.body.insertAdjacentHTML('beforeend', '<div id="ktTest">TEST</div>');
    if (!enabled()) return;
    if (st.token) refresh();
    info(true).catch(() => {});
    pushKeepAlive();
    clearBadge();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      clearBadge();
      if (st.token && Date.now() - (init._r || 0) > 10 * 60e3) { init._r = Date.now(); refresh(); }
    });
  }
  const nurKonten = () => !!(inf?.nurKonten || CFG.nurKonto);
  /** Foto-Auswertung über den Server (Schlüssel bleibt dort) */
  const kiServer = () => !!(inf?.ki && can('jagdtage'));
  const ki = (bild, text, signal) => api('POST', '/ki/erlegerliste', { bild, text }, { signal });
  /** Beim App-Start: wer angemeldet ist und noch keine Benachrichtigungen hat, wird gefragt (bei „Später“ erst nach 7 Tagen wieder) */
  const LSF = (CFG.lsPrefix || '') + 'konto.pushfrage.v1';
  function pushFrageStart() {
    if (!CFG.push || !loggedIn()) return;
    let t = 0; try { t = +localStorage.getItem(LSF) || 0; } catch {}
    if (Date.now() - t < 7 * 864e5) return;
    try { localStorage.setItem(LSF, String(Date.now())); } catch {}
    setTimeout(() => { if (!document.querySelector('#sheet:not([hidden]), dialog[open]')) pushFrage(); }, 1500);
  }

  return { init, enabled, loggedIn, beantragt, user, rolle, isAdmin, isAnyAdmin, hatZugang, can, token, ghBase, dataPw, refresh, abmelden, setDataPw, info, nurKonten,
    openLogin, openAdmin, pushFrage, pushFrageStart, settingsHtml, wireSettings, pushSend, hinweis, kiServer, ki, pushEnable, pushSupported, clearBadge };
})();
