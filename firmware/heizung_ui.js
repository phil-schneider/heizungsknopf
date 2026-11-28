// Heizungs-Knopf – eigene Weboberfläche (wird von ESPHome als /0.js ausgeliefert)
// Nutzt die ESPHome-REST-Schnittstelle und den Ereignisstrom /events.
(() => {
  const WT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const WT_LANG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const S = {};            // Zustände nach id ("number/Stufe" …)
  let st = {};             // geparster Status (JSON vom Gerät)
  let seite = 'start';     // 'start' | 'einst'
  let verbunden = false;
  let dlg = null;          // offener Dialog: {typ:'tag'|'urlaub', …}

  // ---------- Helfer ----------
  const $ = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const val = (id, d) => (S[id] && S[id].value !== undefined ? S[id].value : d);
  const num = (id, d) => { const v = parseFloat(val(id, NaN)); return isNaN(v) ? d : v; };
  const p2 = (n) => String(n).padStart(2, '0');
  const stufeTxt = (s) => (s <= 0 ? '✱' : String(s));
  const hhmm = (ts) => { const d = new Date(ts * 1000); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const datum = (ts) => { const d = new Date(ts * 1000); return WT[(d.getDay() + 6) % 7] + ' ' + p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.'; };
  const farbe = (s) => { const a = [58, 44, 36], b = [255, 138, 42], f = s / 7; return 'rgb(' + a.map((x, i) => Math.round(x + (b[i] - x) * f)).join(',') + ')'; };

  async function post(domain, name, method, params) {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    try {
      const r = await fetch('/' + domain + '/' + encodeURIComponent(name) + '/' + method + q, { method: 'POST' });
      if (!r.ok) meldung('Fehler ' + r.status);
      return r.ok;
    } catch (e) { meldung('Keine Verbindung'); return false; }
  }
  const setNum = (name, v) => post('number', name, 'set', { value: v });
  const sw = (name, an) => post('switch', name, an ? 'turn_on' : 'turn_off');
  const druck = (name) => post('button', name, 'press');

  let mTimer;
  function meldung(t) {
    let m = document.getElementById('hz-toast');
    if (!m) { m = $('<div id="hz-toast"></div>'); document.body.appendChild(m); }
    m.textContent = t; m.className = 'an';
    clearTimeout(mTimer); mTimer = setTimeout(() => (m.className = ''), 2500);
  }

  // ---------- Wochenplan ----------
  function parsePlan(txt) {
    const out = [];
    (txt || '').split(/[\s,;]+/).forEach((e) => {
      const m = /^(\d{1,2}):(\d{2})=(\d)$/.exec(e);
      if (m && +m[1] < 24 && +m[2] < 60 && +m[3] <= 7) out.push({ min: +m[1] * 60 + +m[2], l: +m[3] });
    });
    return out.sort((a, b) => a.min - b.min).slice(0, 6);
  }
  const planTxt = (arr) => arr.slice().sort((a, b) => a.min - b.min).map((w) => p2(Math.floor(w.min / 60)) + ':' + p2(w.min % 60) + '=' + w.l).join(' ');
  const planTag = (d) => parsePlan(val('text/Plan ' + WT[d], ''));
  function letzteStufeVor(d) {            // Stufe, die um 00:00 von Tag d gilt
    for (let b = 1; b <= 7; b++) { const p = planTag((d - b + 7) % 7); if (p.length) return p[p.length - 1].l; }
    return null;
  }
  function leiste(arr, start, hoch) {
    let h = '<div class="leiste" style="height:' + hoch + 'px">';
    const pts = [{ min: 0, l: start }].concat(arr);
    pts.forEach((w, i) => {
      const ende = i + 1 < pts.length ? pts[i + 1].min : 1440;
      const b = ((ende - w.min) / 1440) * 100;
      if (b <= 0) return;
      const leer = w.l === null || w.l === undefined;
      h += '<div style="width:' + b + '%;background:' + (leer ? 'var(--feld)' : farbe(w.l)) + ';color:' + (w.l >= 4 ? '#111' : '#ddd') + '">' + (b > 6 && !leer ? stufeTxt(w.l) : '') + '</div>';
    });
    return h + '</div>';
  }

  // ---------- Darstellung ----------
  function oled() {
    const s = st.s || 0, t = num('sensor/Raumtemperatur', NaN);
    let balken = '';
    for (let i = 0; i < 7; i++) balken += '<i class="' + (i < s ? 'v' : '') + '" style="height:' + (10 + i * 6) + 'px"></i>';
    let fuss;
    if (st.tm) fuss = '🔧 Testmodus<small>' + Math.round(num('sensor/Knopfwinkel', 0)) + '°</small>';
    else if (st.hl) fuss = 'Referenzfahrt…';
    else if (st.hf) fuss = '⚠ Referenz?';
    else if (st.be) fuss = '🔥 Boost bis ' + hhmm(st.be) + '<small>→ ' + stufeTxt(st.b) + '</small>';
    else if (st.ue) fuss = '🧳 Urlaub bis ' + datum(st.ue).slice(3);
    else if (!st.zp) fuss = '<s>◷</s> Zeitplan aus';
    else if (st.nt) fuss = '◷ ' + (st.nd ? st.nd + ' ' : '') + st.nt + ' → Stufe ' + stufeTxt(st.ns) + (st.ov ? '<small>manuell</small>' : '');
    else fuss = '◷ kein Wechsel';
    const uhr = st.t ? hhmm(st.t) : '--:--';
    return '<div class="oled"><div class="ok"><span>' + (verbunden ? '▂▄▆' : '✕') + '</span><span>' + uhr + '</span></div>' +
      '<div class="om"><b>' + stufeTxt(s) + '</b><span class="bk">' + balken + '</span><em>' + (isNaN(t) ? '--' : t.toFixed(1).replace('.', ',')) + '°</em></div>' +
      '<div class="of">' + fuss + '</div></div>';
  }

  function start() {
    const s = st.s || 0;
    let h = '<h1>Heizung</h1><p class="sub">' + untertitel() + '</p>';
    h += '<div class="k">' + oled() + '</div>';

    if (st.tm) {
      const w = Math.round(num('sensor/Knopfwinkel', 0)), pos = num('sensor/Motorposition', 0);
      h += '<div class="k"><div class="kt or">Motortest<span>' + w + '° am Knopf · ' + pos + ' Schritte</span></div>' +
        '<div class="zl"><button data-a="btn" data-v="Test minus 90">−90°</button><button data-a="btn" data-v="Test minus 10">−10°</button>' +
        '<button data-a="btn" data-v="Test plus 10">+10°</button><button data-a="btn" data-v="Test plus 90">+90°</button></div>' +
        '<div class="ez"><span>Position (% von max.)</span><input type="number" inputmode="decimal" data-n="Test Position" min="0" max="100" step="1" value="' + num('number/Test Position', 0) + '"></div>' +
        '<div class="zl"><button class="rot" data-a="btn" data-v="Test Stopp">Stopp</button><button data-a="btn" data-v="Test Nullpunkt">Nullpunkt hier</button></div>' +
        '<p class="kl">Grad am Knopf, + = wärmer. Der Motor dreht 1,55-mal so weit. Wochenplan und Stufen bewegen den Motor im Testmodus nicht.</p>' +
        '<button class="voll" data-a="sw" data-v="Testmodus">Testmodus beenden (startet Referenzfahrt)</button></div>';
    }

    if (st.be) {
      const rest = Math.max(0, Math.round((st.be - (st.t || Date.now() / 1000)) / 60));
      h += '<div class="k"><div class="kt or">Boost läuft<span>noch ' + rest + ' min</span></div>' +
        '<div class="zl"><button data-a="boostplus">+30 min</button><button class="rot" data-a="boostaus">Beenden</button></div></div>';
    }
    if (st.ue) {
      h += '<div class="k"><div class="kt">Urlaub aktiv<span>noch ' + num('number/Urlaub Tage', 0) + ' Tage</span></div>' +
        '<p>bis ' + datum(st.ue) + ' · heizt ab ' + hhmm(st.ue) + ' · Stufe ' + stufeTxt(num('number/Urlaub Stufe', 1)) + '</p>' +
        '<div class="zl"><button data-a="urlaub">Ändern</button><button class="rot" data-a="urlaubaus">Beenden</button></div></div>';
    }

    let hinweis = 'bleibt bis zur Änderung';
    if (st.be) hinweis = 'antippen beendet den Boost';
    else if (st.ue) hinweis = 'Urlaubsstufe';
    else if (st.zp && st.nt) hinweis = 'gilt bis ' + (st.nd ? st.nd + ' ' : '') + st.nt;
    h += '<div class="k"><div class="kt">Stufe<span>' + hinweis + '</span></div><div class="stufen">';
    for (let i = 0; i <= 7; i++) h += '<button data-a="stufe" data-v="' + i + '"' + (i === s ? ' class="an" style="background:' + farbe(i) + '"' : '') + '>' + stufeTxt(i) + '</button>';
    h += '</div><p class="kl">✱ = nur Zündflamme</p></div>';

    h += '<div class="k"><div class="kt">Betrieb' + (st.ue ? '<span>pausiert bis ' + datum(st.ue).slice(3) + '</span>' : '') + '</div><div class="seg">' +
      '<button data-a="zp" data-v="1"' + (st.zp ? ' class="an"' : '') + '>' + (st.zp ? '✓ ' : '') + 'Wochenplan</button>' +
      '<button data-a="zp" data-v="0"' + (!st.zp ? ' class="an"' : '') + '>' + (!st.zp ? '✓ ' : '') + 'Manuell</button></div></div>';

    if (!st.be) {
      h += '<div class="k"><div class="kt">Boost<span>Stufe ' + num('number/Boost Stufe', 7) + ', danach zurück</span></div><div class="zl">' +
        '<button class="bo" data-a="boost" data-v="30">30 min</button><button class="bo" data-a="boost" data-v="60">1 h</button><button class="bo" data-a="boost" data-v="120">2 h</button></div></div>';
    }
    if (!st.ue) h += '<div class="k"><div class="kt">Urlaub<span>aus</span></div><div class="zl"><button data-a="urlaub">Urlaub planen …</button></div></div>';

    // Wochenplan
    const jetzt = st.t ? new Date(st.t * 1000) : new Date();
    const heute = (jetzt.getDay() + 6) % 7, pos = ((jetzt.getHours() * 60 + jetzt.getMinutes()) / 1440) * 100;
    h += '<div class="k"><div class="kt">Wochenplan<span>antippen zum Bearbeiten</span></div>';
    for (let d = 0; d < 7; d++) {
      const p = planTag(d);
      h += '<div class="tag' + (d === heute ? ' heute' : '') + '" data-a="tag" data-v="' + d + '"><b>' + WT[d] + '</b><div class="tl">' + leiste(p, letzteStufeVor(d), 20) +
        (d === heute ? '<u style="left:' + pos + '%"></u>' : '') + '<small>' + (p.length ? p.map((w) => p2(Math.floor(w.min / 60)) + ':' + p2(w.min % 60)).join(' · ') : 'kein Wechsel') + '</small></div></div>';
    }
    h += '<div class="achse"><span>0</span><span>6</span><span>12</span><span>18</span><span>24 h</span></div></div>';
    h += '<div class="k zeile" data-a="einst"><span>Einstellungen</span><span>›</span></div>';
    return h;
  }

  function untertitel() {
    const t = num('sensor/Raumtemperatur', NaN), temp = isNaN(t) ? '' : ' · Raum ' + t.toFixed(1).replace('.', ',') + ' °C';
    if (!verbunden) return 'Verbindung wird aufgebaut …';
    if (st.tm) return 'Testmodus – Motor wird von Hand gesteuert' + (st.tu === 0 ? ' · Treiber antwortet nicht (UART)' : '');
    if (st.hl) return 'Referenzfahrt läuft';
    if (st.hf) return 'Fehler: Referenzfahrt fehlgeschlagen';
    if (st.tu === 0) return 'Warnung: Motortreiber antwortet nicht (UART)';
    if (st.be) return 'Boost aktiv bis ' + hhmm(st.be);
    if (st.ue) return 'Urlaub bis ' + datum(st.ue);
    if (!st.zp) return 'Manuell · Wochenplan pausiert' + temp;
    return 'Wochenplan aktiv' + (st.ov ? ' · manuell geändert' : '') + temp;
  }

  const EINST = [
    ['Boost & Urlaub'],
    ['Boost – Stufe', 'number', 'Boost Stufe', 1, 7, 1],
    ['Urlaub – Stufe', 'number', 'Urlaub Stufe', 0, 7, 1],
    ['Urlaub – heizen ab', 'time', 'Urlaub Heizen ab'],
    ['Anzeige'],
    ['Display-Helligkeit (%)', 'number', 'Helligkeit', 10, 100, 10],
    ['Temperatur-Korrektur (°C)', 'number', 'Temperatur Korrektur', -15, 5, 0.5],
    ['Brenner-Schwelle (°C)', 'number', 'Brenner Schwelle', 25, 80, 1],
    ['Mechanik (Schritte ab Anschlag ✱)'],
    ['Position ✱', 'number', 'Position Stern', 0, 1000, 1],
    ['Position Stufe 1', 'number', 'Position Stufe 1', 0, 3000, 1],
    ['Schritte pro Stufe (1 → 7)', 'number', 'Schritte pro Stufe', 10, 1000, 1],
    ['Maximale Position', 'number', 'Maximale Position', 100, 4000, 10],
    ['Richtung umkehren', 'switch', 'Richtung umkehren'],
    ['Referenzfahrt – Strom (%)', 'number', 'Referenz Strom', 20, 100, 5],
    ['Tägliche Referenzfahrt', 'switch', 'Referenz taeglich'],
    ['Referenzfahrt um', 'time', 'Referenz Uhrzeit'],
    ['Referenzfahrt jetzt', 'button', 'Referenzfahrt', 'Starten'],
    ['Motortest (ohne Aufsatz)'],
    ['Testmodus', 'switch', 'Testmodus'],
    ['Test-Strom (%)', 'number', 'Test Strom', 20, 100, 5],
    ['Test-Tempo (Schritte/s)', 'number', 'Test Tempo', 50, 1500, 50],
    ['Diagnose'],
    ['Luftfeuchte', 'info', 'sensor/Luftfeuchte'],
    ['Ofentemperatur', 'info', 'sensor/Ofentemperatur'],
    ['Brenner', 'info', 'binary_sensor/Brenner'],
    ['Motortreiber (UART)', 'info', 'binary_sensor/Treiber UART'],
    ['Motorposition', 'info', 'sensor/Motorposition'],
    ['WLAN', 'info', 'sensor/WLAN Signal'],
    ['IP-Adresse', 'info', 'text_sensor/IP'],
    ['Gerät', 'button', 'Neustart', 'Neustart'],
    ['Firmware-Update'],
    ['Datei im OTA-Format (…ota.bin)', 'fw'],
  ];
  function einst() {
    let h = '<h1><a data-a="zurueck">←</a> Einstellungen</h1>', offen = false;
    EINST.forEach((e) => {
      if (e.length === 1) { h += (offen ? '</div>' : '') + '<div class="k"><div class="kt">' + e[0] + '</div>'; offen = true; return; }
      const [lab, typ, name] = e;
      let r = '';
      if (typ === 'number') r = '<input type="number" inputmode="decimal" data-n="' + esc(name) + '" min="' + e[3] + '" max="' + e[4] + '" step="' + e[5] + '" value="' + num('number/' + name, '') + '">';
      else if (typ === 'time') r = '<input type="time" data-t="' + esc(name) + '" value="' + String(val('time/' + name, '')).slice(0, 5) + '">';
      else if (typ === 'switch') r = '<button class="sw' + (val('switch/' + name, false) ? ' an' : '') + '" data-a="sw" data-v="' + esc(name) + '"><i></i></button>';
      else if (typ === 'button') r = '<button class="kl" data-a="btn" data-v="' + esc(name) + '">' + e[3] + '</button>';
      else if (typ === 'fw') r = '<button class="kl" data-a="fw">Datei wählen …</button>';
      else r = '<span class="grau">' + esc(S[name] ? S[name].state : '–') + '</span>';
      h += '<div class="ez"><span>' + lab + '</span>' + r + '</div>';
    });
    h += '</div><div class="k zeile" data-a="esp"><span>ESPHome-Standardliste anzeigen</span><span>›</span></div>';
    return h;
  }

  // ---------- Dialoge ----------
  function tagDialog() {
    const d = dlg;
    let h = '<div class="blatt"><h2>' + WT_LANG[d.tag] + '<a data-a="zu">✕</a></h2><div class="kt">Wechsel</div>';
    d.arr.forEach((w, i) => {
      h += '<div class="wz"><input type="time" data-w="' + i + '" value="' + p2(Math.floor(w.min / 60)) + ':' + p2(w.min % 60) + '">' +
        '<button class="rd" data-a="wl" data-v="' + i + ',-1">−</button><b>Stufe ' + stufeTxt(w.l) + '</b><button class="rd" data-a="wl" data-v="' + i + ',1">+</button>' +
        '<i style="width:' + (w.l * 9 + 4) + 'px;background:' + farbe(w.l) + '"></i><button class="rd weg" data-a="wd" data-v="' + i + '">🗑</button></div>';
    });
    if (d.arr.length < 6) h += '<button class="voll bl" data-a="wn">+ Wechsel hinzufügen (max. 6)</button>';
    h += '<p class="kl">Vorschau</p>' + leiste(d.arr.slice().sort((a, b) => a.min - b.min), letzteStufeVor(d.tag), 24);
    h += '<div class="kt" style="margin-top:16px">Übernehmen für</div><div class="chips">';
    for (let i = 0; i < 7; i++) if (i !== d.tag) h += '<button data-a="wk" data-v="' + i + '"' + (d.kopie.has(i) ? ' class="an"' : '') + '>' + WT[i] + '</button>';
    h += '</div><div class="zl"><button data-a="wkw">Alle Werktage</button><button data-a="wka">Ganze Woche</button></div>';
    h += '<button class="voll pr" data-a="ws">Speichern</button></div>';
    return h;
  }
  function urlaubDialog() {
    const d = dlg, heute = new Date(); heute.setHours(0, 0, 0, 0);
    const m0 = new Date(d.jahr, d.monat, 1), tage = new Date(d.jahr, d.monat + 1, 0).getDate(), versatz = (m0.getDay() + 6) % 7;
    let h = '<div class="blatt"><h2>Urlaub planen<a data-a="zu">✕</a></h2><p class="kl">Rückkehr wählen</p>' +
      '<div class="km"><b>' + m0.toLocaleDateString('de-CH', { month: 'long', year: 'numeric' }) + '</b><span><button class="rd" data-a="um" data-v="-1">‹</button><button class="rd" data-a="um" data-v="1">›</button></span></div><div class="kal">';
    WT.forEach((w) => (h += '<small>' + w + '</small>'));
    for (let i = 0; i < versatz; i++) h += '<span></span>';
    for (let t = 1; t <= tage; t++) {
      const dt = new Date(d.jahr, d.monat, t), n = Math.round((dt - heute) / 864e5);
      const cls = n <= 0 ? (n === 0 ? 'heute' : 'alt') : n > 60 ? 'alt' : n === d.tage ? 'ziel' : n < d.tage ? 'zw' : '';
      h += '<button class="' + cls + '"' + (n > 0 && n <= 60 ? ' data-a="ud" data-v="' + n + '"' : ' disabled') + '>' + t + '</button>';
    }
    const ziel = new Date(heute.getTime()); ziel.setDate(ziel.getDate() + d.tage);
    h += '</div><div class="ez"><span>Heizen ab</span><input type="time" id="hz-uz" value="' + d.zeit + '"></div>' +
      '<div class="ez"><span>Stufe während Urlaub</span><span><button class="rd" data-a="us" data-v="-1">−</button> <b>' + stufeTxt(d.stufe) + '</b> <button class="rd" data-a="us" data-v="1">+</button></span></div>' +
      '<div class="ez"><span>Dauer</span><span class="grau">' + d.tage + (d.tage === 1 ? ' Tag' : ' Tage') + ' · bis ' + datum(ziel.getTime() / 1000) + '</span></div>' +
      '<div class="zl"><button data-a="zu">Abbrechen</button><button class="pr" data-a="ustart">Urlaub starten</button></div></div>';
    return h;
  }

  // ---------- Zeichnen ----------
  let wurzel, dlgEl, geplant = false;
  function zeichne() {
    geplant = false;
    if (!wurzel) return;
    const akt = document.activeElement;
    if (akt && wurzel.contains(akt) && akt.tagName === 'INPUT') return;   // Eingabe nicht stören
    wurzel.innerHTML = seite === 'einst' ? einst() : start();
  }
  const plane = () => { if (!geplant) { geplant = true; setTimeout(zeichne, 80); } };
  function zeichneDlg() {
    dlgEl.className = dlg ? 'an' : '';
    dlgEl.innerHTML = dlg ? (dlg.typ === 'tag' ? tagDialog() : urlaubDialog()) : '';
  }
  function dlgLesen() {     // Eingabefelder in den Dialog-Zustand übernehmen
    if (!dlg) return;
    if (dlg.typ === 'tag') dlgEl.querySelectorAll('input[data-w]').forEach((i) => { const [a, b] = i.value.split(':'); if (b !== undefined) dlg.arr[+i.dataset.w].min = +a * 60 + +b; });
    else { const z = document.getElementById('hz-uz'); if (z && z.value) dlg.zeit = z.value; }
  }

  // ---------- Aktionen ----------
  async function aktion(a, v) {
    switch (a) {
      case 'stufe': await setNum('Stufe', v); break;
      case 'zp': await sw('Zeitplan', v === '1'); break;
      case 'boost': await setNum('Boost Dauer', v); await sw('Boost', true); break;
      case 'boostplus': await druck('Boost plus 30'); break;
      case 'boostaus': await sw('Boost', false); break;
      case 'urlaubaus': await setNum('Urlaub Tage', 0); break;
      case 'einst': seite = 'einst'; scrollTo(0, 0); zeichne(); break;
      case 'zurueck': seite = 'start'; zeichne(); break;
      case 'sw': await sw(v, !val('switch/' + v, false)); break;
      case 'btn': if (v !== 'Neustart' || confirm('Gerät neu starten?')) { await druck(v); meldung('Gesendet'); } break;
      case 'fw': fwIn.click(); break;
      case 'esp': if (!document.querySelector('esp-app')) document.body.appendChild(document.createElement('esp-app')); break;
      case 'tag': dlg = { typ: 'tag', tag: +v, arr: planTag(+v), kopie: new Set() }; zeichneDlg(); break;
      case 'urlaub': {
        const n = new Date(), t = st.ue ? Math.max(1, num('number/Urlaub Tage', 7)) : 7;
        const z = new Date(); z.setDate(z.getDate() + t);
        dlg = { typ: 'urlaub', tage: t, jahr: z.getFullYear(), monat: z.getMonth(), stufe: num('number/Urlaub Stufe', 1), zeit: String(val('time/Urlaub Heizen ab', '12:00')).slice(0, 5) };
        void n; zeichneDlg(); break;
      }
      case 'zu': dlg = null; zeichneDlg(); break;
      // Tag bearbeiten
      case 'wl': { dlgLesen(); const [i, r] = v.split(',').map(Number); dlg.arr[i].l = Math.min(7, Math.max(0, dlg.arr[i].l + r)); zeichneDlg(); break; }
      case 'wd': dlgLesen(); dlg.arr.splice(+v, 1); zeichneDlg(); break;
      case 'wn': { dlgLesen(); const l = dlg.arr.length ? dlg.arr[dlg.arr.length - 1] : { min: 5 * 60, l: 3 }; dlg.arr.push({ min: Math.min(1439, l.min + 60), l: l.l }); zeichneDlg(); break; }
      case 'wk': dlgLesen(); dlg.kopie.has(+v) ? dlg.kopie.delete(+v) : dlg.kopie.add(+v); zeichneDlg(); break;
      case 'wkw': dlgLesen(); [0, 1, 2, 3, 4].forEach((i) => i !== dlg.tag && dlg.kopie.add(i)); zeichneDlg(); break;
      case 'wka': dlgLesen(); [0, 1, 2, 3, 4, 5, 6].forEach((i) => i !== dlg.tag && dlg.kopie.add(i)); zeichneDlg(); break;
      case 'ws': {
        dlgLesen();
        const txt = planTxt(dlg.arr), ziele = [dlg.tag].concat([...dlg.kopie]);
        dlg = null; zeichneDlg();
        let ok = true;
        for (const d of ziele) ok = (await post('text', 'Plan ' + WT[d], 'set', { value: txt })) && ok;
        if (ok) meldung('Gespeichert');
        break;
      }
      // Urlaub
      case 'um': { dlgLesen(); const d = new Date(dlg.jahr, dlg.monat + +v, 1); dlg.jahr = d.getFullYear(); dlg.monat = d.getMonth(); zeichneDlg(); break; }
      case 'ud': dlgLesen(); dlg.tage = +v; zeichneDlg(); break;
      case 'us': dlgLesen(); dlg.stufe = Math.min(7, Math.max(0, dlg.stufe + +v)); zeichneDlg(); break;
      case 'ustart': {
        dlgLesen();
        const d = dlg; dlg = null; zeichneDlg();
        await post('time', 'Urlaub Heizen ab', 'set', { value: d.zeit + ':00' });
        await setNum('Urlaub Stufe', d.stufe);
        if (await setNum('Urlaub Tage', d.tage)) meldung('Urlaub gestartet');
        break;
      }
    }
  }

  // ---------- Firmware-Update (ESPHome web_server OTA, POST /update) ----------
  let fwLaeuft = false, fwIn = null;   // Dateiauswahl liegt ausserhalb von #hz, damit Neuzeichnen sie nicht löscht
  function fwUpdate(f) {
    if (fwLaeuft) return;
    if (!/\.bin$/i.test(f.name)) { alert('Bitte eine .bin-Datei wählen.'); return; }
    if (/factory/i.test(f.name)) {
      alert('Das ist eine Datei im „Factory format“. Die ist nur für das erste Flashen per USB (web.esphome.io).\n\nFür das Update hier im Device Builder „Manual download“ → „OTA format“ wählen (Datei …ota.bin).');
      return;
    }
    if (!confirm('Firmware „' + f.name + '“ (' + Math.round(f.size / 1024) + ' kB) hochladen?\n\nDas Gerät startet danach neu. Während des Updates die Seite offen lassen und den Strom nicht trennen.')) return;
    fwLaeuft = true;
    const fd = new FormData();
    fd.append('update', f, f.name);
    const x = new XMLHttpRequest();
    x.open('POST', '/update');
    x.upload.onprogress = (e) => { if (e.lengthComputable) meldung('Update ' + Math.round((e.loaded / e.total) * 100) + ' %'); };
    x.onload = () => {
      fwLaeuft = false;
      if (x.status === 200 && /Successful/i.test(x.responseText)) meldung('Update erfolgreich – Gerät startet neu …');
      else alert('Update fehlgeschlagen: ' + (x.responseText || ('HTTP ' + x.status)));
    };
    x.onerror = () => { fwLaeuft = false; alert('Update fehlgeschlagen: keine Verbindung.'); };
    meldung('Update 0 %');
    x.send(fd);
  }

  // ---------- Start ----------
  const CSS = `
  :root{--bg:#121212;--karte:#1e1e1e;--feld:#2a2a2a;--rand:#3d3d3d;--txt:#e6e6e6;--grau:#9a9a9a;--akz:#2fa8ef;--or:#ff8a2a}
  @media(prefers-color-scheme:light){:root{--bg:#f2f3f5;--karte:#fff;--feld:#eceef1;--rand:#cfd3d9;--txt:#1b1d21;--grau:#6b7280;--akz:#0b7fc7}}
  body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.4 system-ui,Roboto,sans-serif;-webkit-tap-highlight-color:transparent}
  #hz{max-width:460px;margin:0 auto;padding:14px 10px 40px}
  #hz h1{font-size:26px;margin:6px 8px 0}#hz h1 a{cursor:pointer;margin-right:8px}.sub{color:var(--grau);font-size:13px;margin:2px 8px 14px}
  .k{background:var(--karte);border-radius:16px;padding:14px 16px;margin-bottom:12px}.k p{margin:6px 0}
  .kt{color:var(--akz);font-weight:600;font-size:16px;display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}
  .kt span{color:var(--grau);font-weight:400;font-size:12px}.kt.or{color:var(--or)}.kt.or span{color:var(--txt);font-weight:600;font-size:13px}
  .kl{color:var(--grau);font-size:12px}.grau{color:var(--grau)}
  button{font:inherit;color:var(--txt);background:var(--feld);border:1px solid var(--rand);border-radius:12px;padding:10px;cursor:pointer}
  button:active{filter:brightness(1.3)}
  .zl{display:flex;gap:10px}.zl button{flex:1}
  .rot{background:#3a1c1c;border-color:#d9534f;color:#ff8f8a;font-weight:600}.bo{background:#3a2416;border-color:var(--or);color:var(--or);font-weight:600}
  .pr{background:var(--akz);border-color:var(--akz);color:#06131c;font-weight:600}.bl{background:transparent;border-color:var(--akz);color:var(--akz)}
  .voll{display:block;width:100%;margin-top:12px;padding:13px}
  .stufen{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}.stufen button{padding:12px 0;font-size:18px}
  .stufen .an{border:2px solid var(--or);color:#111;font-weight:700}
  .seg{display:flex;background:var(--feld);border:1px solid var(--rand);border-radius:22px;padding:2px}
  .seg button{flex:1;border:1px solid transparent;background:none;border-radius:20px;padding:9px}.seg .an{background:#173246;border-color:var(--akz);color:var(--akz);font-weight:600}
  .oled{background:#050505;color:#f3f7ff;border-radius:10px;padding:10px 12px;font-family:"DejaVu Sans",Verdana,sans-serif}
  .ok{display:flex;justify-content:space-between;font-size:14px;border-bottom:2px solid #f3f7ff;padding-bottom:4px}.ok span:first-child{font-size:10px;letter-spacing:-1px}
  .om{display:flex;align-items:flex-end;gap:10px;padding:6px 0 8px;border-bottom:2px solid #f3f7ff}.om b{font-size:72px;line-height:.95}
  .om em{font-style:normal;font-size:44px;margin-left:auto;line-height:1.1}.bk{display:flex;align-items:flex-end;gap:4px;padding-bottom:6px}
  .bk i{width:6px;border:1.5px solid #f3f7ff;box-sizing:border-box}.bk i.v{background:#f3f7ff}
  .of{font-size:18px;padding-top:6px;display:flex;gap:6px;align-items:baseline}.of small{margin-left:auto;font-size:12px}
  .tag{display:flex;gap:10px;padding:6px 6px 4px;border-radius:10px;cursor:pointer}.tag.heute{background:rgba(47,168,239,.14)}.tag.heute>b{color:var(--akz)}
  .tag>b{width:26px;padding-top:1px}.tl{flex:1;position:relative}.tl small{color:var(--grau);font-size:11px}.tl u{position:absolute;top:-3px;width:2px;height:26px;background:var(--txt)}
  .leiste{display:flex;gap:1px;border-radius:4px;overflow:hidden}.leiste div{font-size:11.5px;font-weight:700;display:flex;align-items:center;justify-content:center;min-width:0}
  .achse{display:flex;justify-content:space-between;color:var(--grau);font-size:10px;margin:4px 6px 0 42px}
  .zeile{display:flex;justify-content:space-between;cursor:pointer}
  .ez{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--rand)}
  input{font:inherit;color:var(--txt);background:var(--feld);border:1px solid var(--rand);border-radius:8px;padding:7px 8px}input[type=number]{width:74px}
  .sw{width:46px;height:26px;border-radius:13px;padding:0;position:relative}.sw i{position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:#bdbdbd;transition:.15s}
  .sw.an{background:#17486a;border-color:var(--akz)}.sw.an i{left:23px;background:var(--akz)}
  #hz-dlg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10;align-items:flex-end;justify-content:center}#hz-dlg.an{display:flex}
  .blatt{background:var(--karte);width:100%;max-width:460px;max-height:92vh;overflow:auto;border-radius:22px 22px 0 0;padding:18px 18px 24px;box-sizing:border-box}
  .blatt h2{margin:0 0 10px;font-size:20px;display:flex;justify-content:space-between}.blatt h2 a{color:var(--grau);cursor:pointer}
  .wz{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--rand)}.wz b{min-width:62px;text-align:center}.wz i{height:14px;border-radius:3px}
  .rd{width:34px;height:34px;border-radius:50%;padding:0}.weg{margin-left:auto;border:none;background:none}
  .chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.chips button{border-radius:18px;padding:7px 15px}.chips .an{background:#173246;border-color:var(--akz);color:var(--akz);font-weight:600}
  .km{display:flex;justify-content:space-between;align-items:center}.kal{display:grid;grid-template-columns:repeat(7,1fr);row-gap:4px;margin:8px 0 12px;text-align:center}
  .kal small{color:var(--grau);padding-bottom:4px}.kal button{border:none;background:none;border-radius:0;padding:8px 0}.kal .alt{color:var(--grau);opacity:.5}
  .kal .heute{outline:1px solid var(--grau);border-radius:50%}.kal .zw{background:#173246}.kal .ziel{background:var(--akz);color:#06131c;font-weight:700;border-radius:0 18px 18px 0}
  #hz-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#333;color:#fff;padding:10px 18px;border-radius:20px;opacity:0;transition:.2s;z-index:20;pointer-events:none}#hz-toast.an{opacity:1}
  esp-app{display:block;margin-top:20px}`;

  function init() {
    const alt = document.querySelector('esp-app');     // Standardliste erst auf Wunsch laden
    if (alt) alt.remove();
    if (!document.querySelector('meta[name=viewport]')) document.head.appendChild($('<meta name="viewport" content="width=device-width,initial-scale=1">'));
    document.title = 'Heizung';
    document.head.appendChild($('<style>' + CSS + '</style>'));
    wurzel = $('<div id="hz"></div>'); dlgEl = $('<div id="hz-dlg"></div>');
    document.body.prepend(dlgEl); document.body.prepend(wurzel);
    fwIn = $('<input type="file" accept=".bin" style="display:none">');
    document.body.appendChild(fwIn);
    fwIn.addEventListener('change', () => { const f = fwIn.files && fwIn.files[0]; fwIn.value = ''; if (f) fwUpdate(f); });

    document.body.addEventListener('click', (e) => {
      if (e.target === dlgEl) { dlg = null; zeichneDlg(); return; }
      const el = e.target.closest('[data-a]');
      if (el && (wurzel.contains(el) || dlgEl.contains(el))) aktion(el.dataset.a, el.dataset.v);
    });
    wurzel.addEventListener('change', (e) => {
      const i = e.target;
      if (i.dataset.n) setNum(i.dataset.n, i.value).then((ok) => ok && meldung('Gespeichert'));
      else if (i.dataset.t && i.value) post('time', i.dataset.t, 'set', { value: i.value + ':00' }).then((ok) => ok && meldung('Gespeichert'));
      i.blur();
    });

    const es = new EventSource('/events');
    es.onopen = () => { verbunden = true; plane(); };
    es.onerror = () => { verbunden = false; plane(); };
    es.addEventListener('state', (e) => {
      let d; try { d = JSON.parse(e.data); } catch (x) { return; }
      if (!d || !d.id) return;
      S[d.id] = d;
      if (d.id === 'text_sensor/Status') { try { st = JSON.parse(d.value || d.state); } catch (x) { /* ignorieren */ } }
      plane();
    });
    zeichne();
    setInterval(plane, 30000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
