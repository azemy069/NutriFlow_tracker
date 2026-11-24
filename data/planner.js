/* ==========================================================================
   NUTRIFLOW · ПЛАНИРОВЩИК + ИИ-НУТРИЦИОЛОГ (версия 5)
   · Выбор модели в шапке чата: сообщения уходят СТРОГО выбранной модели.
   · Сообщение с фото всегда уходит в Gemini — Qwen не видит изображения.
   · В контекст уходят последние 50 сообщений; ответ дописывается до конца.
   · Фото-сканер и вкладка «Фото» показывают галерею планировщика И дневника.
   · ИИ предлагает план и применяет его только после подтверждения.
   Базы (localStorage), строго по аккаунтам:
     nutriflow.db.<uid>.planner.v2  — план, настройки, фото, недавние
     nutriflow.db.<uid>.aichat.v2   — переписка и предложения
     nutriflow.db.<uid>.aimodel.v2  — выбранная модель
     nutriflow.db.<uid>.products.v2 — продукты, добавленные ИИ
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
  const dec = (n) => { const s = Number(n).toFixed(1); return s.endsWith('.0') ? s.slice(0, -2) : s.replace('.', ','); };
  const int = (n) => Math.round(num(n)).toLocaleString('ru-RU');
  const setText = (sel, t) => { const el = q(sel); if (el) el.textContent = t; };
  const setVal = (sel, v) => { const el = q(sel); if (el) el.value = v; };
  const getVal = (sel) => { const el = q(sel); return el ? el.value : ''; };
  const setHidden = (sel, h) => { const el = q(sel); if (el) el.hidden = h; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uidRand = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const THEME = 'nutriflow.theme';
  const themeNow = () => (localStorage.getItem(THEME) === 'dark' ? 'dark' : 'light');
  document.documentElement.dataset.theme = themeNow();

  let toastTimer = 0;
  const toast = (msg) => {
    let el = q('#pl-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pl-toast'; el.className = 'app-toast'; el.setAttribute('role', 'status');
      document.body.append(el);
    }
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3200);
  };

  /* ---------------- 2. АККАУНТ ---------------- */
  const DB_USERS = 'nutriflow.db.users.v2';
  const DB_SESSION = 'nutriflow.db.session.v2';
  const key = (uid, domain) => `nutriflow.db.${uid}.${domain}.v2`;
  const currentUser = () => {
    const id = read(DB_SESSION, null);
    return id ? (read(DB_USERS, []).find((u) => u.id === id) || null) : null;
  };
  const uidNow = () => { const u = currentUser(); return u ? u.id : 'guest'; };

  /* ---------------- 3. СПРАВОЧНИК ---------------- */
  const BASE = typeof PRODUCTS_DB !== 'undefined' && Array.isArray(PRODUCTS_DB) ? PRODUCTS_DB : [];
  const SHIPPED = typeof BARCODES_DB !== 'undefined' && Array.isArray(BARCODES_DB) ? BARCODES_DB : [];
  const PMAP = new Map(BASE.map((p) => [p.id, p]));
  const EXTRA = new Map();
  const BCIDX = new Map();

  function registerBc(e) {
    const code = String(e.code || '').replace(/\D/g, '');
    if (!code) return;
    const piece = num(e.piece), pack = num(e.pack);
    if (e.id && PMAP.has(e.id) && !e.own) {
      const b = PMAP.get(e.id);
      const merged = { ...b, barcode: code, piece: piece || num(b.piece), pack: pack || num(b.pack) };
      if (e.unit === 'ml') merged.cat = 'drinks';
      EXTRA.set(b.id, merged);
      BCIDX.set(code, b.id);
      return;
    }
    const id = e.own ? 'bc-' + code : (e.id && PMAP.has(e.id) ? e.id : 'bc-' + code);
    const unit = e.unit === 'ml' ? 'ml' : 'g';
    const b = PMAP.get(id);
    EXTRA.set(id, {
      id, barcode: code, cat: unit === 'ml' ? 'drinks' : (b ? b.cat : 'barcode'),
      name: e.name || (b ? b.name : 'Продукт ' + code),
      fullName: e.fullName || e.name || (b ? b.name : ''),
      brand: e.brand || '',
      kcal: num(e.kcal), p: num(e.p), f: num(e.f), c: num(e.c), piece, pack,
    });
    BCIDX.set(code, id);
  }
  function rebuildProducts() {
    EXTRA.clear(); BCIDX.clear();
    SHIPPED.forEach(registerBc);
    (S.barcodes || []).forEach((e) => registerBc({ ...e, own: true }));
    (S.custom || []).forEach((p) => {
      if (!p || !p.id) return;
      EXTRA.set(p.id, {
        id: p.id, name: p.name || 'Продукт', fullName: p.fullName || p.name || '', brand: p.brand || '',
        cat: p.unit === 'ml' ? 'drinks' : (p.cat || 'custom'),
        kcal: num(p.kcal), p: num(p.p), f: num(p.f), c: num(p.c),
        piece: num(p.piece), pack: num(p.pack), own: true,
      });
    });
  }
  const getProd = (id) => PMAP.get(id) || EXTRA.get(id) || null;
  const allProds = () => { const m = new Map(PMAP); EXTRA.forEach((p, id) => m.set(id, p)); return [...m.values()]; };
  const findCode = (code) => { const id = BCIDX.get(code); return id ? getProd(id) : null; };
  const isShipped = (code) => SHIPPED.some((e) => String(e.code) === code);

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
  const canPc = (p) => num(p && p.piece) > 0;
  const defUnit = (p) => (canPc(p) ? 'pc' : isDrink(p) ? 'ml' : 'g');
  const defAmount = (u) => (u === 'pc' ? 1 : u === 'ml' ? 250 : 100);
  const amtText = (a, u) => (u === 'pc' ? dec(a) : String(Math.round(a)));
  const prodName = (p) => (p && (p.fullName || p.name)) || 'Продукт';
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
  const normName = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim();

  /* ---------------- 4. ДАТЫ ---------------- */
  const MEALS = [['breakfast', 'Завтрак'], ['lunch', 'Обед'], ['dinner', 'Ужин'], ['snack', 'Перекус']];
  const MEAL_NAME = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' };
  const WD = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const dk = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fromKey = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d); };
  const todayDate = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const dayLabel = (d) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const monthShort = (d) => d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
  const isDateKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

  /* ---------------- 5. СОСТОЯНИЕ ---------------- */
  const S = {
    uid: uidNow(), weekOffset: 0, weekStart: 1,
    days: {}, photos: [], diaryPhotos: [], recent: [], barcodes: [], custom: [],
  };

  function loadStore() {
    S.uid = uidNow();
    const p = read(key(S.uid, 'planner'), {});
    S.weekStart = [0, 1, 6].includes(Number(p.weekStart)) ? Number(p.weekStart) : 1;
    S.days = p.days && typeof p.days === 'object' ? p.days : {};
    S.photos = Array.isArray(p.photos) ? p.photos : [];
    S.recent = Array.isArray(p.recent) ? p.recent : [];
    const bc = read(key(S.uid, 'barcodes'), []);
    S.barcodes = Array.isArray(bc) ? bc : [];
    const cu = read(key(S.uid, 'products'), []);
    S.custom = Array.isArray(cu) ? cu : [];
    const dp = read(key(S.uid, 'photos'), []);
    S.diaryPhotos = Array.isArray(dp) ? dp : [];
    rebuildProducts();
  }
  function saveStore() {
    const payload = { weekStart: S.weekStart, days: S.days, photos: S.photos.slice(0, 12), recent: S.recent.slice(0, 20) };
    if (!write(key(S.uid, 'planner'), payload)) {
      S.photos = S.photos.slice(0, 4);
      write(key(S.uid, 'planner'), { ...payload, photos: S.photos });
      toast('Хранилище заполнено — старые фото удалены');
    }
  }
  function saveCustom() {
    if (!write(key(S.uid, 'products'), S.custom)) {
      toast('Не удалось сохранить продукты: нет места в хранилище');
      return false;
    }
    rebuildProducts();
    return true;
  }
  function ensureScope() {
    if (S.uid !== uidNow()) { loadStore(); aiLoad(); loadModel(); renderAll(); aiRender(); renderModelBar(); }
  }

  /* Фото планировщика + фото дневника одним списком, без дублей */
  function allPhotos() {
    const out = [];
    const seen = new Set();
    (S.photos || []).forEach((ph) => {
      if (!ph || !ph.id || seen.has(ph.id)) return;
      seen.add(ph.id);
      out.push({ ...ph, from: 'plan' });
    });
    (S.diaryPhotos || []).forEach((ph) => {
      if (!ph || !ph.id || seen.has(ph.id)) return;
      seen.add(ph.id);
      out.push({ ...ph, from: 'diary' });
    });
    return out.sort((a, b) => num(b.ts) - num(a.ts));
  }

  const dayOf = (date) => {
    if (!S.days[date] || typeof S.days[date] !== 'object') S.days[date] = {};
    MEALS.forEach(([k]) => { if (!Array.isArray(S.days[date][k])) S.days[date][k] = []; });
    return S.days[date];
  };
  const weekStartDate = () => {
    const t = todayDate();
    const diff = (t.getDay() - S.weekStart + 7) % 7;
    t.setDate(t.getDate() - diff + S.weekOffset * 7);
    return t;
  };
  const weekDays = () => {
    const s = weekStartDate();
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return d; });
  };
  const mealTotals = (date, meal) => {
    const t = { kcal: 0, p: 0, f: 0, c: 0 };
    (dayOf(date)[meal] || []).forEach((it) => {
      const p = itemProd(it);
      if (!p) return;
      const m = portion(p, num(it.weight), it.unit);
      t.kcal += m.kcal; t.p += m.p; t.f += m.f; t.c += m.c;
    });
    return t;
  };
  const dayTotals = (date) => {
    const t = { kcal: 0, p: 0, f: 0, c: 0 };
    MEALS.forEach(([k]) => { const m = mealTotals(date, k); t.kcal += m.kcal; t.p += m.p; t.f += m.f; t.c += m.c; });
    return t;
  };

  /* ---------------- 6. РЕНДЕР НЕДЕЛИ ---------------- */
  function weekLabel() {
    const days = weekDays();
    const a = days[0], b = days[6];
    const y = b.getFullYear();
    if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${b.getDate()} ${b.toLocaleDateString('ru-RU', { month: 'long' })} ${y}`;
    const left = `${a.getDate()} ${monthShort(a)}`;
    const right = `${b.getDate()} ${monthShort(b)} ${y}`;
    return a.getFullYear() === y ? `${left} – ${right}` : `${left} ${a.getFullYear()} – ${right}`;
  }
  function itemRow(it, i) {
    const p = itemProd(it);
    if (!p) return '';
    const unit = it.unit === 'ml' ? 'ml' : it.unit === 'pc' ? 'pc' : 'g';
    const m = portion(p, num(it.weight), unit);
    return `<li class="pl-item">
      <span class="pl-item__name">${esc(prodName(p))}</span>
      <button class="pl-item__amount" type="button" data-pl-edit="${i}" title="Изменить порцию">${amtText(num(it.weight), unit)} ${unitLabel(unit)}</button>
      <span class="pl-item__kcal">${m.kcal}</span>
      <button class="pl-item__del" type="button" data-pl-del="${i}" aria-label="Убрать ${esc(prodName(p))}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </li>`;
  }
  function mealBlock(date, keyName, title) {
    const items = dayOf(date)[keyName] || [];
    const t = mealTotals(date, keyName);
    return `<section class="pl-meal" data-meal="${keyName}">
      <header class="pl-meal__head">
        <h3 class="pl-meal__title">${title}</h3>
        <span class="pl-meal__kcal">${t.kcal} ккал</span>
      </header>
      <ul class="pl-meal__list">${items.length ? items.map(itemRow).join('') : '<li class="pl-meal__empty">Пусто</li>'}</ul>
      <div class="pl-meal__actions">
        <button class="pl-btn pl-btn--add" type="button" data-pl-add="${keyName}">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Добавить
        </button>
        <button class="pl-btn pl-btn--photo" type="button" data-pl-photo="${keyName}" title="Добавить по фото">
          <svg viewBox="0 0 24 24"><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>
        </button>
        <button class="pl-btn pl-btn--bc" type="button" data-pl-barcode="${keyName}" title="Добавить по штрихкоду">
          <svg viewBox="0 0 24 24"><path d="M3 5v14M6.5 5v14M10 5v10M13.5 5v14M17 5v10M20.5 5v14"/></svg>
        </button>
      </div>
    </section>`;
  }
  function renderWeek() {
    setText('#pl-week-label', weekLabel());
    const days = weekDays();
    const todayKey = dk(todayDate());
    const strip = q('#pl-strip');
    if (strip) {
      strip.innerHTML = days.map((d) => {
        const k = dk(d);
        const t = dayTotals(k);
        return `<button class="pl-cell${k === todayKey ? ' is-today' : ''}${t.kcal > 0 ? ' has-food' : ''}" type="button" data-pl-jump="${k}">
          <span class="pl-cell__wd">${WD_SHORT[d.getDay()]}</span>
          <span class="pl-cell__num">${d.getDate()}</span>
          <span class="pl-cell__kcal">${t.kcal > 0 ? int(t.kcal) : '—'}</span>
        </button>`;
      }).join('');
    }
    const grid = q('#pl-days');
    if (grid) {
      grid.innerHTML = days.map((d) => {
        const k = dk(d);
        const t = dayTotals(k);
        return `<article class="pl-day glass" data-date="${k}" id="pl-day-${k}">
          <header class="pl-day__head">
            <div>
              <h2 class="pl-day__wd">${WD[d.getDay()]}${k === todayKey ? '<span class="pl-day__today">сегодня</span>' : ''}</h2>
              <p class="pl-day__date">${dayLabel(d)}</p>
            </div>
            <div class="pl-day__side">
              <span class="pl-day__kcal">${int(t.kcal)} ккал</span>
              <button class="pl-day__clear" type="button" data-pl-clear="1" aria-label="Очистить день" title="Очистить день">
                <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
              </button>
            </div>
          </header>
          <p class="pl-day__macros">Б ${dec(t.p)} · Ж ${dec(t.f)} · У ${dec(t.c)}</p>
          ${MEALS.map(([mk, mt]) => mealBlock(k, mk, mt)).join('')}
        </article>`;
      }).join('');
    }
    const sum = days.reduce((acc, d) => acc + dayTotals(dk(d)).kcal, 0);
    const filled = days.filter((d) => dayTotals(dk(d)).kcal > 0).length;
    const avg = filled ? Math.round(sum / filled) : 0;
    setText('#pl-week-avg', filled
      ? `Средняя калорийность недели: ${int(avg)} ккал/день · заполнено дней: ${filled} из 7`
      : 'Неделя пока пустая — добавьте блюда сами или попросите ИИ');
  }
  function renderAll() { renderWeek(); }

  /* ---------------- 7. МУТАЦИИ ---------------- */
  function pushRecent(id, weight, unit, piece) {
    if (!getProd(id)) return;
    S.recent = S.recent.filter((r) => r.id !== id);
    const rec = { id, weight, unit, ts: Date.now() };
    if (num(piece) > 0) rec.piece = num(piece);
    S.recent.unshift(rec);
    S.recent = S.recent.slice(0, 20);
  }
  function removeItem(date, meal, index) {
    ensureScope();
    const list = dayOf(date)[meal];
    if (!Array.isArray(list) || index < 0 || index >= list.length) return;
    list.splice(index, 1);
    saveStore(); renderAll();
  }
  function clearDay(date) {
    ensureScope();
    S.days[date] = { breakfast: [], lunch: [], dinner: [], snack: [] };
    saveStore(); renderAll();
    toast('День очищен');
  }

  /* ---------------- 8. ВЫБОР ПРОДУКТОВ ---------------- */
  const pick = { date: null, meal: null, tab: 'search', query: '', sel: new Map(), photoSel: new Set() };
  function openPicker(date, meal) {
    ensureScope();
    pick.date = date; pick.meal = meal; pick.tab = 'search'; pick.query = '';
    pick.sel.clear(); pick.photoSel.clear();
    setText('#pl-pick-target', `${MEAL_NAME[meal]}, ${dayLabel(fromKey(date))}`);
    setVal('#pl-search-input', '');
    q('#pl-product-modal').hidden = false;
    document.body.classList.add('no-scroll');
    pickTab('search'); pickSaveBtn();
    const inp = q('#pl-search-input'); if (inp) inp.focus();
  }
  function closePicker() {
    setHidden('#pl-product-modal', true);
    document.body.classList.remove('no-scroll');
    pick.date = null; pick.meal = null;
  }
  function pickTab(tab) {
    pick.tab = tab;
    qa('[data-pl-tab]').forEach((b) => {
      const on = b.dataset.plTab === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    setHidden('#pl-search-wrap', tab !== 'search');
    pickRender();
  }
  function pickRow(p, last, lastUnit, lastPiece) {
    const on = pick.sel.has(p.id);
    const unit = lastUnit || defUnit(p);
    const piece = num(lastPiece) || num(p.piece);
    const hint = last ? `в прошлый раз ${amtText(last, unit)} ${unitLabel(unit)}` : piece > 0 ? `1 шт ≈ ${dec(piece)} г` : '';
    return `<li class="modal__item">
      <button class="modal__item-btn ${on ? 'is-selected' : ''}" type="button" data-pl-prod="${esc(p.id)}"
        data-last="${last ?? ''}" data-last-unit="${unit}" data-last-piece="${piece || ''}">
        <span class="modal__item-name">${esc(prodName(p))}</span>
        ${hint ? `<span class="modal__item-last">${esc(hint)}</span>` : ''}
        <span class="modal__item-kcal">${num(p.kcal)} ккал / 100 ${isDrink(p) ? 'мл' : 'г'}</span>
        <span class="modal__item-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>
      </button>
    </li>`;
  }
  function pickRender() {
    const list = q('#pl-pick-list');
    if (!list) return;
    let rows = [];
    if (pick.tab === 'search') {
      const query = pick.query.trim().toLowerCase();
      const pool = allProds();
      const src = query ? pool.filter((p) => prodName(p).toLowerCase().includes(query)) : pool;
      rows = src.slice(0, 400).map((p) => pickRow(p, null));
    } else if (pick.tab === 'recent') {
      rows = S.recent.map((r) => { const p = getProd(r.id); return p ? pickRow(p, r.weight, r.unit, r.piece) : ''; }).filter(Boolean);
    } else {
      rows = allPhotos().map((ph) => {
        const on = pick.photoSel.has(ph.id);
        return `<li class="modal__item">
          <button class="modal__item-btn modal__item-btn--photo ${on ? 'is-selected' : ''}" type="button" data-pl-photo-pick="${esc(ph.id)}">
            <img class="modal__photo-thumb" src="${ph.img}" alt="" loading="lazy">
            <span class="modal__item-name">${esc(ph.dish)}${ph.from === 'diary' ? ' <em class="pl-pick__src">дневник</em>' : ''}</span>
            <span class="modal__item-kcal">${num(ph.kcal)} ккал</span>
            <span class="modal__item-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>
          </button>
        </li>`;
      });
    }
    const empty = pick.tab === 'photos'
      ? 'Пока нет фото — отсканируйте блюдо кнопкой с камерой у приёма пищи.'
      : pick.tab === 'recent' ? 'Пока нет недавних продуктов.' : 'Ничего не найдено — попробуйте другой запрос';
    list.innerHTML = rows.length ? rows.join('') : `<li class="modal__empty">${empty}</li>`;
  }
  function pickSaveBtn() {
    const btn = q('#pl-pick-save');
    if (!btn) return;
    const n = pick.sel.size + pick.photoSel.size;
    btn.textContent = n > 0 ? `Добавить (${n})` : 'Добавить';
    btn.disabled = n === 0;
  }
  function pickToggle(btn) {
    const id = btn.dataset.plProd;
    if (pick.sel.has(id)) { pick.sel.delete(id); btn.classList.remove('is-selected'); }
    else {
      const p = getProd(id);
      const unit = btn.dataset.lastUnit || defUnit(p);
      const last = Number(btn.dataset.last);
      const piece = num(btn.dataset.lastPiece) || num(p && p.piece);
      pick.sel.set(id, { weight: last > 0 ? last : defAmount(unit), unit, piece });
      btn.classList.add('is-selected');
    }
    pickSaveBtn();
  }
  function pickTogglePhoto(btn) {
    const id = btn.dataset.plPhotoPick;
    if (pick.photoSel.has(id)) { pick.photoSel.delete(id); btn.classList.remove('is-selected'); }
    else { pick.photoSel.add(id); btn.classList.add('is-selected'); }
    pickSaveBtn();
  }
  function pickSave() {
    if (!pick.date || !pick.meal) return;
    ensureScope();
    const bucket = dayOf(pick.date)[pick.meal];
    pick.sel.forEach(({ weight, unit, piece }, id) => {
      const item = { id, weight, unit };
      if (num(piece) > 0) item.piece = num(piece);
      bucket.push(item);
      pushRecent(id, weight, unit, piece);
    });
    const pool = allPhotos();
    pick.photoSel.forEach((pid) => {
      const ph = pool.find((x) => x.id === pid);
      if (ph) scanItemsToBucket(ph.items, bucket);
    });
    saveStore(); renderAll(); closePicker();
    toast('Добавлено в план');
  }

  /* ---------------- 9. ПОРЦИЯ ---------------- */
  const pw = { date: null, meal: null, index: -1, unit: 'g' };
  const pwProduct = () => {
    if (!pw.date) return null;
    const list = dayOf(pw.date)[pw.meal];
    return list ? itemProd(list[pw.index]) : null;
  };
  function pwUnitUI(unit, p) {
    const toggle = q('#pl-unit-toggle');
    if (!toggle) return;
    const pc = canPc(p), ml = isDrink(p);
    qa('.unit-switch__btn', toggle).forEach((b) => {
      const u = b.dataset.unit;
      const avail = u === 'pc' ? pc : u === 'ml' ? ml : true;
      b.hidden = !avail;
      const on = u === unit;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const sp = q('[data-sep="pc"]', toggle), sm = q('[data-sep="ml"]', toggle);
    if (sp) sp.hidden = !pc;
    if (sm) sm.hidden = !ml;
    toggle.hidden = !pc && !ml;
    setText('#pl-weight-title', unit === 'ml' ? 'Изменить объём' : unit === 'pc' ? 'Изменить количество' : 'Изменить граммовку');
    const hint = q('#pl-weight-hint');
    if (hint) { hint.textContent = pc ? `1 шт ≈ ${dec(p.piece)} г` : ''; hint.hidden = !pc; }
  }
  function openPortion(date, meal, index) {
    ensureScope();
    const item = dayOf(date)[meal][index];
    const p = itemProd(item);
    if (!p) return;
    pw.date = date; pw.meal = meal; pw.index = index;
    pw.unit = item.unit === 'ml' ? 'ml' : item.unit === 'pc' ? 'pc' : item.unit === 'g' ? 'g' : defUnit(p);
    setText('#pl-weight-name', prodName(p));
    pwUnitUI(pw.unit, p);
    const inp = q('#pl-weight-input');
    inp.step = pw.unit === 'pc' ? '0.5' : '1';
    inp.min = pw.unit === 'pc' ? '0.5' : '1';
    inp.value = num(item.weight);
    pwHint();
    q('#pl-weight-modal').hidden = false;
    document.body.classList.add('no-scroll');
    inp.focus(); inp.select();
  }
  function closePortion() {
    setHidden('#pl-weight-modal', true);
    document.body.classList.remove('no-scroll');
    pw.date = null; pw.meal = null; pw.index = -1;
  }
  function pwHint() {
    const p = pwProduct();
    if (!p) return;
    const amount = Math.max(num(getVal('#pl-weight-input')), 0);
    const m = portion(p, amount, pw.unit);
    const g = pw.unit === 'pc' ? ` · ${Math.round(toGrams(p, amount, 'pc'))} г` : '';
    setText('#pl-weight-kcal', `${m.kcal} ккал${g}`);
  }
  function pwSetUnit(next) {
    const p = pwProduct();
    if (!p || next === pw.unit) return;
    if (next === 'pc' && !canPc(p)) return;
    if (next === 'ml' && !isDrink(p)) return;
    const inp = q('#pl-weight-input');
    const grams = toGrams(p, num(inp.value), pw.unit);
    const conv = next === 'pc' ? grams / num(p.piece) : next === 'ml' ? grams / density(p) : grams;
    inp.value = next === 'pc' ? Math.max(0.5, Math.round(conv * 2) / 2) : Math.max(1, Math.round(conv));
    inp.step = next === 'pc' ? '0.5' : '1';
    inp.min = next === 'pc' ? '0.5' : '1';
    pw.unit = next;
    pwUnitUI(next, p);
    pwHint();
  }
  function pwSave() {
    const p = pwProduct();
    if (!p || !pw.date) return;
    ensureScope();
    const item = dayOf(pw.date)[pw.meal][pw.index];
    if (!item) return;
    const raw = num(getVal('#pl-weight-input'));
    const amount = pw.unit === 'pc' ? clamp(Math.round(raw * 2) / 2, 0.5, 200) : clamp(Math.round(raw), 1, 5000);
    item.weight = amount;
    item.unit = pw.unit;
    if (canPc(p)) item.piece = num(p.piece); else delete item.piece;
    if (item.id) pushRecent(item.id, amount, pw.unit, item.piece);
    saveStore(); renderAll(); closePortion();
  }

  /* ---------------- 10. API ---------------- */
  const API_URL = 'https://polza.ai/api/v1/chat/completions';
  /* ВРЕМЕННЫЙ ключ — меняется только в этой строке и в script.js */
  const API_KEY = 'pza_b7larVmCnOBU30Ubv5waAoL5qtab0QJO';

  const AI_MODELS = [
    { id: 'google/gemini-3.7-flash',     label: 'Gemini 3.7 Flash',     note: 'быстрый · видит фото',      vision: true,  family: 'gemini' },
    { id: 'google/gemini-2.5-pro',       label: 'Gemini 2.5 Pro',       note: 'вдумчивый · видит фото',    vision: true,  family: 'gemini' },
    { id: 'google/gemini-3-pro-preview', label: 'Gemini 3 Pro Preview', note: 'самый точный · видит фото', vision: true,  family: 'gemini' },
    { id: 'qwen/qwen3.8-flash',          label: 'Qwen 3.8 Flash',       note: 'быстрый текст',             vision: false, family: 'qwen' },
    { id: 'qwen/qwen3.8-max',            label: 'Qwen 3.8 Max',         note: 'умный текст',               vision: false, family: 'qwen' },
    { id: 'qwen/qwen4-max',              label: 'Qwen 4 Max',           note: 'самый умный текст',         vision: false, family: 'qwen' },
  ];
  const DEFAULT_MODEL = 'google/gemini-3.7-flash';
  const VISION_CHAIN = ['google/gemini-3.7-flash', 'google/gemini-3-pro-preview', 'google/gemini-2.5-pro'];
  const HISTORY_CAP = 50;
  const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

  const modelMeta = (id) => AI_MODELS.find((m) => m.id === id) || AI_MODELS[0];
  const modelKey = () => key(S.uid, 'aimodel');

  function loadModel() {
    const saved = read(modelKey(), null);
    ai.model = AI_MODELS.some((m) => m.id === saved) ? saved : DEFAULT_MODEL;
  }
  function saveModel() { write(modelKey(), ai.model); }

  /* Строгая маршрутизация: отвечает именно выбранная модель */
  function textChain(id) {
    return [AI_MODELS.some((m) => m.id === id) ? id : DEFAULT_MODEL];
  }

  async function apiCall(body, timeout = 120000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        const e = new Error(`ответ ${res.status}${t ? ' · ' + t.slice(0, 160) : ''}`);
        e.status = res.status;
        throw e;
      }
      const data = await res.json();
      const choice = data?.choices?.[0] || {};
      const content = choice?.message?.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content) ? content.map((c) => c?.text || '').join('') : '';
      return { text, finish: String(choice?.finish_reason || '') };
    } catch (e) {
      if (e.name === 'AbortError') { const t = new Error('модель не ответила вовремя'); t.status = 408; throw t; }
      if (e instanceof TypeError) throw new Error('Браузер заблокировал запрос (CORS или сеть)');
      throw e;
    } finally { clearTimeout(timer); }
  }
  function makeBody(model, messages) {
    const body = { model, max_tokens: 8000, messages };
    if (model.includes('gemini-3')) { body.temperature = 1; body.reasoning_effort = 'low'; }
    else body.temperature = 0.6;
    return body;
  }
  async function apiCascade(models, messages) {
    const errors = [];
    for (const model of models) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try { return { ...(await apiCall(makeBody(model, messages))), model }; }
        catch (e) {
          errors.push(`${modelMeta(model).label}: ${e.message}`);
          const retry = RETRYABLE.has(e.status) || /502|503|429|500|504|вовремя/i.test(e.message);
          if (attempt === 1 && retry) { await sleep(1500); continue; }
          break;
        }
      }
    }
    throw new Error(errors.join(' | ') || 'Модели недоступны');
  }
  function extractJson(text) {
    const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('Модель не вернула JSON');
    return JSON.parse(t.slice(a, b + 1));
  }
  const shrink = (dataUrl, maxSide, quality) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    img.src = dataUrl;
  });
  const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Не удалось прочитать файл'));
    fr.readAsDataURL(file);
  });

  /* ---------------- 11. ФОТО-СКАНЕР БЛЮДА ---------------- */
  const SCAN_PROMPT = [
  'Ты нутрициолог и эксперт по оценке еды на фотографиях.',
  'ГЛАВНОЕ ПРАВИЛО: основа блюда — ОДНА позиция с кулинарным названием',
  '(«Рамен», «Пельмени отварные», «Мясо по-французски»), а НЕ набор сырых ингредиентов.',
  'ДОПОЛНИТЕЛЬНЫЕ ПРОДУКТЫ: всё, что подано как отдельный видимый компонент —',
  'яйцо, сыр, сметана, соус, грибы, нори, зелень, хлеб, гарнир, напиток, фрукт —',
  'выделяй ОТДЕЛЬНЫМИ позициями со своей массой и КБЖУ на 100 г,',
  'даже если они лежат сверху на блюде или рядом на тарелке.',
  'Не выделяй только то, что запечено или растворено внутри блюда',
  '(майонез и лук в запеканке, мясо в котлете): это часть основной позиции.',
  'Для основной позиции оцени массу БЕЗ отдельных компонентов и КБЖУ НА 100 Г готового блюда.',
  'Первая позиция items — главное блюдо, её name совпадает с полем dish.',
  'Если название блюда или продукта есть в справочнике из system-сообщения — используй ТОЧНО его:',
  'тогда КБЖУ приложение возьмёт из базы. Если нет — дай точное название и реальные КБЖУ на 100 г:',
  'приложение сохранит его как новый продукт базы.',
  'Отвечай ТОЛЬКО валидным JSON без markdown, схема:',
  '{ "dish": "Пельмени отварные", "items": [',
  '{ "name": "Пельмени отварные", "grams": 250, "kcal100": 275, "p100": 12, "f100": 12.5, "c100": 29 },',
  '{ "name": "Сметана 15%", "grams": 30, "kcal100": 158, "p100": 2.6, "f100": 15, "c100": 3 }',
  '], "notes": "краткая оговорка о погрешности" }',
  'Если еды на фото нет, верни { "dish": "", "items": [], "notes": "причина" }.',
].join('\n');

