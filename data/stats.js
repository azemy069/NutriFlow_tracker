/* ==========================================================================
   NUTRIFLOW · СТАТИСТИКА
   Изолированный модуль (IIFE): не конфликтует со script.js и planner.js.
   Графики — SVG в стиле референса: заголовок сверху, подписи оси Y слева,
   пунктирная сетка, градиентная область, линия с точками, зелёный бейдж
   с указателем у последней точки и даты DD/MM снизу.
   Источники (localStorage, строго по аккаунту):
     nutriflow.db.<uid>.weight.v2   — записи веса {date, kg, ts}
     nutriflow.db.<uid>.diary.v2    — приёмы пищи по датам
     nutriflow.db.<uid>.goals.v2    — нормы ккал и БЖУ
     nutriflow.db.<uid>.profile.v2  — целевой вес
     nutriflow.db.<uid>.barcodes.v2 / .products.v2 — личные товары
   ========================================================================== */
(() => {
  'use strict';

  /* ---------------- 1. УТИЛИТЫ ---------------- */
  const q  = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => [...r.querySelectorAll(s)];
  const read = (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch { return f; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const num = (n) => (Number.isFinite(+n) ? +n : 0);
  const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  const dec1 = (n) => Number(n).toFixed(1).replace('.', ',');
  const int = (n) => Math.round(num(n)).toLocaleString('ru-RU');
  const setText = (sel, t) => { const el = q(sel); if (el) el.textContent = t; };
  const setHidden = (sel, h) => { const el = q(sel); if (el) el.hidden = h; };

  const THEME = 'nutriflow.theme';
  const themeNow = () => (localStorage.getItem(THEME) === 'dark' ? 'dark' : 'light');
  document.documentElement.dataset.theme = themeNow();

  /* ---------------- 2. АККАУНТ ---------------- */
  const DB_USERS = 'nutriflow.db.users.v2';
  const DB_SESSION = 'nutriflow.db.session.v2';
  const key = (uid, domain) => `nutriflow.db.${uid}.${domain}.v2`;
  const currentUser = () => {
    const id = read(DB_SESSION, null);
    return id ? (read(DB_USERS, []).find((u) => u.id === id) || null) : null;
  };
  const uidNow = () => { const u = currentUser(); return u ? u.id : 'guest'; };

  /* ---------------- 3. ДАТЫ ---------------- */
  const MEALS = [['breakfast', 'Завтрак'], ['lunch', 'Обед'], ['dinner', 'Ужин'], ['snack', 'Перекус']];
  const MEAL_NAME = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' };
  const MONTHS = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
  const MONTHS_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const DAY_MS = 86400000;
  const dk = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const isKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const fromKey = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const diffDays = (a, b) => Math.round((b - a) / DAY_MS);
  const shortDate = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  const longDate = (d) => `${d.getDate()} ${MONTHS_FULL[d.getMonth()]}`;
  const fullDate = (d) => `${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
  const daysInMonth = (m, y) => new Date(y, m, 0).getDate();

  /* ---------------- 4. СПРАВОЧНИК ---------------- */
  const BASE = typeof PRODUCTS_DB !== 'undefined' && Array.isArray(PRODUCTS_DB) ? PRODUCTS_DB : [];
  const SHIPPED = typeof BARCODES_DB !== 'undefined' && Array.isArray(BARCODES_DB) ? BARCODES_DB : [];
  const PMAP = new Map(BASE.map((p) => [p.id, p]));
  const EXTRA = new Map();

  function registerBc(e) {
    const code = String(e.code || '').replace(/\D/g, '');
    if (!code) return;
    const piece = num(e.piece);
    if (e.id && PMAP.has(e.id) && !e.own) {
      const b = PMAP.get(e.id);
      EXTRA.set(b.id, { ...b, piece: piece || num(b.piece), cat: e.unit === 'ml' ? 'drinks' : b.cat });
      return;
    }
    const id = e.own ? 'bc-' + code : (e.id && PMAP.has(e.id) ? e.id : 'bc-' + code);
    const b = PMAP.get(id);
    EXTRA.set(id, {
      id, name: e.name || (b ? b.name : 'Продукт ' + code),
      cat: e.unit === 'ml' ? 'drinks' : (b ? b.cat : 'barcode'),
      kcal: num(e.kcal), p: num(e.p), f: num(e.f), c: num(e.c), piece,
    });
  }
  function rebuildIndex() {
    EXTRA.clear();
    SHIPPED.forEach(registerBc);
    (S.barcodes || []).forEach((e) => registerBc({ ...e, own: true }));
    (S.custom || []).forEach((p) => {
      if (!p || !p.id) return;
      EXTRA.set(p.id, {
        id: p.id, name: p.name || 'Продукт', cat: p.unit === 'ml' ? 'drinks' : (p.cat || 'custom'),
        kcal: num(p.kcal), p: num(p.p), f: num(p.f), c: num(p.c), piece: num(p.piece),
      });
    });
  }
  const getProd = (id) => PMAP.get(id) || EXTRA.get(id) || null;
  const isDrink = (p) => Boolean(p) && p.cat === 'drinks';
  const density = (p) => {
    const id = String(p && p.id);
    if (/^(vodka|cognac|whiskey|rum|gin)/.test(id)) return 0.95;
    if (/^(wine|champagne|beer)/.test(id)) return 0.99;
    if (/^(milkshake|cocoa-milk|latte|cappuccino|coffee-milk|frappe|mocha)/.test(id)) return 1.03;
    if (/^(juice|smoothie|compote|mors|kissel|lemonade|cola|pepsi|fanta|sprite|energy|kvass)/.test(id)) return 1.04;
    return 1;
  };
  const toGrams = (p, amount, unit) => {
    if (unit === 'pc') return amount * num(p.piece);
    if (unit === 'ml') return amount * density(p);
    return amount;
  };
  const unitLabel = (u) => (u === 'pc' ? 'шт' : u === 'ml' ? 'мл' : 'г');
  const portion = (p, amount, unit = 'g') => {
    const k = toGrams(p, amount, unit) / 100;
    return {
      kcal: Math.round(num(p.kcal) * k),
      p: +(num(p.p) * k).toFixed(1),
      f: +(num(p.f) * k).toFixed(1),
      c: +(num(p.c) * k).toFixed(1),
    };
  };
  const itemProd = (item) => {
    if (!item) return null;
    const db = getProd(item.id);
    if (db) return num(item.piece) > 0 ? { ...db, piece: num(item.piece) } : db;
    if (item.custom) {
      return {
        id: 'custom', cat: 'custom', name: item.custom.name || 'Блюдо',
        kcal: num(item.custom.kcal100), p: num(item.custom.p100),
        f: num(item.custom.f100), c: num(item.custom.c100), piece: num(item.custom.piece),
      };
    }
    return null;
  };
  const amountText = (a, u) => (u === 'pc' ? dec1(a) : String(Math.round(a)));

  /* ---------------- 5. СОСТОЯНИЕ ---------------- */
  const S = {
    uid: uidNow(),
    period: 30,
    goals: { kcal: 1800, p: 120, f: 70, c: 200 },
    profile: null,
    weight: [],
    diary: {},
    barcodes: [],
    custom: [],
    showGoals: true,
    showDots: true,
    smooth: false,
    sortDesc: true,
    days: [],
    nutrition: [],
  };

  function loadAll() {
    S.uid = uidNow();
    const w = read(key(S.uid, 'weight'), []);
    S.weight = (Array.isArray(w) ? w : [])
      .filter((r) => r && isKey(r.date) && num(r.kg) > 0)
      .map((r) => ({ date: r.date, kg: num(r.kg), ts: num(r.ts) || fromKey(r.date).getTime() }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const d = read(key(S.uid, 'diary'), {});
    S.diary = d && typeof d === 'object' ? d : {};
    S.goals = read(key(S.uid, 'goals'), null) || { kcal: 1800, p: 120, f: 70, c: 200 };
    S.profile = read(key(S.uid, 'profile'), null);
    const bc = read(key(S.uid, 'barcodes'), []);
    S.barcodes = Array.isArray(bc) ? bc : [];
    const cu = read(key(S.uid, 'products'), []);
    S.custom = Array.isArray(cu) ? cu : [];
    rebuildIndex();
  }
  const persistWeight = () => write(key(S.uid, 'weight'), S.weight);

  /* ---------------- 6. РАСЧЁТЫ ---------------- */
  function buildDays() {
    const t = today();
    if (S.period === 'all') {
      const keys = [...S.weight.map((r) => r.date), ...Object.keys(S.diary).filter(isKey)].sort();
      let start = keys.length ? fromKey(keys[0]) : addDays(t, -29);
      if (start > t) start = t;
      const n = clamp(diffDays(start, t) + 1, 1, 180);
      S.days = Array.from({ length: n }, (_, i) => addDays(t, -(n - 1 - i)));
    } else {
      const n = num(S.period) || 30;
      S.days = Array.from({ length: n }, (_, i) => addDays(t, -(n - 1 - i)));
    }
  }
  function dayNutrition(dateKey) {
    const day = S.diary[dateKey];
    const t = { kcal: 0, p: 0, f: 0, c: 0, items: 0 };
    if (!day) return t;
    MEALS.forEach(([k]) => {
      (Array.isArray(day[k]) ? day[k] : []).forEach((it) => {
        const p = itemProd(it);
        if (!p) return;
        const m = portion(p, num(it.weight), it.unit);
        t.kcal += m.kcal; t.p += m.p; t.f += m.f; t.c += m.c; t.items++;
      });
    });
    t.p = +t.p.toFixed(1); t.f = +t.f.toFixed(1); t.c = +t.c.toFixed(1);
    return t;
  }
  function buildNutrition() {
    S.nutrition = S.days.map((d) => {
      const k = dk(d);
      return { date: k, d, ...dayNutrition(k) };
    });
  }
  function weightInRange() {
    if (!S.days.length) return [];
    const lo = dk(S.days[0]), hi = dk(S.days[S.days.length - 1]);
    return S.weight.filter((r) => r.date >= lo && r.date <= hi);
  }
  const lastWeight = () => (S.weight.length ? S.weight[S.weight.length - 1] : null);

  /* ---------------- 7. ОСЬ Y ---------------- */
  function axisTicks(min, max, minPad) {
    let lo = Math.min(min, max), hi = Math.max(min, max);
    if (hi - lo < minPad) { const c = (hi + lo) / 2; lo = c - minPad / 2; hi = c + minPad / 2; }
    const pad = (hi - lo) * 0.45;
    lo -= pad; hi += pad * 0.25;
    if (min >= 0 && lo < 0) lo = 0;
    const target = Math.max((hi - lo) / 2, 1e-6);
    const mag = Math.pow(10, Math.floor(Math.log10(target)));
    const step = [1, 2, 2.5, 5, 10].map((c) => c * mag).find((s) => s >= target) || 10 * mag;
    let v = Math.floor(lo / step) * step;
    const ticks = [];
    while (v < hi + step * 0.0001 && ticks.length < 6) { ticks.push(+v.toFixed(6)); v += step; }
    while (ticks.length && ticks[ticks.length - 1] < max && ticks.length < 6) {
      ticks.push(+(ticks[ticks.length - 1] + step).toFixed(6));
    }
    if (!ticks.length) ticks.push(0, step);
    if (ticks.length === 1) ticks.push(+(ticks[0] + step).toFixed(6));
    return ticks;
  }

  /* ---------------- 8. ГРАФИК ---------------- */
  const GEO = { W: 1000, H: 400, L: 142, R: 946, T: 54, B: 300, XL: 350 };
  let chartSeq = 0;

  function smoothPath(pts) {
    if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      const mx = (p0.x + p1.x) / 2;
      d += ` C${mx.toFixed(1)},${p0.y.toFixed(1)} ${mx.toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
    }
    return d;
  }
  const linePath = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  /**
   * cfg: { host, title, unit, decimals, color, points:[{label,value,date}], goal, minPad, onPick }
   */
  function drawChart(cfg) {
    const host = q(cfg.host);
    if (!host) return;
    const pts = cfg.points || [];
    if (!pts.length) {
      host.innerHTML = `<div class="wc wc--empty">
        <p class="wc__title">${esc(cfg.title)}</p>
        <div class="wc__emptybox">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16M6 15l4-5 3 3 5-7"/></svg>
          <strong>${esc(cfg.emptyTitle || 'Пока нет данных')}</strong>
          <span>${esc(cfg.emptyText || 'За выбранный период записей нет.')}</span>
          ${cfg.emptyAction ? `<button class="btn btn--primary wc__emptybtn" type="button" data-empty-action>${esc(cfg.emptyAction)}</button>` : ''}
        </div>
      </div>`;
      const btn = host.querySelector('[data-empty-action]');
      if (btn && cfg.onEmptyAction) btn.addEventListener('click', cfg.onEmptyAction);
      return;
    }

    const id = 'wc' + (++chartSeq);
    const { W, H, L, R, T, B, XL } = GEO;
    const values = pts.map((p) => p.value);
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const ticks = axisTicks(dataMin, dataMax, cfg.minPad || 1);
    const yLo = ticks[0];
    const yHi = ticks[ticks.length - 1];
    const span = Math.max(yHi - yLo, 1e-6);
    const yOf = (v) => B - ((v - yLo) / span) * (B - T);

    const n = pts.length;
    const xOf = (i) => (n === 1 ? (L + R) / 2 : L + (i / (n - 1)) * (R - L));
    const P = pts.map((p, i) => ({ x: xOf(i), y: yOf(p.value), ...p, i }));

    const fmtVal = (v) => (cfg.decimals ? dec1(v) : int(v));
    const yLabel = (v) => `${fmtVal(v)} ${cfg.unit}`;

    /* сетка и подписи Y */
    let grid = '';
    ticks.forEach((t) => {
      const y = yOf(t);
      grid += `<line class="wc-grid" x1="${L}" y1="${y.toFixed(1)}" x2="${R}" y2="${y.toFixed(1)}"/>`;
      grid += `<text class="wc-ylabel" x="${L - 18}" y="${y.toFixed(1)}">${esc(yLabel(t))}</text>`;
    });

    /* линия целей */
    let goalLine = '';
    const goal = num(cfg.goal);
    if (cfg.showGoal && goal > 0 && goal >= yLo && goal <= yHi) {
      const gy = yOf(goal);
      goalLine = `<line class="wc-goal" x1="${L}" y1="${gy.toFixed(1)}" x2="${R}" y2="${gy.toFixed(1)}" stroke="${cfg.color}"/>
        <text class="wc-goallabel" x="${R}" y="${(gy - 10).toFixed(1)}" fill="${cfg.color}">цель ${fmtVal(goal)}</text>`;
    }

    /* область и линия */
    const path = cfg.smooth ? smoothPath(P) : linePath(P);
    const area = n > 1
      ? `${path} L${P[n - 1].x.toFixed(1)},${B} L${P[0].x.toFixed(1)},${B} Z`
      : '';
    const last = P[n - 1];

    /* точки */
    let dots = '';
    if (cfg.showDots) {
      const showAll = n <= 32;
      P.forEach((p) => {
        const edge = p.i === 0 || p.i === n - 1;
        if (!showAll && !edge) return;
        dots += `<circle class="wc-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${edge ? 8 : 5.5}" fill="${cfg.color}"/>`;
      });
    }

    /* бейдж у последней точки */
    const badgeText = `${fmtVal(last.value)} ${cfg.unit}`;
    const bw = Math.max(96, badgeText.length * 13.2 + 30);
    const bh = 46;
    let bx = clamp(last.x - bw / 2, 10, W - bw - 10);
    let by = last.y - bh - 22;
    let flip = false;
    if (by < 6) { by = last.y + 24; flip = true; }
    const tipX = clamp(last.x, bx + 16, bx + bw - 16);
    const triangle = flip
      ? `${tipX - 10},${by} ${tipX + 10},${by} ${tipX},${by - 13}`
      : `${tipX - 10},${by + bh} ${tipX + 10},${by + bh} ${tipX},${by + bh + 13}`;
    const badge = `<g class="wc-badge">
      <polygon points="${triangle}" fill="${cfg.color}"/>
      <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh}" rx="7" fill="${cfg.color}"/>
      <text x="${(bx + bw / 2).toFixed(1)}" y="${(by + bh / 2 + 1).toFixed(1)}" class="wc-badgetext">${esc(badgeText)}</text>
    </g>`;

    /* вертикальная линия у последней точки */
    const stem = n > 1 ? `<line class="wc-stem" x1="${last.x.toFixed(1)}" y1="${last.y.toFixed(1)}" x2="${last.x.toFixed(1)}" y2="${B}" stroke="${cfg.color}"/>` : '';

    /* подписи X */
    const labelIdx = [];
    if (n === 1) labelIdx.push(0);
    else {
      const want = Math.min(6, n);
      for (let i = 0; i < want; i++) labelIdx.push(Math.round((i / (want - 1)) * (n - 1)));
    }
    const uniq = [...new Set(labelIdx)];
    let xlabels = '';
    uniq.forEach((i) => {
      const p = P[i];
      const anchor = n === 1 ? 'middle' : (i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle'));
      const x = i === 0 ? L - 6 : (i === n - 1 ? R + 6 : p.x);
      xlabels += `<text class="wc-xlabel" x="${x.toFixed(1)}" y="${XL}" text-anchor="${anchor}">${esc(p.label)}</text>`;
    });

    /* зоны наведения / клика */
    let hits = '';
    P.forEach((p) => {
      const w = n === 1 ? (R - L) : (R - L) / (n - 1);
      const x = clamp(p.x - w / 2, L - w / 2, R);
      hits += `<rect class="wc-hit" data-hit="${p.i}" x="${x.toFixed(1)}" y="${T - 30}" width="${Math.max(w, 12).toFixed(1)}" height="${B - T + 60}" fill="transparent"/>`;
    });

    host.innerHTML = `<div class="wc">
      <p class="wc__title">${esc(cfg.title)}</p>
      <svg class="wc__svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.title)}" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="${id}-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${cfg.color}" stop-opacity="0.92"/>
            <stop offset="55%" stop-color="${cfg.color}" stop-opacity="0.38"/>
            <stop offset="100%" stop-color="${cfg.color}" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        ${grid}
        ${goalLine}
        ${area ? `<path d="${area}" fill="url(#${id}-fill)"/>` : ''}
        ${stem}
        ${n > 1 ? `<path class="wc-line" d="${path}" stroke="${cfg.color}"/>` : ''}
        ${dots}
        ${badge}
        <g class="wc-hover" opacity="0">
          <line class="wc-hover__line" x1="0" y1="${T - 20}" x2="0" y2="${B}" stroke="${cfg.color}"/>
          <circle class="wc-hover__dot" cx="0" cy="0" r="10" fill="${cfg.color}"/>
          <rect class="wc-hover__box" x="0" y="0" width="120" height="40" rx="7" fill="${cfg.color}"/>
          <text class="wc-hover__text" x="0" y="0">${''}</text>
        </g>
        ${xlabels}
        ${hits}
      </svg>
    </div>`;

    const svg = host.querySelector('svg');
    const hover = svg.querySelector('.wc-hover');
    const hLine = svg.querySelector('.wc-hover__line');
    const hDot = svg.querySelector('.wc-hover__dot');
    const hBox = svg.querySelector('.wc-hover__box');
    const hText = svg.querySelector('.wc-hover__text');

    const showHover = (i) => {
      const p = P[i];
      if (!p) return;
      const text = `${p.label} · ${fmtVal(p.value)} ${cfg.unit}`;
      const w = Math.max(110, text.length * 11.6 + 26);
      const x = clamp(p.x - w / 2, 8, W - w - 8);
      let y = p.y - 58;
      if (y < 4) y = p.y + 22;
      hLine.setAttribute('x1', p.x.toFixed(1));
      hLine.setAttribute('x2', p.x.toFixed(1));
      hDot.setAttribute('cx', p.x.toFixed(1));
      hDot.setAttribute('cy', p.y.toFixed(1));
      hBox.setAttribute('x', x.toFixed(1));
      hBox.setAttribute('y', y.toFixed(1));
      hBox.setAttribute('width', w.toFixed(1));
      hText.setAttribute('x', (x + w / 2).toFixed(1));
      hText.setAttribute('y', (y + 26).toFixed(1));
      hText.textContent = text;
      hover.setAttribute('opacity', '1');
    };
    const hideHover = () => hover.setAttribute('opacity', '0');

    svg.querySelectorAll('[data-hit]').forEach((rect) => {
      const i = Number(rect.dataset.hit);
      rect.addEventListener('pointerenter', () => showHover(i));
      rect.addEventListener('pointermove', () => showHover(i));
      rect.addEventListener('pointerleave', hideHover);
      rect.addEventListener('click', () => { hideHover(); if (cfg.onPick) cfg.onPick(pts[i], i); });
      rect.style.cursor = cfg.onPick ? 'pointer' : 'default';
    });
    svg.addEventListener('pointerleave', hideHover);
  }

  /* ---------------- 9. ПЛИТКИ И ФАКТЫ ---------------- */
  const ICONS = {
    scale: '<path d="M4 20h16M6 20V9a6 6 0 0 1 12 0v11"/><path d="M12 9l3-3"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M21 7v5h-5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    fire: '<path d="M12 3c3 4 6 6 6 10a6 6 0 0 1-12 0c0-3 2-4 3-7 1 2 2 3 3 3z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    protein: '<path d="M7 4h10M7 20h10M8 4c0 5 8 7 8 12M16 4c0 5-8 7-8 12"/>',
  };
  function tile(icon, label, value, sub, mod) {
    return `<div class="st-tile${mod ? ' st-tile--' + mod : ''}">
      <span class="st-tile__icon" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[icon] || ICONS.trend}</svg></span>
      <span class="st-tile__label">${esc(label)}</span>
      <strong class="st-tile__value">${esc(value)}</strong>
      <span class="st-tile__sub">${esc(sub || '')}</span>
    </div>`;
  }
  function fact(label, value, mod) {
    return `<div class="st-fact${mod ? ' st-fact--' + mod : ''}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  }

  function renderTiles() {
    const host = q('#st-tiles');
    if (!host) return;
    const wr = weightInRange();
    const cur = lastWeight();
    const withFood = S.nutrition.filter((d) => d.kcal > 0);
    const avgKcal = withFood.length ? withFood.reduce((s, d) => s + d.kcal, 0) / withFood.length : 0;
    const avgP = withFood.length ? withFood.reduce((s, d) => s + d.p, 0) / withFood.length : 0;

    let delta = '—', deltaSub = 'нет записей за период', deltaMod = '';
    if (wr.length >= 2) {
      const d = wr[wr.length - 1].kg - wr[0].kg;
      delta = `${d > 0 ? '+' : d < 0 ? '−' : ''}${dec1(Math.abs(d))} кг`;
      deltaSub = `${dec1(wr[0].kg)} → ${dec1(wr[wr.length - 1].kg)} кг`;
      deltaMod = d < 0 ? 'down' : d > 0 ? 'up' : '';
    } else if (wr.length === 1) {
      delta = '0,0 кг'; deltaSub = 'одна запись за период';
    }

    let goalVal = '—', goalSub = 'цель не задана';
    const target = num(S.profile && S.profile.targetKg);
    if (cur && target > 0) {
      const left = cur.kg - target;
      goalVal = `${dec1(Math.abs(left))} кг`;
      goalSub = Math.abs(left) < 0.05 ? 'цель достигнута' : (left > 0 ? 'осталось сбросить' : 'осталось набрать');
    } else if (target > 0) {
      goalVal = `${dec1(target)} кг`; goalSub = 'добавьте текущий вес';
    }

    host.innerHTML = [
      tile('scale', 'Текущий вес', cur ? `${dec1(cur.kg)} кг` : '—', cur ? fullDate(fromKey(cur.date)) : 'нет записей'),
      tile('trend', 'Изменение', delta, deltaSub, deltaMod),
      tile('target', 'До цели', goalVal, goalSub),
      tile('fire', 'Средние калории', withFood.length ? `${int(avgKcal)} ккал` : '—', `норма ${int(S.goals.kcal)} ккал/день`),
      tile('calendar', 'Дней с записями', `${withFood.length} / ${S.days.length}`, 'за выбранный период'),
      tile('protein', 'Средний белок', withFood.length ? `${int(avgP)} г` : '—', `норма ${int(S.goals.p)} г/день`),
    ].join('');
  }

  /* ---------------- 10. ВЕС ---------------- */
  function renderWeight() {
    const wr = weightInRange();
    const cur = lastWeight();
    setText('#st-weight-sub', wr.length
      ? `Записей за период: ${wr.length}${cur ? ` · последняя ${fullDate(fromKey(cur.date))}` : ''}`
      : 'За выбранный период записей веса нет');

    drawChart({
      host: '#chart-weight',
      title: cur ? `Текущий вес: ${dec1(cur.kg)} кг` : 'Текущий вес: —',
      unit: 'кг', decimals: 1, minPad: 0.2,
      color: 'var(--wc-green)',
      showDots: S.showDots, smooth: S.smooth, showGoal: false,
      points: wr.map((r) => ({ label: shortDate(fromKey(r.date)), value: r.kg, date: r.date })),
      emptyTitle: 'Записей веса пока нет',
      emptyText: 'Добавьте вес — и здесь появится график динамики.',
      emptyAction: 'Добавить вес',
      onEmptyAction: () => openWeightModal(),
      onPick: (p) => openWeightModal(p.date),
    });

    const facts = q('#weight-facts');
    if (facts) {
      if (wr.length) {
        const first = wr[0], last = wr[wr.length - 1];
        const d = last.kg - first.kg;
        const target = num(S.profile && S.profile.targetKg);
        facts.innerHTML = [
          fact('Начало периода', `${dec1(first.kg)} кг · ${shortDate(fromKey(first.date))}`),
          fact('Сейчас', `${dec1(last.kg)} кг · ${shortDate(fromKey(last.date))}`),
          fact('Изменение', `${d > 0 ? '+' : d < 0 ? '−' : ''}${dec1(Math.abs(d))} кг`, d < 0 ? 'down' : d > 0 ? 'up' : ''),
          fact('Цель', target > 0 ? `${dec1(target)} кг` : 'не задана'),
        ].join('');
      } else facts.innerHTML = '';
    }
    renderRecords();
  }

  function renderRecords() {
    const list = q('#weight-records');
    if (!list) return;
    const rows = [...S.weight].sort((a, b) => (S.sortDesc ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
    setText('#st-sort', S.sortDesc ? 'Сначала новые' : 'Сначала старые');
    if (!rows.length) {
      list.innerHTML = '<li class="st-records__empty">Пока нет ни одной записи веса.</li>';
      return;
    }
    list.innerHTML = rows.slice(0, 40).map((r) => `<li class="st-rec">
      <button class="st-rec__main" type="button" data-rec-edit="${esc(r.date)}" title="Изменить запись">
        <span class="st-rec__date">${esc(longDate(fromKey(r.date)))}</span>
        <b class="st-rec__kg">${dec1(r.kg)} кг</b>
      </button>
      <button class="st-rec__del" type="button" data-rec-del="${esc(r.date)}" aria-label="Удалить запись за ${esc(longDate(fromKey(r.date)))}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>
      </button>
    </li>`).join('');
  }

  /* ---------------- 11. КАЛОРИИ И БЖУ ---------------- */
  function renderKcal() {
    const withFood = S.nutrition.filter((d) => d.kcal > 0);
    const avg = withFood.length ? withFood.reduce((s, d) => s + d.kcal, 0) / withFood.length : 0;
    setText('#st-kcal-goal', `Цель: ${int(S.goals.kcal)} ккал`);

    drawChart({
      host: '#chart-kcal',
      title: withFood.length ? `Средние калории: ${int(avg)} ккал` : 'Средние калории: —',
      unit: 'ккал', decimals: 0, minPad: 200,
      color: 'var(--wc-green)',
      goal: S.goals.kcal, showGoal: S.showGoals,
      showDots: S.showDots, smooth: S.smooth,
      points: S.nutrition.map((d) => ({ label: shortDate(d.d), value: d.kcal, date: d.date })),
      emptyTitle: 'Дневник пока пуст',
      emptyText: 'Добавьте блюда в дневник питания — появится график калорий.',
      onPick: (p) => openDrawer(p.date),
    });

    const box = q('#kcal-extremes');
    if (!box) return;
    if (!withFood.length) { box.innerHTML = ''; return; }
    const max = withFood.reduce((a, b) => (b.kcal > a.kcal ? b : a));
    const min = withFood.reduce((a, b) => (b.kcal < a.kcal ? b : a));
    const over = withFood.filter((d) => d.kcal > num(S.goals.kcal)).length;
    box.innerHTML = `
      <button class="st-extreme st-extreme--max" type="button" data-extreme="${esc(max.date)}">
        <span class="st-extreme__label">Больше всего</span>
        <strong>${int(max.kcal)} ккал</strong>
        <span class="st-extreme__date">${esc(fullDate(max.d))}</span>
      </button>
      <button class="st-extreme st-extreme--min" type="button" data-extreme="${esc(min.date)}">
        <span class="st-extreme__label">Меньше всего</span>
        <strong>${int(min.kcal)} ккал</strong>
        <span class="st-extreme__date">${esc(fullDate(min.d))}</span>
      </button>
      <div class="st-extreme st-extreme--info">
        <span class="st-extreme__label">Дней выше нормы</span>
        <strong>${over} из ${withFood.length}</strong>
        <span class="st-extreme__date">норма ${int(S.goals.kcal)} ккал</span>
      </div>`;
  }

  function renderMacro(field, host, factsHost, name, unitColor, goal) {
    const withFood = S.nutrition.filter((d) => d.kcal > 0);
    const avg = withFood.length ? withFood.reduce((s, d) => s + d[field], 0) / withFood.length : 0;
    drawChart({
      host, title: `${name}: среднее ${int(avg)} г`,
      unit: 'г', decimals: 0, minPad: 10,
      color: unitColor, goal, showGoal: S.showGoals,
      showDots: S.showDots, smooth: S.smooth,
      points: S.nutrition.map((d) => ({ label: shortDate(d.d), value: d[field], date: d.date })),
      emptyTitle: 'Нет данных',
      emptyText: 'Заполните дневник питания.',
      onPick: (p) => openDrawer(p.date),
    });
    const f = q(factsHost);
    if (!f) return;
    if (!withFood.length) { f.innerHTML = ''; return; }
    const max = withFood.reduce((a, b) => (b[field] > a[field] ? b : a));
    const min = withFood.reduce((a, b) => (b[field] < a[field] ? b : a));
    f.innerHTML = [
      fact('Максимум', `${int(max[field])} г · ${shortDate(max.d)}`),
      fact('Минимум', `${int(min[field])} г · ${shortDate(min.d)}`),
      fact('Норма', `${int(goal)} г/день`),
    ].join('');
  }

  function renderAll() {
    buildDays();
    buildNutrition();
    const a = S.days[0], b = S.days[S.days.length - 1];
    setText('#st-range', S.period === 'all'
      ? `Период: всё время · ${fullDate(a)} — ${fullDate(b)}`
      : `Период: последние ${S.period} дней · ${fullDate(a)} — ${fullDate(b)}`);
    renderTiles();
    renderWeight();
    renderKcal();
    renderMacro('p', '#chart-p', '#facts-p', 'Белки', 'var(--wc-protein)', num(S.goals.p));
    renderMacro('f', '#chart-f', '#facts-f', 'Жиры', 'var(--wc-fat)', num(S.goals.f));
    renderMacro('c', '#chart-c', '#facts-c', 'Углеводы', 'var(--wc-carb)', num(S.goals.c));
  }

  /* ---------------- 12. ТОСТ С ОТМЕНОЙ ---------------- */
  let toastT = 0;
  function toast(msg, action) {
    let el = q('#st-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'st-toast'; el.className = 'app-toast st-toast'; el.setAttribute('role', 'status');
      document.body.append(el);
    }
    el.textContent = '';
    const span = document.createElement('span');
    span.textContent = msg;
    el.append(span);
    if (action) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'st-toast__act'; b.textContent = action.label;
      b.addEventListener('click', () => { action.run(); el.classList.remove('is-visible'); });
      el.append(b);
    }
    el.classList.add('is-visible');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('is-visible'), action ? 7000 : 3000);
  }

  /* ---------------- 13. КОЛЁСА ВЫБОРА ---------------- */
  const IH = 44;              // высота одной строки
  const WHEEL_H = 176;        // высота окна колеса (ровно 4 строки)
  const WHEEL_STEP = 150;     // пикселей прокрутки на один шаг в базовом темпе
  const WHEEL_MAX_BURST = 10; // максимум значений за один прыжок с ускорением
  function makeWheel(host, values, initial, format, onchange) {
    if (!host) return null;
    host.textContent = '';
    const vp = document.createElement('div');
    vp.className = 'wheel__viewport';
    vp.tabIndex = 0;
    vp.style.height = `${WHEEL_H}px`;

    /* Паддинг считаем от РЕАЛЬНОЙ высоты окна — тогда выбранное значение
       всегда ровно по центру пилюли, а последнее докручивается до конца */
    const padH = (WHEEL_H - IH) / 2;
    const pad = () => {
      const p = document.createElement('div');
      p.className = 'wheel__pad';
      p.style.height = `${padH}px`;
      return p;
    };
    vp.append(pad());
    values.forEach((v, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wheel__item';
      b.style.height = `${IH}px`;
      b.dataset.i = String(i);
      b.textContent = format ? format(v) : String(v);
      b.addEventListener('click', () => go(i));
      vp.append(b);
    });
    vp.append(pad());
    host.append(vp);

    const w = { values, index: 0 };
    const vis = () => vp.offsetParent !== null;
    let animUntil = 0;

    function paint() {
      const center = vp.scrollTop / IH;
      vp.querySelectorAll('.wheel__item').forEach((el) => {
        const d = Math.abs(Number(el.dataset.i) - center);
        el.classList.toggle('is-active', d < 0.5);
        el.style.opacity = d < 0.5 ? '1' : d < 1.5 ? '.55' : '.28';
      });
      if (onchange) onchange();
    }
    function go(i, smooth = true) {
      w.index = clamp(i, 0, values.length - 1);
      animUntil = performance.now() + (smooth ? 300 : 60);
      vp.scrollTo({ top: w.index * IH, behavior: smooth ? 'smooth' : 'auto' });
      paint();
    }

    let snapT = 0;
    vp.addEventListener('scroll', () => {
      if (!vis()) return;
      paint();
      clearTimeout(snapT);
      snapT = setTimeout(() => {
        if (!vis() || performance.now() < animUntil) return;
        go(Math.round(vp.scrollTop / IH), false);
      }, 130);
    }, { passive: true });

    /* Колесо мыши с ускорением: лёгкое вращение — по одному значению,
       быстрое — список летит. Пауза почти мгновенно сбрасывает разгон,
       поэтому после остановки колесо не «долетает» лишнего. */
    let acc = 0;        // непотраченные пиксели прокрутки
    let speed = 0;      // сглаженная скорость, px/ms
    let sustain = 0;    // сколько событий подряд крутим быстро
    let lastT = 0;
    let idleT = 0;
    const resetBoost = () => { speed = 0; sustain = 0; };
    vp.addEventListener('wheel', (e) => {
      e.preventDefault();
      /* 140 мс тишины — ускорение полностью сброшено */
      clearTimeout(idleT);
      idleT = setTimeout(resetBoost, 140);

      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? WHEEL_H : 1;
      const delta = e.deltaY * unit;
      if (!delta) return;
      const now = performance.now();
      const gap = Math.max(now - lastT, 4);
      lastT = now;

      /* Заметная пауза — начинаем чисто */
      if (gap > 200) resetBoost();
      /* Сменили направление — забываем накопленное */
      if (acc && Math.sign(acc) !== Math.sign(delta)) acc = 0;

      /* Скорость с быстрым затуханием: период полураспада ~80 мс */
      speed = speed * Math.pow(0.5, gap / 80);
      speed = Math.max(speed * 0.6 + (Math.abs(delta) / gap) * 0.4, 0);
      sustain = (gap < 120 && speed > 1.6) ? Math.min(sustain + 1, 30) : 0;

      acc += delta;
      if (Math.abs(acc) < WHEEL_STEP) return;

      const mult = 1 + clamp((speed - 1.2) / 1.2, 0, 3) + clamp(sustain / 12, 0, 3);
      const dir = acc > 0 ? 1 : -1;
      const steps = clamp(Math.round((Math.abs(acc) / WHEEL_STEP) * mult), 1, WHEEL_MAX_BURST);
      acc = 0;
      go(w.index + dir * steps, steps <= 2);
    }, { passive: false });
    vp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); go(w.index + 1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); go(w.index - 1); }
      if (e.key === 'PageDown') { e.preventDefault(); go(w.index + 4); }
      if (e.key === 'PageUp') { e.preventDefault(); go(w.index - 4); }
      if (e.key === 'Home') { e.preventDefault(); go(0); }
      if (e.key === 'End') { e.preventDefault(); go(values.length - 1); }
    });

    w.set = (v, smooth = false) => { const i = values.indexOf(v); go(i < 0 ? 0 : i, smooth); };
    w.read = () => {
      if (vis()) w.index = clamp(Math.round(vp.scrollTop / IH), 0, values.length - 1);
      return values[w.index];
    };
    requestAnimationFrame(() => w.set(initial, false));
    return w;
  }

  /* ---------------- 14. МОДАЛКА ВЕСА ---------------- */
  const WM = { open: false, mode: 'today', wheels: null, editDate: null };
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

  function wmDate() {
    if (WM.mode === 'today' || !WM.wheels) return today();
    const y = WM.wheels.year.read();
    const m = WM.wheels.month.read();
    const d = Math.min(WM.wheels.day.read(), daysInMonth(m, y));
    return new Date(y, m - 1, d);
  }
  function wmKg() {
    if (!WM.wheels) return 60;
    return clamp(WM.wheels.int.read() + WM.wheels.dec.read() / 10, 20, 300);
  }
  function wmPreview() {
    if (!WM.open) return;
    const d = wmDate();
    const kg = wmKg();
    const future = d > today();
    const exists = S.weight.some((r) => r.date === dk(d));
    setText('#wm-preview', `${fullDate(d)} · ${dec1(kg)} кг`);
    const warn = q('#wm-warn');
    const save = q('#wm-save');
    const del = q('#wm-delete');
    if (future) {
      if (warn) { warn.hidden = false; warn.textContent = 'Дата в будущем — выберите сегодняшний день или прошедшую дату.'; }
      if (save) save.disabled = true;
    } else {
      if (warn) {
        warn.hidden = !exists;
        warn.textContent = exists ? 'За эту дату запись уже есть — она будет обновлена.' : '';
      }
      if (save) save.disabled = false;
    }
    if (del) { del.hidden = !exists; del.disabled = future; }
  }
  function ensureWheels() {
    if (WM.wheels) return;
    const y = today().getFullYear();
    WM.wheels = {
      day: makeWheel(q('[data-wm-wheel="day"]'), range(1, 31), today().getDate(), null, wmPreview),
      month: makeWheel(q('[data-wm-wheel="month"]'), range(1, 12), today().getMonth() + 1, (v) => MONTHS[v - 1], wmPreview),
      year: makeWheel(q('[data-wm-wheel="year"]'), range(y - 6, y), y, null, wmPreview),
      int: makeWheel(q('[data-wm-wheel="int"]'), range(20, 300), 60, null, wmPreview),
      dec: makeWheel(q('[data-wm-wheel="dec"]'), range(0, 9), 0, null, wmPreview),
    };
  }
  function syncWheels() {
    if (!WM.wheels) return;
    const apply = () => {
      const d = WM.editDate ? fromKey(WM.editDate) : today();
      WM.wheels.day.set(d.getDate());
      WM.wheels.month.set(d.getMonth() + 1);
      WM.wheels.year.set(d.getFullYear());
      const rec = S.weight.find((r) => r.date === dk(d));
      const kg = rec ? rec.kg : (lastWeight() ? lastWeight().kg : 60);
      WM.wheels.int.set(Math.floor(kg));
      WM.wheels.dec.set(Math.round((kg - Math.floor(kg)) * 10));
      wmPreview();
    };
    apply();
    requestAnimationFrame(apply);
  }
  function setWmMode(mode) {
    WM.mode = mode;
    qa('#wm-datemode .st-seg__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.datemode === mode));
    setHidden('#wm-datewheels', mode !== 'pick');
    if (mode === 'pick') requestAnimationFrame(syncWheels);
    wmPreview();
  }
  function openWeightModal(date) {
    const modal = q('#weight-modal');
    if (!modal) return;
    WM.open = true;
    WM.editDate = isKey(date) ? date : null;
    setText('#wm-title', WM.editDate ? 'Изменить запись веса' : 'Добавить вес');
    modal.hidden = false;
    document.body.classList.add('no-scroll');
    ensureWheels();
    setWmMode(WM.editDate ? 'pick' : 'today');
    syncWheels();
  }
  function closeWeightModal() {
    const modal = q('#weight-modal');
    if (!modal) return;
    WM.open = false;
    modal.hidden = true;
    document.body.classList.remove('no-scroll');
  }
  function saveWeight() {
    const d = wmDate();
    if (d > today()) return;
    const k = dk(d);
    const kg = Math.round(wmKg() * 10) / 10;
    const ex = S.weight.find((r) => r.date === k);
    if (ex) { ex.kg = kg; ex.ts = Date.now(); }
    else S.weight.push({ date: k, kg, ts: Date.now() });
    S.weight.sort((a, b) => a.date.localeCompare(b.date));
    if (!persistWeight()) { toast('Не удалось сохранить: хранилище переполнено'); return; }
    closeWeightModal();
    renderAll();
    toast(`Вес ${dec1(kg)} кг сохранён · ${longDate(d)}`);
  }
  function deleteWeight(date) {
    const i = S.weight.findIndex((r) => r.date === date);
    if (i < 0) return;
    const removed = S.weight[i];
    S.weight.splice(i, 1);
    persistWeight();
    renderAll();
    toast(`Запись за ${longDate(fromKey(date))} удалена`, {
      label: 'Вернуть',
      run: () => {
        S.weight.push(removed);
        S.weight.sort((a, b) => a.date.localeCompare(b.date));
        persistWeight();
        renderAll();
        toast('Запись восстановлена');
      },
    });
  }

  /* ---------------- 15. СОСТАВ ДНЯ ---------------- */
  function openDrawer(date) {
    const wrap = q('#day-drawer');
    if (!wrap || !isKey(date)) return;
    const d = fromKey(date);
    const t = dayNutrition(date);
    setText('#drawer-overline', t.items ? 'Состав дня' : 'День без записей');
    setText('#drawer-title', fullDate(d));
    const totals = q('#drawer-totals');
    if (totals) {
      totals.innerHTML = `
        <div class="st-drawer__total st-drawer__total--kcal"><b>${int(t.kcal)}</b><span>ккал</span></div>
        <div class="st-drawer__total"><b>${int(t.p)}</b><span>белки, г</span></div>
        <div class="st-drawer__total"><b>${int(t.f)}</b><span>жиры, г</span></div>
        <div class="st-drawer__total"><b>${int(t.c)}</b><span>углеводы, г</span></div>`;
    }
    const body = q('#drawer-body');
    if (body) {
      const day = S.diary[date];
      if (!day || !t.items) {
        body.innerHTML = '<p class="st-drawer__empty">В этот день в дневнике нет блюд. Откройте дневник и добавьте приём пищи.</p>';
      } else {
        body.innerHTML = MEALS.map(([mk, mn]) => {
          const items = Array.isArray(day[mk]) ? day[mk] : [];
          if (!items.length) return '';
          let sum = 0;
          const rows = items.map((it) => {
            const p = itemProd(it);
            if (!p) return '';
            const unit = it.unit === 'ml' ? 'ml' : it.unit === 'pc' ? 'pc' : 'g';
            const m = portion(p, num(it.weight), unit);
            sum += m.kcal;
            return `<li class="st-drawer__item">
              <span class="st-drawer__name">${esc(p.name || 'Блюдо')}</span>
              <span class="st-drawer__amount">${amountText(num(it.weight), unit)} ${unitLabel(unit)}</span>
              <b class="st-drawer__kcal">${int(m.kcal)}</b>
            </li>`;
          }).filter(Boolean).join('');
          if (!rows) return '';
          return `<section class="st-drawer__meal">
            <header><h4>${mn}</h4><span>${int(sum)} ккал</span></header>
            <ul>${rows}</ul>
          </section>`;
        }).join('');
      }
    }
    wrap.hidden = false;
    document.body.classList.add('no-scroll');
  }
  function closeDrawer() {
    const wrap = q('#day-drawer');
    if (!wrap) return;
    wrap.hidden = true;
    document.body.classList.remove('no-scroll');
  }

  /* ---------------- 16. ЭКСПОРТ ---------------- */
  function exportCsv() {
    const wMap = new Map(S.weight.map((r) => [r.date, r.kg]));
    const rows = [['Дата', 'Вес, кг', 'Калории', 'Белки, г', 'Жиры, г', 'Углеводы, г', 'Блюд']];
    S.nutrition.forEach((d) => {
      rows.push([
        d.date,
        wMap.has(d.date) ? dec1(wMap.get(d.date)) : '',
        Math.round(d.kcal), Math.round(d.p), Math.round(d.f), Math.round(d.c), d.items,
      ]);
    });
    const csv = '\uFEFF' + rows.map((r) => r.join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nutriflow-stats-${dk(today())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    toast('CSV сохранён');
  }

  /* ---------------- 17. СОБЫТИЯ ---------------- */
  function bind() {
    q('#st-period')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-period]');
      if (!b) return;
      S.period = b.dataset.period === 'all' ? 'all' : Number(b.dataset.period);
      qa('#st-period .st-seg__btn').forEach((x) => x.classList.toggle('is-active', x === b));
      renderAll();
    });
    q('#st-goals')?.addEventListener('change', (e) => { S.showGoals = e.target.checked; renderAll(); });
    q('#st-dots')?.addEventListener('change', (e) => { S.showDots = e.target.checked; renderAll(); });
    q('#st-smooth')?.addEventListener('change', (e) => { S.smooth = e.target.checked; renderAll(); });
    q('#st-export')?.addEventListener('click', exportCsv);
    q('#st-sort')?.addEventListener('click', () => { S.sortDesc = !S.sortDesc; renderRecords(); });

    q('#st-add-weight')?.addEventListener('click', () => openWeightModal());
    q('#weight-records')?.addEventListener('click', (e) => {
      const del = e.target.closest('[data-rec-del]');
      if (del) { deleteWeight(del.dataset.recDel); return; }
      const edit = e.target.closest('[data-rec-edit]');
      if (edit) openWeightModal(edit.dataset.recEdit);
    });
    q('#kcal-extremes')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-extreme]');
      if (b) openDrawer(b.dataset.extreme);
    });

    const wm = q('#weight-modal');
    if (wm) {
      wm.addEventListener('click', (e) => { if (e.target.closest('[data-wm-close]')) closeWeightModal(); });
      q('#wm-datemode')?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-datemode]');
        if (b) setWmMode(b.dataset.datemode);
      });
      q('#wm-save')?.addEventListener('click', saveWeight);
      q('#wm-delete')?.addEventListener('click', () => {
        const key = dk(wmDate());
        closeWeightModal();
        deleteWeight(key);
      });
    }

    const drawer = q('#day-drawer');
    if (drawer) drawer.addEventListener('click', (e) => { if (e.target.closest('[data-drawer-close]')) closeDrawer(); });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (drawer && !drawer.hidden) closeDrawer();
      else if (wm && !wm.hidden) closeWeightModal();
    });

    const resync = () => {
      document.documentElement.dataset.theme = themeNow();
      loadAll();
      renderAll();
      if (WM.open) wmPreview();
    };
    window.addEventListener('pageshow', resync);
    window.addEventListener('focus', resync);
    window.addEventListener('storage', resync);
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderAll, 220); });
  }

  /* ---------------- 18. СТАРТ ---------------- */
  loadAll();
  bind();
  renderAll();
})();