const scanCatalogText = () => allProds().map((p) => prodName(p)).join('; ');
const scanSystemPrompt = () => [
  'Ты нутрициолог. Отвечай только валидным JSON без markdown.',
  'СПРАВОЧНИК НАЗВАНИЙ ПРИЛОЖЕНИЯ. Если блюдо или продукт есть в списке — используй ТОЧНО это имя:',
  scanCatalogText(),
].join('\n');

function registerScanProduct(it) {
  const name = String(it.name || '').trim();
  if (!name) return null;
  const exist = exactByName(name);
  if (exist) return exist.id;
  if (!(num(it.kcal100) > 0 || num(it.p100) > 0 || num(it.f100) > 0 || num(it.c100) > 0)) return null;
  const id = 'dish-' + uidRand();
  const prod = {
    id, name, fullName: name, brand: '', cat: 'custom',
    kcal: num(it.kcal100), p: num(it.p100), f: num(it.f100), c: num(it.c100),
    unit: 'g', piece: 0, pack: 0, own: true, ts: Date.now(), source: 'scan',
  };
  S.custom = [prod, ...S.custom].slice(0, 400);
  saveCustom();
  return id;
}

  const scan = { date: null, meal: null, dataUrl: '', thumb: '', items: [], dish: '', note: '', seq: 0, busy: false };

  function matchProd(name) {
    const qn = normName(name);
    if (!qn) return null;
    const qt = qn.split(' ').filter((w) => w.length > 2);
    let best = null;
    for (const p of allProds()) {
      const pn = normName(prodName(p));
      if (pn === qn) return p.id;
      let hit = 0;
      for (const w of qt) if (pn.includes(w)) hit++;
      const score = hit / Math.max(qt.length, 1) + ((pn.includes(qn) || qn.includes(pn)) ? 0.5 : 0);
      if (score >= 0.6 && (!best || score > best.score)) best = { id: p.id, score };
    }
    return best ? best.id : null;
  }
  function normalizeItems(raw) {
    const arr = Array.isArray(raw?.items) ? raw.items : [];
    return arr.slice(0, 12).map((it) => ({
      name: String(it.name || 'Позиция').slice(0, 60),
      grams: clamp(Math.round(num(it.grams) || 100), 1, 5000),
      kcal100: num(it.kcal100), p100: num(it.p100), f100: num(it.f100), c100: num(it.c100),
      matchedId: matchProd(it.name),
    })).filter((it) => it.name);
  }
  const scanPortion = (it) => {
    const db = it.matchedId ? getProd(it.matchedId) : null;
    if (db) return portion(db, it.grams, 'g');
    const k = it.grams / 100;
    return {
      kcal: Math.round(num(it.kcal100) * k),
      p: +(num(it.p100) * k).toFixed(1),
      f: +(num(it.f100) * k).toFixed(1),
      c: +(num(it.c100) * k).toFixed(1),
    };
  };
  const scanTotals = () => {
    const t = { kcal: 0, p: 0, f: 0, c: 0 };
    scan.items.forEach((it) => { const m = scanPortion(it); t.kcal += m.kcal; t.p += m.p; t.f += m.f; t.c += m.c; });
    return t;
  };
  function scanItemsToBucket(items, bucket) {
  (items || []).forEach((it) => {
    let id = it.matchedId && getProd(it.matchedId) ? it.matchedId : null;
    if (!id) id = registerScanProduct(it);
    if (id) {
      it.matchedId = id;
      bucket.push({ id, weight: it.grams, unit: 'g' });
      pushRecent(id, it.grams, 'g', 0);
    } else {
      bucket.push({
        custom: { name: it.name, kcal100: num(it.kcal100), p100: num(it.p100), f100: num(it.f100), c100: num(it.c100) },
        weight: it.grams, unit: 'g',
      });
    }
  });
}
  function scanStage(stage) {
    setHidden('#pl-scan-pick', stage !== 'pick');
    setHidden('#pl-scan-busy', stage !== 'busy');
    setHidden('#pl-scan-result', stage !== 'result');
    setHidden('#pl-scan-error', stage !== 'error');
  }
  function openScan(date, meal) {
    ensureScope();
    scan.seq++; scan.date = date; scan.meal = meal; scan.busy = false;
    setText('#pl-scan-target', `${MEAL_NAME[meal]}, ${dayLabel(fromKey(date))}`);
    renderScanGallery();
    scanStage('pick');
    q('#pl-scan-modal').hidden = false;
    document.body.classList.add('no-scroll');
  }
  function closeScan() {
    scan.seq++; scan.busy = false;
    setHidden('#pl-scan-modal', true);
    document.body.classList.remove('no-scroll');
  }

  /* Галерея сохранённых фото прямо в окне сканера */
  function renderScanGallery() {
    const wrap = q('#pl-scan-gallery-wrap');
    const grid = q('#pl-scan-gallery');
    if (!wrap || !grid) return;
    const pool = allPhotos();
    wrap.hidden = pool.length === 0;
    setText('#pl-scan-gallery-count', String(pool.length));
    grid.innerHTML = pool.map((ph) => `<li class="scan__gallery-card">
      <button type="button" data-pl-gallery="${esc(ph.id)}" aria-label="Добавить ${esc(ph.dish)}">
        <img src="${ph.img}" alt="${esc(ph.dish)}" loading="lazy">
        <span class="scan__gallery-name">${esc(ph.dish)}</span>
        <span class="scan__gallery-kcal">${num(ph.kcal)} ккал${ph.from === 'diary' ? ' · дневник' : ''}</span>
      </button>
    </li>`).join('');
  }
  function addGalleryPhoto(id) {
    if (!scan.date || !scan.meal) return;
    const ph = allPhotos().find((x) => x.id === id);
    if (!ph) return;
    ensureScope();
    const bucket = dayOf(scan.date)[scan.meal];
    scanItemsToBucket(ph.items, bucket);
    saveStore(); renderAll();
    toast(`${ph.dish} → ${MEAL_NAME[scan.meal]}: ${num(ph.kcal)} ккал`);
    closeScan();
  }

  async function scanFile(file) {
    if (!file || !file.type.startsWith('image/')) { toast('Нужен файл изображения'); return; }
    try {
      const raw = await fileToDataUrl(file);
      scan.dataUrl = await shrink(raw, 1024, 0.8);
      scan.thumb = await shrink(raw, 560, 0.62);
      runScan();
    } catch (e) {
      setText('#pl-scan-error-text', e.message || 'Не удалось прочитать фото');
      scanStage('error');
    }
  }
  async function runScan() {
    if (!scan.dataUrl) { scanStage('pick'); return; }
    const token = ++scan.seq;
    scan.busy = true;
    scanStage('busy');
    q('#pl-scan-img').src = scan.dataUrl;
    setText('#pl-scan-status', 'Сканирую фото…');
    try {
      const { text } = await apiCascade(VISION_CHAIN, [
        { role: 'system', content: scanSystemPrompt() },
        { role: 'user', content: [{ type: 'text', text: SCAN_PROMPT }, { type: 'image_url', image_url: { url: scan.dataUrl } }] },
      ]);
      if (token !== scan.seq) return;
      const raw = extractJson(text);
      const items = normalizeItems(raw);
      if (!items.length) throw new Error(raw?.notes || 'На фото не найдено еды');
      scan.items = items;
      scan.dish = String(raw.dish || items.map((i) => i.name).join(', ')).slice(0, 90);
      scan.note = String(raw.notes || '').slice(0, 200);
      scanRender();
      scanStage('result');
      scan.busy = false;
    } catch (e) {
      if (token !== scan.seq) return;
      scan.busy = false;
      setText('#pl-scan-error-text', e.message || 'Не удалось распознать фото');
      scanStage('error');
    }
  }
  function scanRender() {
    q('#pl-scan-img2').src = scan.thumb || scan.dataUrl;
    setText('#pl-scan-dish', scan.dish || 'Блюдо');
    q('#pl-scan-items').innerHTML = scan.items.map((it) => {
      const m = scanPortion(it);
      return `<li class="scan__item">
        <span class="scan__item-name">${esc(it.name)}${it.matchedId ? ' <em class="scan__item-db">из базы</em>' : ''}</span>
        <span class="scan__item-g">${it.grams} г</span>
        <span class="scan__item-kcal">${m.kcal} ккал</span>
        <span class="scan__item-macros">Б ${dec(m.p)} · Ж ${dec(m.f)} · У ${dec(m.c)}</span>
      </li>`;
    }).join('');
    const t = scanTotals();
    setText('#pl-scan-total', `${int(t.kcal)} ккал`);
    setText('#pl-scan-macros', `Б ${dec(t.p)} · Ж ${dec(t.f)} · У ${dec(t.c)}`);
    setText('#pl-scan-note', scan.note);
  }
  function scanAdd() {
    if (!scan.items.length || !scan.date) return;
    ensureScope();
    const bucket = dayOf(scan.date)[scan.meal];
    scanItemsToBucket(scan.items, bucket);
    const t = scanTotals();
    S.photos = [{
      id: 'pph' + uidRand(), ts: Date.now(), dish: scan.dish, kcal: Math.round(t.kcal),
      img: scan.thumb, items: scan.items.map((i) => ({ ...i })),
    }, ...S.photos].slice(0, 12);
    saveStore(); renderAll();
    toast(`${scan.dish} → ${MEAL_NAME[scan.meal]}: ${int(t.kcal)} ккал`);
    closeScan();
  }

  /* ---------------- 12. ШТРИХКОД ---------------- */
  const bc = {
    date: null, meal: null, code: '', product: null, unit: 'g', amount: 1,
    stream: null, timer: 0, detector: null, reader: null, controls: null, seq: 0, candidates: [],
  };
  const BC_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'];
  const hasNative = () => 'BarcodeDetector' in window;
  const hasZxing = () => typeof ZXing !== 'undefined' && Boolean(ZXing.BrowserMultiFormatReader);
  const canCam = () => Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  const eanValid = (code) => {
    if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
    const d = code.split('').map(Number);
    const check = d.pop();
    const sum = d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === check;
  };
  function bcStatus(text, kind) {
    const el = q('#pl-bc-status');
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind || 'info';
  }
  function bcStage(stage) {
    ['start', 'search', 'result', 'new'].forEach((s) => setHidden('#pl-bc-' + s, s !== stage));
  }
  function bcSavedRender() {
    const wrap = q('#pl-bc-saved-wrap'), list = q('#pl-bc-saved');
    if (!wrap || !list) return;
    wrap.hidden = S.barcodes.length === 0;
    list.innerHTML = S.barcodes.slice(0, 12).map((b) => `<li class="bc__chip">
      <button type="button" data-pl-bc-open="${esc(b.code)}" title="${esc(b.code)}">${esc(b.fullName || b.name)}</button>
      <button type="button" class="bc__chip-x" data-pl-bc-del="${esc(b.code)}" aria-label="Удалить код ${esc(b.code)}">×</button>
    </li>`).join('');
  }
  function bcSaveEntry(entry) {
    S.barcodes = [entry, ...S.barcodes.filter((b) => String(b.code) !== entry.code)].slice(0, 200);
    write(key(S.uid, 'barcodes'), S.barcodes);
    rebuildProducts();
    bcSavedRender();
  }
  function openBc(date, meal) {
    ensureScope();
    bc.seq++; bc.date = date; bc.meal = meal; bc.candidates = [];
    setText('#pl-bc-target', `${MEAL_NAME[meal]}, ${dayLabel(fromKey(date))}`);
    setVal('#pl-bc-input', '');
    bcStage('start');
    bcStatus('Наведите камеру на штрихкод или введите цифры вручную.', 'info');
    bcSavedRender();
    q('#pl-bc-modal').hidden = false;
    document.body.classList.add('no-scroll');
  }
  function closeBc() {
    bcStop();
    bc.seq++;
    setHidden('#pl-bc-modal', true);
    document.body.classList.remove('no-scroll');
  }
  function zxReader() {
    if (bc.reader) return bc.reader;
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39,
    ]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    bc.reader = new ZXing.BrowserMultiFormatReader(hints, 250);
    return bc.reader;
  }
  async function nativeDetector() {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = BC_FORMATS.filter((f) => supported.includes(f));
    return new window.BarcodeDetector(formats.length ? { formats } : undefined);
  }
  async function bcStartCam() {
    const video = q('#pl-bc-video');
    if (!video) return;
    if (!canCam()) { bcStatus('Камера недоступна. Введите цифры вручную.', 'warn'); return; }
    if (hasNative()) {
      try {
        bc.detector = await nativeDetector();
        bc.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        video.srcObject = bc.stream;
        await video.play();
        setHidden('#pl-bc-camera', false);
        bcStatus('Камера включена. Держите штрихкод внутри рамки.', 'good');
        bcLoop();
        return;
      } catch { bcStop(); }
    }
    if (hasZxing()) {
      try {
        const reader = zxReader();
        setHidden('#pl-bc-camera', false);
        bcStatus('Камера включена. Держите штрихкод внутри рамки.', 'good');
        bc.controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } }, audio: false },
          video,
          (result) => {
            if (!result) return;
            const raw = String(result.getText() || '').replace(/\D/g, '');
            if (!raw) return;
            bcStop();
            handleCode(raw);
          }
        );
        return;
      } catch (e) {
        bcStop();
        bcStatus('Камера недоступна: ' + (e.message || e.name) + '. Введите цифры вручную.', 'bad');
        return;
      }
    }
    bcStatus('Сканер камеры не загрузился. Проверьте интернет или введите цифры вручную.', 'warn');
  }
  function bcLoop() {
    clearTimeout(bc.timer);
    const tick = async () => {
      if (!bc.stream || !bc.detector) return;
      const video = q('#pl-bc-video');
      try {
        const found = await bc.detector.detect(video);
        const raw = found?.[0]?.rawValue?.replace(/\D/g, '');
        if (raw) { bcStop(); handleCode(raw); return; }
      } catch { /* кадр не готов */ }
      bc.timer = setTimeout(tick, 200);
    };
    bc.timer = setTimeout(tick, 200);
  }
  function bcStop() {
    clearTimeout(bc.timer); bc.timer = 0;
    if (bc.controls) { try { bc.controls.stop(); } catch { /* уже остановлено */ } bc.controls = null; }
    if (bc.stream) { bc.stream.getTracks().forEach((t) => t.stop()); bc.stream = null; }
    if (bc.reader) { try { bc.reader.reset(); } catch { /* нечего сбрасывать */ } }
    const v = q('#pl-bc-video'); if (v) v.srcObject = null;
    setHidden('#pl-bc-camera', true);
  }
  async function bcFromImage(file) {
    if (!file || !file.type.startsWith('image/')) { bcStatus('Нужен файл изображения.', 'bad'); return; }
    bcStatus('Читаю штрихкод на фото…', 'info');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Не удалось открыть изображение'));
        i.src = url;
      });
      if (hasNative()) {
        try {
          const det = await nativeDetector();
          const found = await det.detect(img);
          const raw = found?.[0]?.rawValue?.replace(/\D/g, '');
          if (raw) { handleCode(raw); return; }
        } catch { /* переходим к ZXing */ }
      }
      if (hasZxing()) {
        const reader = zxReader();
        const attempts = [img];
        const k = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
        if (k < 1 && typeof reader.decodeFromCanvas === 'function') {
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * k));
          c.height = Math.max(1, Math.round(img.naturalHeight * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          attempts.push(c);
        }
        for (const src of attempts) {
          try {
            const res = src instanceof HTMLCanvasElement
              ? await reader.decodeFromCanvas(src)
              : await reader.decodeFromImageElement(src);
            const raw = String(res?.getText?.() || '').replace(/\D/g, '');
            if (raw) { handleCode(raw); return; }
          } catch { /* пробуем следующий вариант */ }
        }
      }
      bcStatus('На фото штрихкод не найден. Снимите ближе и ровнее или введите цифры.', 'warn');
    } catch (e) {
      bcStatus('Не удалось прочитать фото: ' + (e.message || e.name), 'bad');
    } finally { URL.revokeObjectURL(url); }
  }
  async function worldLookup(code, onProgress) {
    if (typeof BarcodeSources === 'undefined') return null;
    try { return await BarcodeSources.lookup(code, { onProgress }); }
    catch { return null; }
  }
  async function handleCode(raw) {
    const code = String(raw || '').replace(/\D/g, '');
    if (code.length < 8) { bcStage('start'); bcStatus('Штрихкод содержит 8–14 цифр. Проверьте ввод.', 'bad'); return; }
    const token = ++bc.seq;
    bc.code = code; bc.product = null; bc.candidates = [];
    setText('#pl-bc-code-search', code);
    bcStage('search');
    bcStatus(eanValid(code) ? 'Ищу товар…' : 'Контрольная сумма не сходится — проверьте цифры. Всё равно ищу.', eanValid(code) ? 'info' : 'warn');

    const local = findCode(code);
    if (local) {
      if (token !== bc.seq) return;
      bcPrepare(local); bcRender(); bcStage('result');
      bcStatus('Товар найден в вашей базе. Проверьте порцию и добавьте в план.', 'good');
      return;
    }
    const remote = await worldLookup(code, (step, total) => {
      if (token !== bc.seq) return;
      setText('#pl-bc-status', `Ищу товар… шаг ${step} из ${total}`);
    });
    if (token !== bc.seq) return;
    if (remote && remote.hasNutrition && remote.exact) {
      bcPrepare(remote); bcRender(); bcStage('result');
      bcStatus('Товар найден по штрихкоду. Сверьте цифры с упаковкой.', 'good');
      return;
    }
    if (remote && Array.isArray(remote.candidates) && remote.candidates.length) {
      bc.candidates = remote.candidates;
      setText('#pl-bc-code-new', code);
      setVal('#pl-bc-find-input', remote.query || [remote.brand, remote.name].filter(Boolean).join(' '));
      bcFindRender();
      setText('#pl-bc-find-hint', 'Российские позиции показаны первыми. Нажмите на точный товар.');
      bcNewFill(remote);
      bcStage('new');
      bcStatus('Точного совпадения нет — выберите товар из списка или заполните карточку.', 'warn');
      return;
    }
    bcNewFill(remote);
    bcStage('new');
    bcStatus('Данный штрихкод не состоит в базе данных', 'warn');
  }
  function bcNewFill(partial) {
    setText('#pl-bc-code-new', bc.code);
    const name = partial ? (partial.fullName || partial.name || '') : '';
    setVal('#pl-bc-new-name', name);
    setVal('#pl-bc-new-brand', partial && partial.brand ? partial.brand : '');
    setVal('#pl-bc-new-kcal', partial && num(partial.kcal) > 0 ? Math.round(num(partial.kcal)) : 0);
    setVal('#pl-bc-new-p', partial ? num(partial.p) : 0);
    setVal('#pl-bc-new-f', partial ? num(partial.f) : 0);
    setVal('#pl-bc-new-c', partial ? num(partial.c) : 0);
    setVal('#pl-bc-new-pack', partial ? num(partial.pack) : 0);
    setVal('#pl-bc-new-piece', partial ? num(partial.piece) : 0);
    setVal('#pl-bc-new-unit', partial && partial.unit === 'ml' ? 'ml' : 'g');
    setVal('#pl-bc-new-amount', 100);
    if (!getVal('#pl-bc-find-input')) setVal('#pl-bc-find-input', name);
    if (!bc.candidates.length) { const fl = q('#pl-bc-find-list'); if (fl) fl.innerHTML = ''; }
  }
  function bcFindRender() {
    const list = q('#pl-bc-find-list');
    if (!list) return;
    if (!bc.candidates.length) {
      list.innerHTML = '<li class="bc-find__empty">Ничего не найдено. Заполните карточку вручную.</li>';
      return;
    }
    list.innerHTML = bc.candidates.map((it, i) => {
      const pack = num(it.pack) > 0 ? `, ${dec(it.pack)} ${it.unit === 'ml' ? 'мл' : 'г'}` : '';
      const kcal = it.hasNutrition ? `${Math.round(num(it.kcal))} ккал / 100 ${it.unit === 'ml' ? 'мл' : 'г'}` : 'КБЖУ нет';
      return `<li><button class="bc-find__item" type="button" data-pl-bc-pick="${i}">
        <span class="bc-find__name">${esc(it.fullName || it.name)}${pack ? `<em>${esc(pack)}</em>` : ''}${it.ru ? '<em class="bc-find__ru">РФ</em>' : ''}</span>
        <span class="bc-find__kcal">${kcal}</span>
      </button></li>`;
    }).join('');
  }
  async function bcFindSubmit(event) {
    if (event) event.preventDefault();
    const query = getVal('#pl-bc-find-input').trim();
    if (query.length < 3) { setText('#pl-bc-find-hint', 'Введите минимум 3 символа.'); return; }
    if (typeof BarcodeSources === 'undefined') { setText('#pl-bc-find-hint', 'Модуль поиска не подключён.'); return; }
    const list = q('#pl-bc-find-list');
    if (list) list.innerHTML = '<li class="bc-find__empty">Ищу по базам…</li>';
    setText('#pl-bc-find-hint', 'Опрашиваю базы товаров…');
    try {
      const found = await BarcodeSources.search(query, { limit: 14, expectPack: num(getVal('#pl-bc-new-pack')) });
      bc.candidates = found;
      bcFindRender();
      setText('#pl-bc-find-hint', found.length ? `Найдено позиций: ${found.length}. Нажмите на точный товар.` : 'Ничего не найдено. Заполните карточку вручную.');
    } catch (e) {
      if (list) list.innerHTML = `<li class="bc-find__empty">${esc(e.message || 'Базы недоступны')}</li>`;
      setText('#pl-bc-find-hint', 'Проверьте соединение или заполните карточку вручную.');
    }
  }
  function bcApplyCandidate(i) {
    const it = bc.candidates[i];
    if (!it) return;
    setVal('#pl-bc-new-name', it.fullName || it.name || '');
    setVal('#pl-bc-new-brand', it.brand || '');
    setVal('#pl-bc-new-kcal', Math.round(num(it.kcal)));
    setVal('#pl-bc-new-p', num(it.p));
    setVal('#pl-bc-new-f', num(it.f));
    setVal('#pl-bc-new-c', num(it.c));
    setVal('#pl-bc-new-pack', num(it.pack));
    setVal('#pl-bc-new-piece', num(it.piece));
    setVal('#pl-bc-new-unit', it.unit === 'ml' ? 'ml' : 'g');
    setVal('#pl-bc-new-amount', num(it.piece) > 0 ? 1 : it.unit === 'ml' ? 250 : 100);
    toast(it.hasNutrition ? 'Данные подставлены — сверьте с упаковкой' : 'Название подставлено, КБЖУ впишите вручную');
  }
  function bcPrepare(p) {
    bc.product = {
      id: p.id || null, name: p.name || '', fullName: p.fullName || p.name || '', brand: p.brand || '',
      kcal: num(p.kcal), p: num(p.p), f: num(p.f), c: num(p.c),
      piece: num(p.piece), pack: num(p.pack), cat: p.cat || (p.unit === 'ml' ? 'drinks' : 'barcode'),
      unit: p.unit === 'ml' ? 'ml' : 'g',
    };
    bc.unit = defUnit(bc.product);
    bc.amount = defAmount(bc.unit);
  }
  function bcRender() {
    const p = bc.product;
    if (!p) return;
    setText('#pl-bc-code', bc.code);
    setText('#pl-bc-name', p.fullName || p.name);
    const brand = q('#pl-bc-brand');
    if (brand) { brand.textContent = p.brand || ''; brand.hidden = !p.brand; }
    setText('#pl-bc-kcal100', String(Math.round(num(p.kcal))));
    setText('#pl-bc-p100', dec(p.p));
    setText('#pl-bc-f100', dec(p.f));
    setText('#pl-bc-c100', dec(p.c));
    const pc = canPc(p), ml = isDrink(p);
    const units = q('#pl-bc-units');
    if (units) {
      qa('.bc__unit-btn', units).forEach((b) => {
        const u = b.dataset.bcUnit;
        const avail = u === 'pc' ? pc : u === 'ml' ? ml : true;
        b.hidden = !avail;
        b.classList.toggle('is-active', u === bc.unit);
        b.setAttribute('aria-pressed', String(u === bc.unit));
      });
      units.hidden = !pc && !ml;
    }
    const packEl = q('#pl-bc-pack');
    if (packEl) {
      const parts = [];
      if (num(p.pack) > 0) {
        const pcs = pc ? Math.round(num(p.pack) / num(p.piece)) : 0;
        parts.push(`упаковка ${dec(p.pack)} ${p.unit === 'ml' ? 'мл' : 'г'}${pcs > 1 ? ` ≈ ${pcs} шт` : ''}`);
      }
      if (pc) parts.push(`1 шт ≈ ${dec(p.piece)} г`);
      packEl.textContent = parts.join(' · ');
      packEl.hidden = parts.length === 0;
    }
    const inp = q('#pl-bc-amount');
    if (inp) {
      inp.step = bc.unit === 'pc' ? '0.5' : '1';
      inp.min = bc.unit === 'pc' ? '0.5' : '1';
      inp.max = bc.unit === 'pc' ? '200' : '5000';
      inp.value = bc.amount;
    }
    setText('#pl-bc-unit', unitLabel(bc.unit));
    bcTotal();
  }
  function bcReadAmount() {
    const raw = num(getVal('#pl-bc-amount')) || bc.amount;
    return bc.unit === 'pc' ? clamp(Math.round(raw * 2) / 2, 0.5, 200) : clamp(Math.round(raw), 1, 5000);
  }
  function bcTotal() {
    const p = bc.product;
    if (!p) return;
    bc.amount = bcReadAmount();
    const m = portion(p, bc.amount, bc.unit);
    const g = bc.unit === 'pc' ? ` · ${Math.round(toGrams(p, bc.amount, 'pc'))} г` : '';
    setText('#pl-bc-total', `${m.kcal} ккал${g} · Б ${dec(m.p)} · Ж ${dec(m.f)} · У ${dec(m.c)}`);
  }
  function bcSetUnit(next) {
    const p = bc.product;
    if (!p || next === bc.unit) return;
    if (next === 'pc' && !canPc(p)) return;
    if (next === 'ml' && !isDrink(p)) return;
    const grams = toGrams(p, bc.amount, bc.unit);
    bc.unit = next;
    bc.amount = next === 'pc' ? Math.max(0.5, Math.round((grams / num(p.piece)) * 2) / 2)
      : next === 'ml' ? Math.max(1, Math.round(grams / density(p)))
      : Math.max(1, Math.round(grams));
    bcRender();
  }
  function bcStep(dir) {
    const step = bc.unit === 'pc' ? 1 : (bc.amount >= 200 ? 50 : 10);
    const next = bc.amount + dir * step;
    bc.amount = bc.unit === 'pc' ? clamp(Math.round(next * 2) / 2, 0.5, 200) : clamp(Math.round(next), 1, 5000);
    setVal('#pl-bc-amount', bc.amount);
    bcTotal();
  }
  function bcAdd() {
    const p = bc.product;
    if (!p || !bc.date) return;
    if (!(p.kcal > 0 || p.p > 0 || p.f > 0 || p.c > 0)) {
      bcStatus('У товара нет КБЖУ — заполните карточку вручную.', 'bad');
      bcNewFill(p); bcStage('new');
      return;
    }
    ensureScope();
    const amount = bcReadAmount(), unit = bc.unit, piece = num(p.piece);
    if (!isShipped(bc.code)) {
      bcSaveEntry({
        code: bc.code, name: p.fullName || p.name, fullName: p.fullName || p.name, brand: p.brand || '',
        kcal: num(p.kcal), p: num(p.p), f: num(p.f), c: num(p.c),
        unit: isDrink(p) ? 'ml' : 'g', piece, pack: num(p.pack), own: true, ts: Date.now(),
      });
    }
    const id = p.id && getProd(p.id) ? p.id : 'bc-' + bc.code;
    const prod = getProd(id);
    const bucket = dayOf(bc.date)[bc.meal];
    if (prod) {
      const item = { id, weight: amount, unit };
      if (piece > 0) item.piece = piece;
      bucket.push(item);
      pushRecent(id, amount, unit, piece);
    } else {
      bucket.push({ custom: { name: p.fullName || p.name, kcal100: num(p.kcal), p100: num(p.p), f100: num(p.f), c100: num(p.c), piece }, weight: amount, unit });
    }
    saveStore(); renderAll();
    const m = portion(prod || p, amount, unit);
    toast(`${p.fullName || p.name} → ${MEAL_NAME[bc.meal]}: ${m.kcal} ккал`);
    closeBc();
  }
  function bcNewAdd() {
    const name = getVal('#pl-bc-new-name').trim();
    if (!name) { bcStatus('Введите название товара.', 'bad'); const el = q('#pl-bc-new-name'); if (el) el.focus(); return; }
    const kcal = clamp(num(getVal('#pl-bc-new-kcal')), 0, 900);
    const p = clamp(num(getVal('#pl-bc-new-p')), 0, 100);
    const f = clamp(num(getVal('#pl-bc-new-f')), 0, 100);
    const c = clamp(num(getVal('#pl-bc-new-c')), 0, 100);
    if (!(kcal > 0 || p > 0 || f > 0 || c > 0)) { bcStatus('Впишите хотя бы калорийность с упаковки.', 'bad'); const el = q('#pl-bc-new-kcal'); if (el) el.focus(); return; }
    ensureScope();
    const unit = getVal('#pl-bc-new-unit') === 'ml' ? 'ml' : 'g';
    const piece = clamp(num(getVal('#pl-bc-new-piece')), 0, 2000);
    const pack = clamp(num(getVal('#pl-bc-new-pack')), 0, 20000);
    bcSaveEntry({ code: bc.code, name, fullName: name, brand: getVal('#pl-bc-new-brand').trim(), kcal, p, f, c, unit, piece, pack, own: true, ts: Date.now() });
    const amount = clamp(Math.round(num(getVal('#pl-bc-new-amount')) || 100), 1, 5000);
    const id = 'bc-' + bc.code;
    const prod = getProd(id);
    const item = { id, weight: amount, unit };
    if (piece > 0) item.piece = piece;
    dayOf(bc.date)[bc.meal].push(item);
    pushRecent(id, amount, unit, piece);
    saveStore(); renderAll();
    const m = prod ? portion(prod, amount, unit) : { kcal: 0 };
    toast(`${name} сохранён и добавлен: ${m.kcal} ккал`);
    closeBc();
  }

  /* ---------------- 13. ПОДТВЕРЖДЕНИЕ ---------------- */
  let confirmAction = null;
  function askConfirm(title, text, okLabel, action) {
    setText('#pl-confirm-title', title);
    setText('#pl-confirm-text', text);
    setText('#pl-confirm-ok', okLabel);
    confirmAction = action;
    q('#pl-confirm-modal').hidden = false;
    document.body.classList.add('no-scroll');
  }
  function closeConfirm() {
    confirmAction = null;
    setHidden('#pl-confirm-modal', true);
    document.body.classList.remove('no-scroll');
  }

  /* ---------------- 14. КОНТЕКСТ ИИ ---------------- */
  const STAPLES = [
    'oatmeal-water', 'oatmeal-milk', 'buckwheat-boiled', 'rice-boiled', 'pasta-boiled',
    'potato-boiled', 'potato-mashed', 'bread-rye', 'bread-whole', 'lavash',
    'chicken-fillet-boil', 'chicken-fillet-grill', 'turkey-fillet-boil', 'beef-boiled',
    'pork-lean', 'egg-boiled', 'omelette', 'egg-chicken',
    'cod-boiled', 'salmon-baked', 'tuna-can-own', 'shrimp-boiled',
    'tvorog-5', 'tvorog-2', 'yogurt-greek', 'yogurt-natural', 'kefir-1', 'milk-25',
    'cheese-russian', 'sour-cream-15', 'butter',
    'tomato', 'cucumber', 'cabbage-white', 'broccoli-boiled', 'carrot', 'onion',
    'apple', 'banana', 'orange', 'pear', 'grape',
    'beans-boiled', 'lentils-boiled', 'chickpeas-boiled', 'tofu', 'hummus',
    'walnut', 'almond', 'peanut-butter', 'oil-olive', 'honey',
    'borsch-meat', 'chicken-noodle', 'olivier', 'greek', 'caesar-chicken',
    'plov-uzbek', 'manti', 'khinkali', 'echpochmak', 'syrniki', 'pancakes',
    'tea-black', 'coffee-milk', 'cappuccino', 'juice-orange', 'water',
  ];
  function catalogForApi() {
    const pool = allProds();
    const byId = new Map(pool.map((p) => [p.id, p]));
    const userText = ai.msgs.filter((m) => m.role === 'user').slice(-6).map((m) => m.text).join(' ');
    const qt = normName(userText).split(' ').filter((w) => w.length > 3);
    const scored = pool.map((p) => {
      const pn = normName(prodName(p));
      let s = 0;
      qt.forEach((w) => { if (pn.includes(w)) s += 2; });
      if (p.own) s += 3;
      return { p, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    const chosen = new Map();
    STAPLES.forEach((id) => { const p = byId.get(id); if (p) chosen.set(p.id, p); });
    (S.custom || []).forEach((p) => { const full = getProd(p.id); if (full) chosen.set(full.id, full); });
    scored.slice(0, 150).forEach(({ p }) => chosen.set(p.id, p));
    if (chosen.size < 120) pool.slice(0, 120).forEach((p) => chosen.set(p.id, p));
    const lines = [...chosen.values()].slice(0, 240).map((p) =>
      `${prodName(p)} — ${num(p.kcal)} ккал/100${isDrink(p) ? 'мл' : 'г'} (Б${dec(p.p)} Ж${dec(p.f)} У${dec(p.c)})${canPc(p) ? `, 1 шт ≈ ${dec(p.piece)} г` : ''}`
    );
    return { text: lines.join('\n'), total: pool.length, shown: lines.length };
  }
  function weekMapForApi() {
    const days = weekDays();
    const cur = days.map((d) => `${WD[d.getDay()]} = ${dk(d)}`).join('; ');
    const next = days.map((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return `${WD[n.getDay()]} следующей недели = ${dk(n)}`; }).join('; ');
    return { cur, next };
  }
  function planSnapshotForApi() {
    const planner = weekDays().map((d) => {
      const k = dk(d);
      const t = dayTotals(k);
      const meals = MEALS.map(([mk, mn]) => {
        const items = (dayOf(k)[mk] || []).map((it) => {
          const p = itemProd(it);
          return p ? `${prodName(p)} ${amtText(num(it.weight), it.unit)}${unitLabel(it.unit)}` : '';
        }).filter(Boolean);
        return items.length ? `${mn}: ${items.join(', ')}` : '';
      }).filter(Boolean);
      return `${WD[d.getDay()]} ${k} (${Math.round(t.kcal)} ккал)${meals.length ? ' → ' + meals.join(' | ') : ' — пусто'}`;
    }).join('\n');
    const diary = read(key(S.uid, 'diary'), {});
    const diaryText = weekDays().map((d) => {
      const k = dk(d);
      const day = diary[k] || {};
      const meals = MEALS.map(([mk, mn]) => {
        const items = (Array.isArray(day[mk]) ? day[mk] : []).map((it) => {
          const p = itemProd(it);
          return p ? `${prodName(p)} ${amtText(num(it.weight), it.unit)}${unitLabel(it.unit)}` : '';
        }).filter(Boolean);
        return items.length ? `${mn}: ${items.join(', ')}` : '';
      }).filter(Boolean);
      return `${WD[d.getDay()]} ${k}${meals.length ? ' → ' + meals.join(' | ') : ' — пусто'}`;
    }).join('\n');
    return { planner, diary };
  }

  const AI_RULES = [
    'Ты — ИИ-нутрициолог приложения NutriFlow. Отвечай по-русски, тепло и по делу.',
    'Ты видишь последние 50 сообщений переписки и справочник продуктов приложения.',
    '',
    'ТВОЯ ЗАДАЧА: помогать пользователю составлять рацион под его цель и калорийность.',
    'ГЛАВНОЕ ПРАВИЛО БЛЮДА: вноси готовое блюдо ОДНОЙ позицией с главным названием («Мясо по-французски», «Пельмени отварные»), не разбирай его на ингредиенты.',
    'Отдельными позициями добавляй только самостоятельные продукты рядом: сметана, соус, хлеб, гарнир, напиток (пример: «Пельмени отварные» + «Сметана 15%»).',
    'Если готового блюда нет в справочнике — обязательно добавь его в newProducts с КБЖУ на 100 г и используй то же название в days.',
    'Всегда учитывай: названную суточную норму калорий, цель (похудение / набор / поддержание),',
    'пищевые ограничения и вкусы из переписки (вегетарианство, аллергии, нелюбимые продукты),',
    'а также то, что уже стоит в планировщике и дневнике — не дублируй и не ломай заполненное.',
    'Если норма калорий или ограничения ещё не названы — сначала коротко уточни их.',
    'Предлагай конкретные блюда с порциями в граммах и примерными КБЖУ, следи за балансом белка.',
    '',
    'ТВОИ ВОЗМОЖНОСТИ:',
    '1. Составлять рацион на любой день или неделю, опираясь на справочник ниже.',
    '2. Добавлять НОВЫЕ продукты в справочник (newProducts) с реальными КБЖУ на 100 г.',
    '3. Заполнять планировщик (target "planner") или дневник питания (target "diary") по датам.',
    '4. Удалять конкретные блюда из планировщика/дневника (remove) или очищать день (clearDays).',
    '',
    'ЗАПРЕЩЕНО: удалять или изменять продукты в справочнике. Таких команд не существует.',
    '',
    'ГЛАВНОЕ ПРАВИЛО БЕЗОПАСНОСТИ: ты НИКОГДА не меняешь данные сам.',
    'Ты только ПРЕДЛАГАЕШЬ. Пользователь подтверждает, и приложение применяет предложение.',
    'Поэтому, если нужно что-то записать или удалить:',
    '  а) обычным текстом распиши план по дням и приёмам пищи с граммами и калориями;',
    '  б) в конце текста задай вопрос: «Добавить этот план питания в планировщик?»',
    '     (или «…в дневник питания?», или «Удалить эти блюда?», или «Добавить эти продукты в справочник?»);',
    '  в) затем добавь блок ```json со схемой ниже. Без блока приложение ничего не применит.',
    '',
    'СХЕМА БЛОКА (все поля кроме target и нужных данных можно опускать):',
    '```json',
    '{"proposal":{',
    '  "target":"planner",',
    '  "title":"План на неделю · 2000 ккал",',
    '  "question":"Добавить этот план питания в планировщик?",',
    '  "newProducts":[{"name":"Сыр сулугуни","kcal":286,"p":19.5,"f":22,"c":0.4,"unit":"g","piece":0}],',
    '  "days":[{"date":"2026-11-24","meals":{',
    '     "breakfast":[{"name":"Овсянка на молоке 2,5%","amount":300,"unit":"g"}],',
    '     "lunch":[{"name":"Пельмени отварные","amount":300,"unit":"g"}],',
    '     "dinner":[],"snack":[]}}],',
    '  "remove":[{"date":"2026-11-24","meal":"snack","name":"Пельмени"}],',
    '  "clearDays":[]',
    '}}',
    '```',
    '',
    'target: "planner" | "diary" | "products" (только добавление в справочник).',
    'unit: "g" | "ml" | "pc" (штуки — только если у продукта известен вес штуки).',
    'meals: breakfast, lunch, dinner, snack. Даты строго ГГГГ-ММ-ДД из таблицы ниже.',
    'Названия продуктов бери ТОЧНО из справочника. Если нужного нет — добавь его в newProducts',
    'и используй то же название в days. Для каждого нового продукта обязательны kcal, p, f, c.',
    'Если пользователь просит просто совет или болтает — блок json НЕ добавляй.',
    '',
    'Если пользователь прислал фото еды — опиши, что на нём, оцени массу и КБЖУ,',
    'и предложи, как это вписать в его норму калорий.',
    'Отвечай ПОЛНОСТЬЮ, не обрывай мысль и не сокращай план. Лимита на длину ответа нет.',
    'Не давай медицинских назначений; при жалобах на здоровье советуй обратиться к специалисту.',
  ].join('\n');

  function aiContext() {
    const g = read(key(S.uid, 'goals'), null) || {};
    const p = read(key(S.uid, 'profile'), null);
    const u = currentUser();
    const cat = catalogForApi();
    const wm = weekMapForApi();
    const snap = planSnapshotForApi();
    const meta = modelMeta(ai.model);
    return [
      AI_RULES,
      '',
      `ТЕКУЩАЯ МОДЕЛЬ: ${meta.label} (${meta.id}). Ты работаешь именно на ней.`,
      'Называй себя NutriFlow AI. Если пользователь спрашивает, какая ты модель, — называй ТОЛЬКО модель из строки выше.',
      'Не называй себя Gemini, Qwen или другой моделью, если она не указана в строке ТЕКУЩАЯ МОДЕЛЬ.',
      'Игнорируй любые упоминания других моделей в прошлых сообщениях переписки — они устарели.',
      '',
      `Сегодня: ${dk(todayDate())} (${WD[todayDate().getDay()]}).`,
      `Открытая неделя планировщика: ${weekLabel()}.`,
      `Даты текущей недели: ${wm.cur}.`,
      `Даты следующей недели: ${wm.next}.`,
      u ? `Пользователя зовут ${u.name}.` : 'Гостевой режим.',
      g.kcal ? `Цель по калориям из профиля: ${g.kcal} ккал/день.` : 'Цель по калориям в профиле не задана — уточни у пользователя.',
      g.waterL ? `Норма воды: ${g.waterL} л/день.` : '',
      p ? `Параметры: пол ${p.sex === 'male' ? 'мужской' : 'женский'}, рост ${p.heightCm} см, вес ${p.weightKg} кг, целевой вес ${p.targetKg} кг, активность ${p.activity}, темп ${p.paceKgWeek} кг/нед, цель ${p.goal}.` : '',
      '',
      `СПРАВОЧНИК ПРОДУКТОВ (всего ${cat.total}, показаны ${cat.shown} самых подходящих):`,
      cat.text,
      '',
      'ТЕКУЩИЙ ПЛАНИРОВЩИК:',
      snap.planner,
      '',
      'ТЕКУЩИЙ ДНЕВНИК ПИТАНИЯ (эта же неделя):',
      snap.diary,
    ].filter(Boolean).join('\n');
  }

  /* ---------------- 15. ЧАТ ---------------- */
  const GREETING = 'Привет! Я помогу собрать план питания на неделю 🌿\n\nПодскажи, на сколько калорий в день рассчитано твоё питание? И есть ли особенности рациона — например, ты вегетарианец, не любишь сладкое или что-то ещё важно учесть?\n\nКогда план будет готов, я спрошу разрешение и только после твоего «да» заполню планировщик или дневник.';

  const ai = { msgs: [], busy: false, preparing: false, photo: null, model: DEFAULT_MODEL };
  const chatKey = () => key(S.uid, 'aichat');

  function aiLoad() {
    const saved = read(chatKey(), null);
    ai.msgs = Array.isArray(saved) && saved.length
      ? saved.filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      : [{ id: 'm0', role: 'assistant', text: GREETING, ts: Date.now(), via: '' }];
    ai.photo = null;
    aiSave();
  }
  function aiSave() {
    if (write(chatKey(), ai.msgs)) return;
    for (const keep of [60, 40, 24, 12]) {
      if (write(chatKey(), ai.msgs.slice(-keep))) return;
    }
  }
  function aiMarkdown(text) {
    let html = esc(text);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^\s*[-•]\s+(.*)$/gm, '<span class="ai__li">$1</span>');
    html = html.replace(/^\s*(\d+)\.\s+(.*)$/gm, '<span class="ai__li ai__li--num"><b>$1.</b> $2</span>');
    html = html.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
    return html;
  }

  function parseProposal(raw) {
    const blocks = [];
    const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
    let m;
    while ((m = fence.exec(raw)) !== null) blocks.push(m[1]);
    if (!blocks.length) {
      const i = raw.indexOf('{"proposal"');
      const j = raw.lastIndexOf('}');
      if (i >= 0 && j > i) blocks.push(raw.slice(i, j + 1));
    }
    for (const b of blocks) {
      try {
        const obj = JSON.parse(b.trim());
        const pr = obj && (obj.proposal || (obj.target ? obj : null));
        if (pr && typeof pr === 'object') return normalizeProposal(pr);
      } catch { /* блок не JSON */ }
    }
    return null;
  }
  function stripCode(raw) {
    return String(raw || '').replace(/```(?:json)?\s*[\s\S]*?```/gi, '').replace(/\{"proposal"[\s\S]*$/, '').trim();
  }
  function normalizeProposal(pr) {
    const target = ['planner', 'diary', 'products'].includes(pr.target) ? pr.target : 'planner';
    const newProducts = (Array.isArray(pr.newProducts) ? pr.newProducts : [])
      .map((x) => ({
        name: String(x?.name || '').trim().slice(0, 90),
        brand: String(x?.brand || '').trim().slice(0, 40),
        kcal: clamp(num(x?.kcal), 0, 900),
        p: clamp(num(x?.p), 0, 100),
        f: clamp(num(x?.f), 0, 100),
        c: clamp(num(x?.c), 0, 100),
        unit: x?.unit === 'ml' ? 'ml' : 'g',
        piece: clamp(num(x?.piece), 0, 2000),
        pack: clamp(num(x?.pack), 0, 20000),
      }))
      .filter((x) => x.name && (x.kcal > 0 || x.p > 0 || x.f > 0 || x.c > 0));
    const days = (Array.isArray(pr.days) ? pr.days : [])
      .filter((d) => isDateKey(d?.date))
      .map((d) => {
        const meals = {};
        MEALS.forEach(([mk]) => {
          const arr = Array.isArray(d.meals?.[mk]) ? d.meals[mk] : [];
          meals[mk] = arr.map((it) => ({
            name: String(it?.name || '').trim().slice(0, 90),
            amount: clamp(num(it?.amount) || 100, 0.5, 5000),
            unit: ['g', 'ml', 'pc'].includes(it?.unit) ? it.unit : 'g',
            kcal: num(it?.kcal), p: num(it?.p), f: num(it?.f), c: num(it?.c),
          })).filter((it) => it.name);
        });
        return { date: d.date, meals };
      });
    const remove = (Array.isArray(pr.remove) ? pr.remove : [])
      .filter((r) => isDateKey(r?.date))
      .map((r) => ({ date: r.date, meal: MEAL_NAME[r?.meal] ? r.meal : '', name: String(r?.name || '').trim().slice(0, 90) }))
      .filter((r) => r.name || r.meal);
    const clearDays = (Array.isArray(pr.clearDays) ? pr.clearDays : []).filter(isDateKey);
    if (!newProducts.length && !days.length && !remove.length && !clearDays.length) return null;
    return {
      id: 'pr' + uidRand(), ts: Date.now(), target,
      title: String(pr.title || (target === 'products' ? 'Новые продукты' : 'План питания')).slice(0, 90),
      question: String(pr.question || '').slice(0, 200),
      newProducts, days, remove, clearDays,
      status: 'pending', undo: null,
    };
  }

  const exactByName = (name) => {
    const qn = normName(name);
    if (!qn) return null;
    return allProds().find((p) => normName(prodName(p)) === qn) || null;
  };
  function findByName(name) {
    const qn = normName(name);
    if (!qn) return null;
    let best = null;
    for (const p of allProds()) {
      const pn = normName(prodName(p));
      if (pn === qn) return p;
      let score = 0;
      if (pn.includes(qn) || qn.includes(pn)) score += 0.6;
      const qt = qn.split(' ').filter((w) => w.length > 2);
      let hit = 0;
      qt.forEach((w) => { if (pn.includes(w)) hit++; });
      score += hit / Math.max(qt.length, 1) * 0.5;
      if (score > 0.55 && (!best || score > best.score)) best = { p, score };
    }
    return best ? best.p : null;
  }
  function createProducts(list) {
    const created = new Map();
    const add = [];
    list.forEach((x) => {
      const exists = exactByName(x.name);
      if (exists) { created.set(normName(x.name), exists); return; }
      const id = 'ai-' + uidRand();
      const prod = {
        id, name: x.name, fullName: x.name, brand: x.brand || '', cat: x.unit === 'ml' ? 'drinks' : 'custom',
        kcal: x.kcal, p: x.p, f: x.f, c: x.c, unit: x.unit, piece: x.piece, pack: x.pack,
        own: true, ts: Date.now(), source: 'ai',
      };
      add.push(prod);
      created.set(normName(x.name), prod);
    });
    if (add.length) { S.custom = [...add, ...S.custom].slice(0, 400); saveCustom(); }
    return created;
  }
  function resolveEntry(entry, created) {
  const p = created.get(normName(entry.name)) || findByName(entry.name);
  const unit = entry.unit === 'pc' && !canPc(p) ? 'g' : entry.unit;
  if (p) {
    const item = { id: p.id, weight: entry.amount, unit };
    if (canPc(p)) item.piece = num(p.piece);
    return item;
  }
  if (entry.kcal > 0 || entry.p > 0 || entry.f > 0 || entry.c > 0) {
    const prod = {
      id: 'dish-' + uidRand(), name: entry.name, fullName: entry.name, brand: '', cat: 'custom',
      kcal: entry.kcal, p: entry.p, f: entry.f, c: entry.c,
      unit: 'g', piece: 0, pack: 0, own: true, ts: Date.now(), source: 'ai',
    };
    S.custom = [prod, ...S.custom].slice(0, 400);
    saveCustom();
    created.set(normName(entry.name), prod);
    return { id: prod.id, weight: entry.amount, unit: unit === 'pc' ? 'g' : unit };
  }
  return null;
}
  function commitProposal(pr, target) {
    const dates = [...new Set([...pr.days.map((d) => d.date), ...pr.remove.map((r) => r.date), ...pr.clearDays])];
    const undo = { target, custom: S.custom.map((x) => ({ ...x })), planner: {}, diary: {} };
    const diaryKey = key(S.uid, 'diary');
    const diary = read(diaryKey, {});
    dates.forEach((d) => {
      undo.planner[d] = S.days[d] ? JSON.parse(JSON.stringify(S.days[d])) : null;
      undo.diary[d] = diary[d] ? JSON.parse(JSON.stringify(diary[d])) : null;
    });
    const created = pr.newProducts.length ? createProducts(pr.newProducts) : new Map();
    let added = 0, removed = 0, skipped = 0, kcal = 0;

    if (target === 'products') {
      added = created.size;
    } else if (target === 'planner') {
      pr.clearDays.forEach((d) => { S.days[d] = { breakfast: [], lunch: [], dinner: [], snack: [] }; removed++; });
      pr.remove.forEach((r) => {
        const day = dayOf(r.date);
        MEALS.forEach(([mk]) => {
          if (r.meal && r.meal !== mk) return;
          const before = day[mk].length;
          day[mk] = day[mk].filter((it) => {
            const p = itemProd(it);
            if (!p) return true;
            if (r.name && !normName(prodName(p)).includes(normName(r.name))) return true;
            return false;
          });
          removed += before - day[mk].length;
        });
      });
      pr.days.forEach((d) => {
        const day = dayOf(d.date);
        MEALS.forEach(([mk]) => {
          (d.meals[mk] || []).forEach((entry) => {
            const item = resolveEntry(entry, created);
            if (!item) { skipped++; return; }
            day[mk].push(item);
            added++;
            const p = itemProd(item);
            if (p) kcal += portion(p, num(item.weight), item.unit).kcal;
            if (item.id) pushRecent(item.id, item.weight, item.unit, item.piece);
          });
        });
      });
      saveStore();
      if (pr.days.length) {
        const first = fromKey(pr.days[0].date);
        const base = todayDate();
        const diff = (base.getDay() - S.weekStart + 7) % 7;
        base.setDate(base.getDate() - diff);
        S.weekOffset = Math.round((first - base) / (7 * 86400000));
      }
      renderAll();
    } else {
      pr.clearDays.forEach((d) => { diary[d] = { breakfast: [], lunch: [], dinner: [], snack: [] }; removed++; });
      pr.remove.forEach((r) => {
        const day = diary[r.date] || (diary[r.date] = { breakfast: [], lunch: [], dinner: [], snack: [] });
        MEALS.forEach(([mk]) => {
          if (r.meal && r.meal !== mk) return;
          const list = Array.isArray(day[mk]) ? day[mk] : (day[mk] = []);
          const before = list.length;
          day[mk] = list.filter((it) => {
            const p = itemProd(it);
            if (!p) return true;
            if (r.name && !normName(prodName(p)).includes(normName(r.name))) return true;
            return false;
          });
          removed += before - list.length;
        });
      });
      pr.days.forEach((d) => {
        const day = diary[d.date] || (diary[d.date] = { breakfast: [], lunch: [], dinner: [], snack: [] });
        MEALS.forEach(([mk]) => {
          if (!Array.isArray(day[mk])) day[mk] = [];
          (d.meals[mk] || []).forEach((entry) => {
            const item = resolveEntry(entry, created);
            if (!item) { skipped++; return; }
            day[mk].push(item);
            added++;
            const p = itemProd(item);
            if (p) kcal += portion(p, num(item.weight), item.unit).kcal;
          });
        });
      });
      if (!write(diaryKey, diary)) { toast('Дневник не сохранён: нет места в хранилище'); return null; }
    }

    pr.status = 'applied';
    pr.target = target;
    pr.undo = undo;
    pr.result = { added, removed, skipped, kcal: Math.round(kcal), products: created.size };
    return pr.result;
  }
  const targetWhere = (t) => (t === 'products' ? 'справочник' : t === 'planner' ? 'планировщик' : 'дневник питания');
  function resultSummary(pr, target) {
    const r = pr.result || { added: 0, removed: 0, skipped: 0, kcal: 0, products: 0 };
    const parts = [];
    if (target === 'products') parts.push(`добавлено продуктов: ${r.products}`);
    else {
      if (r.added) parts.push(`добавлено блюд: ${r.added}`);
      if (r.removed) parts.push(`удалено: ${r.removed}`);
      if (r.kcal) parts.push(`≈ ${int(r.kcal)} ккал`);
      if (r.skipped) parts.push(`пропущено без КБЖУ: ${r.skipped}`);
    }
    return parts.length ? parts.join(' · ') : 'изменений нет';
  }
  function applyProposal(id, targetOverride) {
    const msg = ai.msgs.find((m) => m.proposal && m.proposal.id === id);
    if (!msg || msg.proposal.status !== 'pending') return;
    ensureScope();
    const pr = msg.proposal;
    const target = targetOverride || pr.target;
    if ((pr.copiedTo || []).includes(target)) { toast(`Этот план уже добавлен в ${targetWhere(target)}`); return; }
    if (!commitProposal(pr, target)) return;
    aiSave(); aiRender();
    aiPush('assistant', `Готово ✅ В ${targetWhere(target)}: ${resultSummary(pr, target)}.${target === 'diary' ? '\n\nОткройте «Дневник питания» — записи уже там.' : ''}\n\nЕсли что-то не так, нажмите «Отменить» на карточке выше.`);
    toast(`ИИ обновил ${targetWhere(target)}`);
  }
  function copyProposalTo(id, target) {
    const msg = ai.msgs.find((m) => m.proposal && m.proposal.id === id);
    if (!msg) return;
    const src = msg.proposal;
    if (src.status !== 'applied' || target === src.target) return;
    if ((src.copiedTo || []).includes(target)) { toast(`Уже добавлено в ${targetWhere(target)}`); return; }
    if (!src.days.length && !src.remove.length && !src.clearDays.length) return;
    ensureScope();
    const clone = {
      id: 'pr' + uidRand(), ts: Date.now(), target,
      title: src.title, question: '',
      newProducts: src.newProducts.filter((x) => !exactByName(x.name)).map((x) => ({ ...x })),
      days: src.days.map((d) => {
        const m = {};
        MEALS.forEach(([mk]) => { m[mk] = (d.meals[mk] || []).map((it) => ({ ...it })); });
        return { date: d.date, meals: m };
      }),
      remove: src.remove.map((r) => ({ ...r })),
      clearDays: [...src.clearDays],
      status: 'applied', undo: null,
      copiedFrom: src.id,
      copiedTo: [...new Set([src.target, ...(src.copiedTo || [])])],
    };
    if (!commitProposal(clone, target)) return;
    src.copiedTo = [...new Set([...(src.copiedTo || []), target])];
    aiSave();
    aiPush('assistant', `Тот же план перенесён в ${targetWhere(target)}: ${resultSummary(clone, target)}. Просить повторно не нужно — просто нажмите «Отменить», если передумаете.`, { proposal: clone });
    toast(`План добавлен в ${targetWhere(target)}`);
  }
  function undoProposal(id) {
    const msg = ai.msgs.find((m) => m.proposal && m.proposal.id === id);
    if (!msg || msg.proposal.status !== 'applied' || !msg.proposal.undo) return;
    ensureScope();
    const pr = msg.proposal, u = pr.undo;
    S.custom = u.custom.map((x) => ({ ...x }));
    saveCustom();
    if (u.target === 'planner') {
      Object.keys(u.planner).forEach((d) => {
        if (u.planner[d] === null) delete S.days[d];
        else S.days[d] = u.planner[d];
      });
      saveStore(); renderAll();
    } else if (u.target === 'diary') {
      const diaryKey = key(S.uid, 'diary');
      const diary = read(diaryKey, {});
      Object.keys(u.diary).forEach((d) => {
        if (u.diary[d] === null) delete diary[d];
        else diary[d] = u.diary[d];
      });
      write(diaryKey, diary);
    }
    if (pr.copiedFrom) {
      const parent = ai.msgs.find((m) => m.proposal && m.proposal.id === pr.copiedFrom);
      if (parent) parent.proposal.copiedTo = (parent.proposal.copiedTo || []).filter((t) => t !== pr.target);
    }
    pr.status = 'pending';
    pr.undo = null;
    aiSave(); aiRender();
    aiPush('assistant', 'Изменения отменены — всё вернулось как было.');
    toast('Действие ИИ отменено');
  }
  function declineProposal(id) {
    const msg = ai.msgs.find((m) => m.proposal && m.proposal.id === id);
    if (!msg || msg.proposal.status !== 'pending') return;
    msg.proposal.status = 'declined';
    aiSave(); aiRender();
    aiPush('assistant', 'Хорошо, ничего не меняю. Скажите, что поправить в плане — предложу другой вариант.');
  }
  const pendingProposal = () => {
    for (let i = ai.msgs.length - 1; i >= 0; i--) {
      const p = ai.msgs[i].proposal;
      if (p && p.status === 'pending') return p;
    }
    return null;
  };
  const YES = /^(да|давай|давайте|ага|угу|ок|окей|okay|ok|yes|конечно|добавь|добавляй|вноси|внеси|сохраняй|сохрани|применяй|примени|подтверждаю|делай|можно|нужно|хочу)\b/i;
  const NO = /^(нет|не надо|не нужно|отмена|отклони|отклоняй|не добавляй|передумал|стоп|no)\b/i;

  function proposalCard(pr) {
    const badge = pr.status === 'applied' ? 'Добавлено' : pr.status === 'declined' ? 'Отклонено' : 'Ждёт ответа';
    const targetName = pr.target === 'products' ? 'Справочник' : pr.target === 'planner' ? 'Планировщик' : 'Дневник';
    const dishCount = pr.days.reduce((s, d) => s + MEALS.reduce((a, [mk]) => a + (d.meals[mk] || []).length, 0), 0);
    const meta = [targetName];
    if (pr.days.length) meta.push(`${pr.days.length} дн.`);
    if (dishCount) meta.push(`${dishCount} блюд`);
    if (pr.newProducts.length) meta.push(`${pr.newProducts.length} новых продуктов`);
    if (pr.remove.length || pr.clearDays.length) meta.push(`удалений: ${pr.remove.length + pr.clearDays.length}`);

    const daysHtml = pr.days.map((d) => {
      const date = fromKey(d.date);
      let kcal = 0;
      const mealsHtml = MEALS.map(([mk, mn]) => {
        const arr = d.meals[mk] || [];
        if (!arr.length) return '';
        const chips = arr.map((it) => {
          const p = findByName(it.name);
          const unit = it.unit === 'pc' && !canPc(p) ? 'g' : it.unit;
          const m = p ? portion(p, it.amount, unit) : { kcal: Math.round(num(it.kcal) * it.amount / 100) };
          kcal += m.kcal;
          return `<span class="ai-prop__chip">${esc(it.name)} · ${amtText(it.amount, unit)}${unitLabel(unit)} · ${m.kcal}</span>`;
        }).join('');
        return `<div class="ai-prop__meal"><b>${mn}</b>${chips}</div>`;
      }).filter(Boolean).join('');
      return `<div class="ai-prop__day">
        <div class="ai-prop__dayhead"><span>${WD[date.getDay()]}, ${dayLabel(date)}</span><b>${int(kcal)} ккал</b></div>
        ${mealsHtml || '<span class="ai-prop__empty">без блюд</span>'}
      </div>`;
    }).join('');

    const newHtml = pr.newProducts.length ? `<div class="ai-prop__block">
      <b>Новые продукты в справочник</b>
      ${pr.newProducts.map((x) => `<span class="ai-prop__chip ai-prop__chip--new">${esc(x.name)} · ${x.kcal} ккал/100${x.unit === 'ml' ? 'мл' : 'г'} (Б${dec(x.p)} Ж${dec(x.f)} У${dec(x.c)})</span>`).join('')}
    </div>` : '';
    const rmHtml = (pr.remove.length || pr.clearDays.length) ? `<div class="ai-prop__block ai-prop__block--rm">
      <b>Будет удалено</b>
      ${pr.clearDays.map((d) => `<span class="ai-prop__chip ai-prop__chip--rm">Очистить ${WD[fromKey(d).getDay()]}, ${dayLabel(fromKey(d))}</span>`).join('')}
      ${pr.remove.map((r) => `<span class="ai-prop__chip ai-prop__chip--rm">${esc(r.name || MEAL_NAME[r.meal] || 'всё')} · ${WD[fromKey(r.date).getDay()]}${r.meal ? ', ' + MEAL_NAME[r.meal] : ''}</span>`).join('')}
    </div>` : '';

    const otherTarget = pr.target === 'diary' ? 'planner' : 'diary';
    const canCopy = pr.status === 'applied'
      && (pr.days.length > 0 || pr.remove.length > 0 || pr.clearDays.length > 0)
      && !(pr.copiedTo || []).includes(otherTarget);
    const copyLabel = pr.days.length
      ? (otherTarget === 'diary' ? 'Добавить в дневник' : 'Добавить в планировщик')
      : (otherTarget === 'diary' ? 'Повторить в дневнике' : 'Повторить в планировщике');
    const copyIcon = otherTarget === 'diary'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M15 3v5h5"/><path d="M9 14l2 2 4-4"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M12 13v5M9.5 15.5h5"/></svg>';

    const actions = pr.status === 'pending'
      ? `<div class="ai-prop__actions">
          ${pr.target === 'products'
            ? '<button class="btn btn--primary ai-prop__btn" type="button" data-prop-apply>Добавить в справочник</button>'
            : `<button class="btn btn--primary ai-prop__btn" type="button" data-prop-apply>Добавить в ${pr.target === 'diary' ? 'дневник' : 'планировщик'}</button>
               <button class="btn-soft ai-prop__btn" type="button" data-prop-diary>${pr.target === 'diary' ? 'В планировщик' : 'В дневник'}</button>`}
          <button class="btn-soft ai-prop__btn" type="button" data-prop-decline>Отклонить</button>
        </div>`
      : pr.status === 'applied'
        ? `<div class="ai-prop__actions ai-prop__actions--stack">
            ${canCopy ? `<button class="btn btn--primary ai-prop__btn ai-prop__btn--copy" type="button" data-prop-copy="${otherTarget}">${copyIcon}${copyLabel}</button>` : ''}
            <button class="btn-soft ai-prop__btn" type="button" data-prop-undo>Отменить</button>
          </div>`
        : '';

    return `<div class="ai-prop" data-prop="${pr.id}" data-status="${pr.status}">
      <div class="ai-prop__head">
        <span class="ai-prop__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg></span>
        <div class="ai-prop__title"><strong>${esc(pr.title)}</strong><span>${esc(meta.join(' · '))}</span></div>
        <span class="ai-prop__badge">${badge}</span>
      </div>
      ${daysHtml ? `<div class="ai-prop__days">${daysHtml}</div>` : ''}
      ${newHtml}${rmHtml}
      ${actions}
    </div>`;
  }

  /* ---- Панель выбора модели ---- */
  function buildModelOptions() {
    const sel = q('#ai-model');
    if (!sel || sel.dataset.ready === '1') return;
    const groups = [
      { family: 'gemini', label: 'Gemini · быстрые, видят фото' },
      { family: 'qwen', label: 'Qwen · умный текст' },
    ];
    sel.innerHTML = groups.map((g) => `<optgroup label="${esc(g.label)}">${
      AI_MODELS.filter((m) => m.family === g.family)
        .map((m) => `<option value="${esc(m.id)}">${esc(m.label)} — ${esc(m.note)}</option>`).join('')
    }</optgroup>`).join('');
    sel.dataset.ready = '1';
  }
  function renderModelBar() {
    buildModelOptions();
    const sel = q('#ai-model');
    if (sel) sel.value = ai.model;
    const meta = modelMeta(ai.model);
    const eff = ai.photo ? modelMeta(VISION_CHAIN[0]) : meta;
    setText('#ai-active', `${eff.label} · ${eff.note}`);
    const chip = q('#ai-vision');
    if (chip) {
      chip.textContent = eff.vision ? 'видит фото' : 'только текст';
      chip.dataset.kind = eff.vision ? 'vision' : 'text';
    }
    aiRouteNote();
  }
  function aiRouteNote() {
    const el = q('#ai-route');
    if (!el) return;
    const meta = modelMeta(ai.model);
    if (!ai.photo) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.dataset.kind = meta.vision ? 'info' : 'switch';
    el.textContent = meta.vision
      ? `Фото и сообщение уйдут в ${modelMeta(VISION_CHAIN[0]).label}.`
      : `${meta.label} не распознаёт изображения — фото и сообщение уйдут в ${modelMeta(VISION_CHAIN[0]).label}.`;
    setText('#ai-attach-note', meta.vision ? 'Готово к отправке' : 'Распознает Gemini');
  }

  function aiRender() {
    const log = q('#ai-log');
    if (!log) return;
    log.innerHTML = ai.msgs.map((m) => {
      const mine = m.role === 'user';
      const via = !mine && m.via ? `<span class="ai__via">${esc(modelMeta(m.via).label)}</span>` : '';
      return `<div class="ai__msg${mine ? ' ai__msg--me' : ''}${m.error ? ' ai__msg--err' : ''}">
        ${m.img ? `<img class="ai__msg-img" src="${m.img}" alt="Фото пользователя">` : ''}
        ${m.text ? `<div class="ai__bubble">${aiMarkdown(m.text)}</div>` : ''}
        ${m.proposal ? proposalCard(m.proposal) : ''}
        <span class="ai__time">${new Date(m.ts || Date.now()).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}${via}</span>
      </div>`;
    }).join('') + (ai.busy ? '<div class="ai__msg"><div class="ai__bubble ai__typing"><i></i><i></i><i></i></div></div>' : '');
    log.scrollTop = log.scrollHeight;
  }
  function aiStatus(text) {
    const el = q('#ai-status');
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = text;
  }
  function aiPush(role, text, extra = {}) {
    ai.msgs.push({ id: 'm' + uidRand(), role, text, ts: Date.now(), ...extra });
    aiSave(); aiRender();
  }

  function aiHistoryForApi(photoFull) {
    const slice = ai.msgs.slice(-HISTORY_CAP);
    const out = slice.map((m, i) => {
      let t = m.text || '';
      if (m.proposal) {
        const pr = m.proposal;
        const st = pr.status === 'applied' ? 'применено' : pr.status === 'declined' ? 'отклонено' : 'ждёт подтверждения';
        t += `\n\n[Моё предложение «${pr.title}» (${pr.target}) сейчас в статусе: ${st}]`;
      }
      if (m.img && !(photoFull && i === slice.length - 1)) t += '\n\n[К этому сообщению было прикреплено фото блюда]';
      return { role: m.role, content: t };
    }).filter((m) => String(m.content).trim());
    if (photoFull && out.length) {
      const last = out[out.length - 1];
      if (last.role === 'user') {
        last.content = [
          { type: 'text', text: String(last.content) || 'Опиши блюдо и оцени КБЖУ.' },
          { type: 'image_url', image_url: { url: photoFull } },
        ];
      }
    }
    return [{ role: 'system', content: aiContext() }, ...out];
  }

  async function aiComplete(baseMessages, models) {
    let raw = '';
    let model = models[0];
    let messages = baseMessages.slice();
    for (let part = 0; part < 12; part++) {
      const res = await apiCascade(models, messages);
      model = res.model;
      raw += res.text;
      const cut = res.finish === 'length' || res.finish === 'max_tokens';
      if (!cut) break;
      aiStatus(`ИИ дописывает ответ… часть ${part + 2}`);
      messages = messages.concat([
        { role: 'assistant', content: res.text },
        { role: 'user', content: 'Продолжи РОВНО с того места, где оборвался, без повторов и без вступлений. Если это JSON-блок — допиши его до валидного конца.' },
      ]);
      await sleep(250);
    }
    return { raw, model };
  }

  async function aiAttach(file) {
    if (!file || !file.type.startsWith('image/')) { toast('Нужен файл изображения'); return; }
    ai.preparing = true;
    aiSendState();
    try {
      const raw = await fileToDataUrl(file);
      const thumb = await shrink(raw, 420, 0.7);
      const full = await shrink(raw, 1024, 0.8);
      ai.photo = { img: thumb, full };
      setHidden('#ai-attach', false);
      q('#ai-attach-img').src = thumb;
    } catch (e) {
      toast('Не удалось прочитать фото: ' + (e.message || ''));
    } finally {
      ai.preparing = false;
      renderModelBar();
      aiSendState();
    }
  }
  function aiDropPhoto() {
    ai.photo = null;
    setHidden('#ai-attach', true);
    setVal('#ai-file', '');
    renderModelBar();
    aiSendState();
  }
  function aiSendState() {
    const btn = q('#ai-send');
    if (!btn) return;
    const hasText = getVal('#ai-input').trim().length > 0;
    btn.disabled = ai.busy || ai.preparing || (!hasText && !ai.photo);
  }

  async function aiSend(event) {
    if (event) event.preventDefault();
    if (ai.busy || ai.preparing) return;
    ensureScope();
    const input = q('#ai-input');
    const text = input.value.trim();
    const photo = ai.photo;
    if (!text && !photo) return;

    const pend = pendingProposal();
    if (pend && text && !photo) {
      const clean = text.replace(/[!.]+$/g, '').trim();
      if (YES.test(clean)) {
        let target = pend.target;
        if (/дневник/i.test(clean)) target = 'diary';
        else if (/планировщик/i.test(clean)) target = 'planner';
        aiPush('user', text);
        input.value = ''; input.style.height = 'auto'; aiSendState();
        applyProposal(pend.id, target);
        return;
      }
      if (NO.test(clean)) {
        aiPush('user', text);
        input.value = ''; input.style.height = 'auto'; aiSendState();
        declineProposal(pend.id);
        return;
      }
    }

    const photoFull = photo ? photo.full : '';
    aiPush('user', text || 'Что на этом фото?', photo ? { img: photo.img } : {});
    input.value = '';
    input.style.height = 'auto';
    aiDropPhoto();

    ai.busy = true;
    aiSendState();
    /* Фото всегда уходит в Gemini; текст — строго в выбранную модель */
    const chain = photoFull ? VISION_CHAIN : textChain(ai.model);
    aiStatus(photoFull && !modelMeta(ai.model).vision
      ? `Фото распознаёт ${modelMeta(VISION_CHAIN[0]).label}…`
      : `Думает · ${modelMeta(chain[0]).label}…`);
    aiRender();
    try {
      const { raw, model } = await aiComplete(aiHistoryForApi(photoFull), chain);
      const proposal = parseProposal(raw);
      const cleanText = stripCode(raw);
      aiPush('assistant', cleanText || (proposal ? proposal.question || 'Вот что я предлагаю:' : 'Не удалось получить ответ.'), {
        via: model,
        ...(proposal ? { proposal } : {}),
      });
    } catch (e) {
      const tried = chain.map((m) => modelMeta(m).label).join(', ');
      aiPush('assistant', `Модель ${tried} не ответила: ${e.message || 'недоступна'}.\n\nПопробуйте ещё раз или выберите другую модель в списке сверху — сообщения отправляются именно той модели, которая там выбрана.`, { error: true });
    } finally {
      ai.busy = false;
      aiStatus('');
      aiRender();
      aiSendState();
    }
  }
  function aiClear() {
    askConfirm('Очистить чат?', 'Переписка этого аккаунта и неподтверждённые предложения будут удалены. Планировщик, дневник и справочник не изменятся.', 'Очистить', () => {
      ai.msgs = [{ id: 'm0', role: 'assistant', text: GREETING, ts: Date.now(), via: '' }];
      aiSave(); aiRender();
      toast('Чат очищен');
    });
  }

  /* ---------------- 16. СОБЫТИЯ ---------------- */
  function bind() {
    q('#pl-prev')?.addEventListener('click', () => { S.weekOffset--; renderAll(); });
    q('#pl-next')?.addEventListener('click', () => { S.weekOffset++; renderAll(); });
    q('#pl-today')?.addEventListener('click', () => { S.weekOffset = 0; renderAll(); });

    q('#pl-settings-open')?.addEventListener('click', () => {
      setVal('#pl-week-start', String(S.weekStart));
      q('#pl-settings-modal').hidden = false;
      document.body.classList.add('no-scroll');
    });
    qa('[data-pl-set-close]').forEach((el) => el.addEventListener('click', () => {
      setHidden('#pl-settings-modal', true);
      document.body.classList.remove('no-scroll');
    }));
    q('#pl-set-save')?.addEventListener('click', () => {
      const v = Number(getVal('#pl-week-start'));
      S.weekStart = [0, 1, 6].includes(v) ? v : 1;
      S.weekOffset = 0;
      saveStore(); renderAll();
      setHidden('#pl-settings-modal', true);
      document.body.classList.remove('no-scroll');
      toast('Первый день недели: ' + WD[S.weekStart]);
    });

    q('#pl-strip')?.addEventListener('click', (e) => {
      const cell = e.target.closest('[data-pl-jump]');
      if (!cell) return;
      const card = q('#pl-day-' + cell.dataset.plJump);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.remove('is-flash');
      void card.offsetWidth;
      card.classList.add('is-flash');
      setTimeout(() => card.classList.remove('is-flash'), 1400);
    });

    q('#pl-days')?.addEventListener('click', (e) => {
      const day = e.target.closest('[data-date]');
      if (!day) return;
      const date = day.dataset.date;
      const add = e.target.closest('[data-pl-add]');
      if (add) { openPicker(date, add.dataset.plAdd); return; }
      const ph = e.target.closest('[data-pl-photo]');
      if (ph) { openScan(date, ph.dataset.plPhoto); return; }
      const b = e.target.closest('[data-pl-barcode]');
      if (b) { openBc(date, b.dataset.plBarcode); return; }
      const clear = e.target.closest('[data-pl-clear]');
      if (clear) {
        askConfirm('Очистить день?', `Все блюда за ${dayLabel(fromKey(date))} будут удалены из плана. Дневник питания не изменится.`, 'Очистить', () => clearDay(date));
        return;
      }
      const mealEl = e.target.closest('[data-meal]');
      if (!mealEl) return;
      const meal = mealEl.dataset.meal;
      const del = e.target.closest('[data-pl-del]');
      if (del) { removeItem(date, meal, Number(del.dataset.plDel)); return; }
      const edit = e.target.closest('[data-pl-edit]');
      if (edit) openPortion(date, meal, Number(edit.dataset.plEdit));
    });

    const pickModal = q('#pl-product-modal');
    if (pickModal) {
      pickModal.addEventListener('click', (e) => {
        if (e.target.closest('[data-pl-pick-close]')) { closePicker(); return; }
        const tab = e.target.closest('[data-pl-tab]');
        if (tab) { pickTab(tab.dataset.plTab); return; }
        const photo = e.target.closest('[data-pl-photo-pick]');
        if (photo) { pickTogglePhoto(photo); return; }
        const prod = e.target.closest('[data-pl-prod]');
        if (prod) pickToggle(prod);
      });
      q('#pl-pick-save').addEventListener('click', pickSave);
      q('#pl-search-input').addEventListener('input', (e) => { pick.query = e.target.value; pickRender(); });
      q('#pl-search-clear').addEventListener('click', () => { setVal('#pl-search-input', ''); pick.query = ''; pickRender(); q('#pl-search-input').focus(); });
    }

    const wModal = q('#pl-weight-modal');
    if (wModal) {
      wModal.addEventListener('click', (e) => {
        if (e.target.closest('[data-pl-weight-close]')) { closePortion(); return; }
        const u = e.target.closest('.unit-switch__btn');
        if (u) pwSetUnit(u.dataset.unit);
      });
      q('#pl-weight-input').addEventListener('input', pwHint);
      q('#pl-weight-save').addEventListener('click', pwSave);
    }

    const sModal = q('#pl-scan-modal');
    if (sModal) {
      sModal.addEventListener('click', (e) => { if (e.target.closest('[data-pl-scan-close]')) closeScan(); });
      sModal.addEventListener('dragover', (e) => e.preventDefault());
      sModal.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) scanFile(f); });
      q('#pl-scan-file').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) scanFile(f); });
      q('#pl-scan-drop').addEventListener('click', () => q('#pl-scan-file').click());
      q('#pl-scan-again').addEventListener('click', () => { renderScanGallery(); scanStage('pick'); });
      q('#pl-scan-other').addEventListener('click', () => { renderScanGallery(); scanStage('pick'); });
      q('#pl-scan-retry').addEventListener('click', runScan);
      q('#pl-scan-add').addEventListener('click', scanAdd);
      q('#pl-scan-gallery')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-pl-gallery]');
        if (btn) addGalleryPhoto(btn.dataset.plGallery);
      });
    }

    const bModal = q('#pl-bc-modal');
    if (bModal) {
      bModal.addEventListener('click', (e) => { if (e.target.closest('[data-pl-bc-close]')) closeBc(); });
      q('#pl-bc-cam-on').addEventListener('click', bcStartCam);
      q('#pl-bc-stop').addEventListener('click', () => { bcStop(); bcStatus('Камера выключена.', 'info'); });
      q('#pl-bc-photo').addEventListener('click', () => q('#pl-bc-file').click());
      q('#pl-bc-file').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) bcFromImage(f); });
      q('#pl-bc-form').addEventListener('submit', (e) => { e.preventDefault(); handleCode(getVal('#pl-bc-input')); });
      q('#pl-bc-again').addEventListener('click', () => { bcStage('start'); bcStatus('Введите или отсканируйте другой код.', 'info'); setVal('#pl-bc-input', ''); q('#pl-bc-input').focus(); });
      q('#pl-bc-units').addEventListener('click', (e) => { const b = e.target.closest('[data-bc-unit]'); if (b) bcSetUnit(b.dataset.bcUnit); });
      q('#pl-bc-minus').addEventListener('click', () => bcStep(-1));
      q('#pl-bc-plus').addEventListener('click', () => bcStep(1));
      q('#pl-bc-amount').addEventListener('input', bcTotal);
      q('#pl-bc-add').addEventListener('click', bcAdd);
      q('#pl-bc-new-cancel').addEventListener('click', () => { bcStage('start'); bcStatus('Введите другой код.', 'info'); });
      q('#pl-bc-new-add').addEventListener('click', bcNewAdd);
      q('#pl-bc-find-form').addEventListener('submit', bcFindSubmit);
      q('#pl-bc-find-list').addEventListener('click', (e) => {
        const b = e.target.closest('[data-pl-bc-pick]');
        if (b) bcApplyCandidate(Number(b.dataset.plBcPick));
      });
      q('#pl-bc-saved').addEventListener('click', (e) => {
        const del = e.target.closest('[data-pl-bc-del]');
        if (del) {
          const code = del.dataset.plBcDel;
          S.barcodes = S.barcodes.filter((b) => String(b.code) !== code);
          write(key(S.uid, 'barcodes'), S.barcodes);
          rebuildProducts(); bcSavedRender();
          toast('Товар удалён из вашей базы');
          return;
        }
        const open = e.target.closest('[data-pl-bc-open]');
        if (open) handleCode(open.dataset.plBcOpen);
      });
    }

    const cModal = q('#pl-confirm-modal');
    if (cModal) {
      cModal.addEventListener('click', (e) => { if (e.target.closest('[data-pl-confirm-close]')) closeConfirm(); });
      q('#pl-confirm-ok').addEventListener('click', () => { const fn = confirmAction; closeConfirm(); if (fn) fn(); });
    }

    /* чат и выбор модели */
    q('#ai-model')?.addEventListener('change', (e) => {
      const id = e.target.value;
      ai.model = AI_MODELS.some((m) => m.id === id) ? id : DEFAULT_MODEL;
      saveModel();
      renderModelBar();
      toast(`Модель: ${modelMeta(ai.model).label}`);
    });
    q('#ai-form')?.addEventListener('submit', aiSend);
    q('#ai-photo')?.addEventListener('click', () => q('#ai-file').click());
    q('#ai-file')?.addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) aiAttach(f); });
    q('#ai-attach-del')?.addEventListener('click', aiDropPhoto);
    q('#ai-clear')?.addEventListener('click', aiClear);
    q('#ai-log')?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-prop]');
      if (!card) return;
      const id = card.dataset.prop;
      if (e.target.closest('[data-prop-apply]')) { applyProposal(id); return; }
      if (e.target.closest('[data-prop-diary]')) {
        const msg = ai.msgs.find((m) => m.proposal && m.proposal.id === id);
        applyProposal(id, msg && msg.proposal.target === 'diary' ? 'planner' : 'diary');
        return;
      }
      const copy = e.target.closest('[data-prop-copy]');
      if (copy) { copyProposalTo(id, copy.dataset.propCopy); return; }
      if (e.target.closest('[data-prop-decline]')) { declineProposal(id); return; }
      if (e.target.closest('[data-prop-undo]')) undoProposal(id);
    });
    const input = q('#ai-input');
    if (input) {
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 140) + 'px';
        aiSendState();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSend(); }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const order = ['#pl-confirm-modal', '#pl-settings-modal', '#pl-bc-modal', '#pl-scan-modal', '#pl-weight-modal', '#pl-product-modal'];
      for (const sel of order) {
        const el = q(sel);
        if (el && !el.hidden) {
          if (sel === '#pl-confirm-modal') closeConfirm();
          else if (sel === '#pl-settings-modal') { el.hidden = true; document.body.classList.remove('no-scroll'); }
          else if (sel === '#pl-bc-modal') closeBc();
          else if (sel === '#pl-scan-modal') closeScan();
          else if (sel === '#pl-weight-modal') closePortion();
          else closePicker();
          return;
        }
      }
    });

    const resync = () => {
      document.documentElement.dataset.theme = themeNow();
      if (S.uid !== uidNow()) { loadStore(); aiLoad(); loadModel(); renderAll(); aiRender(); renderModelBar(); }
      else {
        const dp = read(key(S.uid, 'photos'), []);
        S.diaryPhotos = Array.isArray(dp) ? dp : [];
      }
    };
    window.addEventListener('pageshow', resync);
    window.addEventListener('focus', resync);
    window.addEventListener('storage', resync);
    window.addEventListener('pagehide', bcStop);
  }

  /* ---------------- 17. СТАРТ ---------------- */
  loadStore();
  aiLoad();
  loadModel();
  bind();
  renderAll();
  renderModelBar();
  aiRender();
  aiSendState();
})();