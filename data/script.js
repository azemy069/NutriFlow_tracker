/* ==========================================================================
   NUTRIFLOW — логика приложения (ВЕРСИЯ 14)
   · Штрихкоды: поиск по своей базе, затем по мировой; товар всегда
     сохраняется в базуNutriFlow. Пользователь не видит названий источников.
   · Счётные товары: порция в ШТУКАХ (масса штуки из базы), а также г и мл.
   · Фото-сканер блюда, галерея, водный баланс, мастер цели, тёмная тема.
   ========================================================================== */
'use strict';

const APP_VERSION = '14.0';
const LOG = (...args) => console.log(`%c[NutriFlow v${APP_VERSION}]`, 'color:#0e7d72;font-weight:bold', ...args);

/* ------------------ 1. УТИЛИТЫ И ДАТЫ ------------------ */
const $  = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const loadJSON = (key, fallback) => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
};
const saveJSON = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const num0 = (n) => (Number.isFinite(+n) ? +n : 0);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
const trimNum = (n) => { const s = Number(n).toFixed(1); return s.endsWith('.0') ? s.slice(0, -2) : s.replace('.', ','); };

const GOALS = { kcal: 1800, p: 120, f: 70, c: 200 };
const RING_LENGTH = 327;
const MEALS = [{ key: 'breakfast' }, { key: 'lunch' }, { key: 'dinner' }, { key: 'snack' }];
const MEAL_LABELS = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' };
const HISTORY_LIMIT = 20;
const WATER_DEFAULT_ML = 2000;
const NOT_FOUND_TEXT = 'Данный штрихкод не состоит в базе данных';

const SAFE_PRODUCTS = typeof PRODUCTS_DB !== 'undefined' && Array.isArray(PRODUCTS_DB) ? PRODUCTS_DB : [];
const PRODUCT_MAP = new Map(SAFE_PRODUCTS.map((p) => [p.id, p]));

/* ---- Слой штрихкодов ---- */
const SAFE_BARCODES = typeof BARCODES_DB !== 'undefined' && Array.isArray(BARCODES_DB) ? BARCODES_DB : [];
const BARCODE_INDEX = new Map();
const EXTRA_PRODUCTS = new Map();
const resolveProduct = (id) => PRODUCT_MAP.get(id) || EXTRA_PRODUCTS.get(id) || null;
const allProducts = () => {
  const merged = new Map(PRODUCT_MAP);
  EXTRA_PRODUCTS.forEach((p, id) => merged.set(id, p));
  return [...merged.values()];
};

function registerBarcode(entry) {
  const code = String(entry.code || '').replace(/\D/g, '');
  if (!code) return null;
  const piece = num0(entry.piece);
  const pack = num0(entry.pack);
  if (entry.id && PRODUCT_MAP.has(entry.id)) {
    const base = PRODUCT_MAP.get(entry.id);
    const merged = { ...base, barcode: code, piece: piece || num0(base.piece), pack: pack || num0(base.pack) };
    if (entry.unit === 'ml') merged.cat = 'drinks';
    EXTRA_PRODUCTS.set(base.id, merged);
    BARCODE_INDEX.set(code, base.id);
    return merged;
  }
  const id = 'bc-' + code;
  const unit = entry.unit === 'ml' ? 'ml' : 'g';
  const product = {
    id, barcode: code, cat: unit === 'ml' ? 'drinks' : 'barcode',
    name: entry.name || 'Продукт ' + code, brand: entry.brand || '',
    kcal: num0(entry.kcal), p: num0(entry.p), f: num0(entry.f), c: num0(entry.c),
    piece, pack,
  };
  EXTRA_PRODUCTS.set(id, product);
  BARCODE_INDEX.set(code, id);
  return product;
}
function rebuildBarcodes() {
  BARCODE_INDEX.clear();
  EXTRA_PRODUCTS.clear();
  SAFE_BARCODES.forEach(registerBarcode);
  (state.barcodes || []).forEach(registerBarcode);
}
const eanValid = (code) => {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
};
const findBarcode = (code) => {
  const id = BARCODE_INDEX.get(code);
  return id ? resolveProduct(id) : null;
};
const isShippedCode = (code) => SAFE_BARCODES.some((e) => String(e.code) === code);

const isDrink = (p) => Boolean(p) && p.cat === 'drinks';
const drinkDensity = (p) => {
  const id = p.id;
  if (/^(vodka|cognac|whiskey|rum|gin)/.test(id)) return 0.95;
  if (/^(wine|champagne|beer)/.test(id)) return 0.99;
  if (/^(milkshake|cocoa-milk|latte|cappuccino|coffee-milk|frappe|mocha)/.test(id)) return 1.03;
  if (/^(juice|smoothie|compote|mors|kissel|lemonade|cola|pepsi|fanta|sprite|energy|kvass)/.test(id)) return 1.04;
  return 1;
};
/* Перевод порции в граммы: штуки → масса штуки, мл → плотность */
const toGrams = (p, amount, unit) => {
  if (unit === 'pc') return amount * num0(p.piece);
  if (unit === 'ml') return amount * drinkDensity(p);
  return amount;
};
const unitLabel = (u) => u === 'pc' ? 'шт' : u === 'ml' ? 'мл' : 'г';
const calcPortion = (p, amount, unit = 'g') => {
  const k = toGrams(p, amount, unit) / 100;
  return { kcal: Math.round(p.kcal * k), p: +(p.p * k).toFixed(1), f: +(p.f * k).toFixed(1), c: +(p.c * k).toFixed(1) };
};
const canPieces = (p) => num0(p && p.piece) > 0;
const defaultUnit = (p) => canPieces(p) ? 'pc' : isDrink(p) ? 'ml' : 'g';
const defaultAmount = (unit) => unit === 'pc' ? 1 : unit === 'ml' ? 250 : 100;
const amountText = (amount, unit) => unit === 'pc' ? trimNum(amount) : String(Math.round(amount));

const itemProduct = (item) => {
  const db = resolveProduct(item.id);
  if (db) return num0(item.piece) > 0 ? { ...db, piece: num0(item.piece) } : db;
  if (item && item.custom) {
    return {
      id: 'custom', cat: 'custom', name: item.custom.name || 'Блюдо с фото',
      kcal: num0(item.custom.kcal100), p: num0(item.custom.p100),
      f: num0(item.custom.f100), c: num0(item.custom.c100), piece: num0(item.custom.piece),
    };
  }
  return null;
};

const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateKey = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return fmtDate(d); };
const parseKey = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtFullDate = (d) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s?г\.$/, '');
const fmtDateTime = (ts) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateTitle = (key) => {
  const plain = parseKey(key).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  if (key === dateKey(0)) return `Сегодня, ${plain}`;
  if (key === dateKey(-1)) return `Вчера, ${plain}`;
  if (key === dateKey(1)) return `Завтра, ${plain}`;
  return parseKey(key).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
};

/* ------------------ 1.5. ТЕМА И ТОСТ ------------------ */
const THEME_KEY = 'nutriflow.theme';
const getTheme = () => localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('#theme-toggle');
  if (btn) {
    const label = theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему';
    btn.setAttribute('aria-label', label); btn.title = label;
  }
}
let toastTimer = 0;
function showToast(message) {
  let el = $('#app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast'; el.className = 'app-toast'; el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
}
function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  showToast(next === 'dark' ? 'Темная тема включена' : 'Светлая тема включена');
}
applyTheme(getTheme());

/* ------------------ 2. БАЗЫ ДАННЫХ И СЕССИЯ ------------------ */
const DB_USERS = 'nutriflow.db.users.v2';
const DB_SESSION = 'nutriflow.db.session.v2';
const dbKey = (uid, domain) => `nutriflow.db.${uid}.${domain}.v2`;
const loadUsers = () => loadJSON(DB_USERS, []);
const setSession = (id) => saveJSON(DB_SESSION, id);
const clearSession = () => localStorage.removeItem(DB_SESSION);
const currentUser = () => { const id = loadJSON(DB_SESSION, null); return id ? loadUsers().find((u) => u.id === id) || null : null; };
const scopeUid = () => { const u = currentUser(); return u ? u.id : 'guest'; };
const generateUid = (email) => {
  let hash = 0;
  for (let i = 0; i < email.length; i++) { hash = (hash << 5) - hash + email.charCodeAt(i); hash |= 0; }
  return `u_${Math.abs(hash).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
};
function registerUser(name, email, password) {
  const users = loadUsers();
  const clean = email.toLowerCase().trim();
  if (users.some((u) => u.email === clean)) return { error: 'Пользователь с такой почтой уже зарегистрирован — попробуйте войти.' };
  const user = { id: generateUid(clean), name: name.trim(), email: clean, password };
  users.push(user);
  saveJSON(DB_USERS, users);
  saveJSON(dbKey(user.id, 'diary'), {});
  saveJSON(dbKey(user.id, 'history'), []);
  saveJSON(dbKey(user.id, 'weight'), []);
  saveJSON(dbKey(user.id, 'goals'), { ...GOALS });
  saveJSON(dbKey(user.id, 'water'), {});
  saveJSON(dbKey(user.id, 'photos'), []);
  saveJSON(dbKey(user.id, 'barcodes'), []);
  setSession(user.id);
  LOG('Зарегистрирован:', user.email, '| uid =', user.id);
  return { user };
}
function loginUser(email, password) {
  const clean = email.toLowerCase().trim();
  const user = loadUsers().find((u) => u.email === clean);
  if (!user || user.password !== password) return { error: 'Неверная почта или пароль. Проверьте ввод и попробуйте ещё раз.' };
  setSession(user.id);
  LOG('Вход выполнен:', user.email, '| uid =', user.id);
  return { user };
}

/* ------------------ 3. ОБЛАСТЬ ДАННЫХ ПОЛЬЗОВАТЕЛЯ ------------------ */
function loadScope(uid) {
  const diary = loadJSON(dbKey(uid, 'diary'), {});
  const water = loadJSON(dbKey(uid, 'water'), {});
  const photos = loadJSON(dbKey(uid, 'photos'), []);
  const barcodes = loadJSON(dbKey(uid, 'barcodes'), []);
  return {
    diary: diary && typeof diary === 'object' ? diary : {},
    history: loadJSON(dbKey(uid, 'history'), []),
    weight: loadJSON(dbKey(uid, 'weight'), []),
    goals: loadJSON(dbKey(uid, 'goals'), null) || { ...GOALS },
    profile: loadJSON(dbKey(uid, 'profile'), null),
    water: water && typeof water === 'object' ? water : {},
    photos: Array.isArray(photos) ? photos : [],
    barcodes: Array.isArray(barcodes) ? barcodes : [],
  };
}

/* ------------------ 4. СОСТОЯНИЕ ------------------ */
const state = {
  uid: scopeUid(), date: dateKey(0), dayOffset: 0,
  diary: {}, history: [], weight: [], goals: { ...GOALS }, profile: null,
  water: {}, photos: [], barcodes: [],
  modalMeal: null, modalTab: 'search', modalQuery: '',
  selected: new Map(), photoSelected: new Set(), weightTarget: null,
};
function switchScope() {
  const scope = loadScope(scopeUid());
  state.uid = scopeUid();
  state.date = dateKey(state.dayOffset);
  state.diary = scope.diary; state.history = scope.history;
  state.weight = scope.weight; state.goals = scope.goals;
  state.profile = scope.profile; state.water = scope.water;
  state.photos = scope.photos; state.barcodes = scope.barcodes;
  state.modalMeal = null; state.modalQuery = '';
  state.selected.clear(); state.photoSelected.clear(); state.weightTarget = null;
  rebuildBarcodes();
  renderUserBadge();
  LOG('Активный профиль:', state.uid, '| товаров в базе штрихкодов:', BARCODE_INDEX.size);
}
function renderUserBadge() {
  const foot = $('.sidebar__foot');
  if (!foot) return;
  let badge = $('#sidebar-user-badge');
  if (!badge) {
    badge = document.createElement('a');
    badge.id = 'sidebar-user-badge'; badge.href = 'profile.html';
    badge.className = 'sidebar__note';
    badge.style.fontWeight = '700'; badge.style.color = 'var(--clr-teal-deep)';
    foot.prepend(badge);
  }
  const user = currentUser();
  badge.textContent = user ? `Аккаунт: ${user.name} (${user.email})` : 'Режим: Гость (войти в профиль)';
}
switchScope();

const dayEntries = () => {
  if (!state.diary[state.date]) state.diary[state.date] = { breakfast: [], lunch: [], dinner: [], snack: [] };
  return state.diary[state.date];
};
const persistDiary = () => { state.uid = scopeUid(); saveJSON(dbKey(state.uid, 'diary'), state.diary); };
const persistHistory = () => { state.uid = scopeUid(); saveJSON(dbKey(state.uid, 'history'), state.history); };
function rerenderAll() {
  renderUserBadge(); renderDate(); renderMeals(); renderSummary();
  renderWater(); renderPhotos(); renderBcSaved();
}

/* ------------------ 5. СВОДКА ДНЯ ------------------ */
function dayTotals() {
  const totals = { kcal: 0, p: 0, f: 0, c: 0 };
  const day = dayEntries();
  MEALS.forEach(({ key }) => (day[key] || []).forEach((item) => {
    const p = itemProduct(item);
    if (!p) return;
    const portion = calcPortion(p, item.weight, item.unit);
    totals.kcal += portion.kcal; totals.p += portion.p; totals.f += portion.f; totals.c += portion.c;
  }));
  totals.p = Math.round(totals.p); totals.f = Math.round(totals.f); totals.c = Math.round(totals.c);
  return totals;
}
function renderSummary() {
  const totals = dayTotals();
  const goals = state.goals || GOALS;
  const ring = $('#ring-progress'), value = $('#ring-value'), goalLabel = $('#ring-goal');
  if (ring && value) {
    const ratio = Math.min(totals.kcal / goals.kcal, 1);
    ring.style.strokeDashoffset = String(Math.round(RING_LENGTH * (1 - ratio)));
    ring.classList.toggle('is-over', totals.kcal > goals.kcal);
    value.textContent = totals.kcal.toLocaleString('ru-RU');
  }
  if (goalLabel) goalLabel.textContent = `из ${goals.kcal.toLocaleString('ru-RU')} ккал`;
  [['protein', totals.p, goals.p], ['fat', totals.f, goals.f], ['carb', totals.c, goals.c]].forEach(([key, fact, goal]) => {
    const bar = $(`[data-macro-bar="${key}"]`), label = $(`[data-macro-value="${key}"]`);
    if (bar) bar.style.width = `${Math.min((fact / goal) * 100, 100)}%`;
    if (label) label.textContent = `${fact} / ${goal} г`;
  });
}
const renderDate = () => { const el = $('#diary-date'); if (el) el.textContent = dateTitle(state.date); };

/* ------------------ 6. РЕНДЕР ПРИЁМОВ ПИЩИ ------------------ */
function mealItemTemplate(item, index) {
  const p = itemProduct(item);
  if (!p) return '';
  const unit = item.unit === 'ml' ? 'ml' : item.unit === 'pc' ? 'pc' : 'g';
  const portion = calcPortion(p, item.weight, unit);
  return `<li class="meal-item" data-index="${index}">
    <span class="meal-item__name">${esc(p.name)}</span>
    <button class="meal-item__weight" data-action="edit-weight" title="Нажмите, чтобы изменить порцию">${amountText(item.weight, unit)} ${unitLabel(unit)}</button>
    <span class="meal-item__cals">${portion.kcal} ккал</span>
    <button class="meal-item__delete" data-action="delete" aria-label="Удалить «${esc(p.name)}»">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
    </button>
  </li>`;
}
function renderMeals() {
  const day = dayEntries();
  MEALS.forEach(({ key }) => {
    const list = $(`[data-meal-list="${key}"]`), total = $(`[data-meal-total="${key}"]`);
    if (!list) return;
    const items = day[key] || [];
    list.innerHTML = items.length ? items.map(mealItemTemplate).join('') : '<li class="meal-card__empty">Пока ничего не добавлено</li>';
    if (total) {
      const kcal = items.reduce((sum, item) => {
        const p = itemProduct(item);
        return p ? sum + calcPortion(p, item.weight, item.unit).kcal : sum;
      }, 0);
      total.textContent = `${kcal} ккал`;
    }
  });
}

/* ------------------ 7. ОКНО ВЫБОРА: ПОИСК / НЕДАВНИЕ / ФОТО ------------------ */
let modalEl = null, modalList = null, modalSearch = null, modalSave = null;
let weightModal = null, weightInput = null, scanModal = null, confirmModal = null, bcModal = null;

function openModal(mealKey) {
  if (!modalEl) return;
  state.modalMeal = mealKey; state.modalQuery = '';
  state.selected.clear(); state.photoSelected.clear();
  modalSearch.value = '';
  modalEl.hidden = false; document.body.classList.add('no-scroll');
  switchTab('search'); updateSaveBtn(); modalSearch.focus();
}
function closeModal() {
  if (!modalEl) return;
  modalEl.hidden = true; document.body.classList.remove('no-scroll'); state.modalMeal = null;
}
function switchTab(tab) {
  state.modalTab = tab;
  $$('.modal__tab').forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  const wrap = $('#modal-search-wrap');
  if (wrap) wrap.hidden = tab !== 'search';
  renderModalList();
}
function rowTemplate(p, lastWeight, lastUnit, lastPiece) {
  const selected = state.selected.has(p.id);
  const unit = lastUnit || defaultUnit(p);
  const piece = num0(lastPiece) || num0(p.piece);
  const hint = lastWeight
    ? `последний раз ${amountText(lastWeight, unit)} ${unitLabel(unit)}`
    : piece > 0 ? `1 шт ≈ ${trimNum(piece)} г` : '';
  return `<li class="modal__item">
    <button class="modal__item-btn ${selected ? 'is-selected' : ''}" data-product="${p.id}"
      data-last="${lastWeight ?? ''}" data-last-unit="${unit}" data-last-piece="${piece || ''}">
      <span class="modal__item-name">${esc(p.name)}</span>
      ${hint ? `<span class="modal__item-last">${hint}</span>` : ''}
      <span class="modal__item-kcal">${p.kcal} ккал / 100 ${isDrink(p) ? 'мл' : 'г'}</span>
      <span class="modal__item-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>
    </button>
  </li>`;
}
function photoRows() {
  return (state.photos || []).map((ph) => {
    const sel = state.photoSelected.has(ph.id);
    return `<li class="modal__item">
      <button class="modal__item-btn modal__item-btn--photo ${sel ? 'is-selected' : ''}" data-photo-pick="${ph.id}">
        <img class="modal__photo-thumb" src="${ph.img}" alt="" loading="lazy">
        <span class="modal__item-name">${esc(ph.dish)}</span>
        <span class="modal__item-kcal">${ph.kcal} ккал</span>
        <span class="modal__item-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>
      </button>
    </li>`;
  });
}
function renderModalList() {
  if (!modalList) return;
  const rows = state.modalTab === 'search' ? searchRows()
    : state.modalTab === 'recent' ? recentRows()
    : photoRows();
  const emptyMsg = state.modalTab === 'photos'
    ? 'Пока нет фото — отсканируйте блюдо кнопкой «Фото» у приёма пищи.'
    : 'Ничего не найдено — попробуйте другой запрос';
  modalList.innerHTML = rows.length ? rows.join('') : `<li class="modal__empty">${emptyMsg}</li>`;
}
function searchRows() {
  const q = state.modalQuery.trim().toLowerCase();
  const pool = allProducts();
  const source = q ? pool.filter((p) => p.name.toLowerCase().includes(q)) : pool;
  return source.map((p) => rowTemplate(p, null));
}
function recentRows() {
  return state.history.map((r) => {
    const p = resolveProduct(r.id);
    return p ? rowTemplate(p, r.weight, r.unit, r.piece) : '';
  }).filter(Boolean);
}
function toggleProduct(btn) {
  const id = btn.dataset.product;
  if (state.selected.has(id)) { state.selected.delete(id); btn.classList.remove('is-selected'); }
  else {
    const p = resolveProduct(id);
    const unit = btn.dataset.lastUnit || defaultUnit(p);
    const last = Number(btn.dataset.last);
    const piece = num0(btn.dataset.lastPiece) || num0(p && p.piece);
    state.selected.set(id, { weight: last > 0 ? last : defaultAmount(unit), unit, piece });
    btn.classList.add('is-selected');
  }
  updateSaveBtn();
}
function togglePhotoPick(btn) {
  const id = btn.dataset.photoPick;
  if (state.photoSelected.has(id)) { state.photoSelected.delete(id); btn.classList.remove('is-selected'); }
  else { state.photoSelected.add(id); btn.classList.add('is-selected'); }
  updateSaveBtn();
}
function updateSaveBtn() {
  if (!modalSave) return;
  const n = state.selected.size + state.photoSelected.size;
  modalSave.textContent = n > 0 ? `Сохранить (${n})` : 'Сохранить';
  modalSave.disabled = n === 0;
}
function addPhotoItems(items, mealKey) {
  const bucket = dayEntries()[mealKey];
  (items || []).forEach((it) => {
    if (it.matchedId && resolveProduct(it.matchedId)) {
      bucket.push({ id: it.matchedId, weight: it.grams, unit: 'g' });
    } else {
      bucket.push({
        custom: { name: it.name, kcal100: it.kcal100, p100: it.p100, f100: it.f100, c100: it.c100 },
        weight: it.grams, unit: 'g',
      });
    }
  });
}
function saveSelection() {
  const bucket = dayEntries()[state.modalMeal];
  state.selected.forEach(({ weight, unit, piece }, id) => {
    const item = { id, weight, unit };
    if (num0(piece) > 0) item.piece = num0(piece);
    bucket.push(item);
    pushHistory(id, weight, unit, piece);
  });
  state.photoSelected.forEach((pid) => {
    const ph = (state.photos || []).find((p) => p.id === pid);
    if (ph) addPhotoItems(ph.items, state.modalMeal);
  });
  persistDiary(); renderMeals(); renderSummary(); closeModal();
}
function pushHistory(id, weight, unit, piece) {
  if (!resolveProduct(id)) return;
  state.history = state.history.filter((r) => r.id !== id);
  const rec = { id, weight, unit, ts: Date.now() };
  if (num0(piece) > 0) rec.piece = num0(piece);
  state.history.unshift(rec);
  state.history = state.history.slice(0, HISTORY_LIMIT);
  persistHistory();
}

/* ------------------ 8. ПОРЦИЯ: ШТУКИ / ГРАММЫ / МИЛЛИЛИТРЫ ------------------ */
function weightTargetProduct() {
  const t = state.weightTarget;
  if (!t) return null;
  return itemProduct(dayEntries()[t.meal][t.index]);
}
function setUnitUI(unit, p) {
  const toggle = $('#weight-unit-toggle');
  if (!toggle) return;
  const pc = canPieces(p), ml = isDrink(p);
  $$('.unit-switch__btn', toggle).forEach((btn) => {
    const u = btn.dataset.unit;
    const avail = u === 'pc' ? pc : u === 'ml' ? ml : true;
    btn.hidden = !avail;
    const active = u === unit;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  const sepPc = $('[data-sep="pc"]', toggle), sepMl = $('[data-sep="ml"]', toggle);
  if (sepPc) sepPc.hidden = !pc;
  if (sepMl) sepMl.hidden = !ml;
  toggle.hidden = !pc && !ml;
  const title = $('#weight-title');
  if (title) title.textContent = unit === 'ml' ? 'Изменить объём' : unit === 'pc' ? 'Изменить количество' : 'Изменить граммовку';
  const hint = $('#weight-hint');
  if (hint) {
    hint.textContent = pc ? `1 шт ≈ ${trimNum(p.piece)} г` : '';
    hint.hidden = !pc;
  }
}
function openWeightModal(mealKey, index) {
  if (!weightModal) return;
  const item = dayEntries()[mealKey][index];
  const p = itemProduct(item);
  if (!p) return;
  const unit = item.unit === 'ml' ? 'ml' : item.unit === 'pc' ? 'pc' : item.unit === 'g' ? 'g' : defaultUnit(p);
  state.weightTarget = { meal: mealKey, index, unit };
  $('#weight-name').textContent = p.name;
  setUnitUI(unit, p);
  weightInput.step = unit === 'pc' ? '0.5' : '1';
  weightInput.min = unit === 'pc' ? '0.5' : '1';
  weightInput.value = item.weight;
  updateWeightHint();
  weightModal.hidden = false; document.body.classList.add('no-scroll');
  weightInput.focus(); weightInput.select();
}
function closeWeightModal() {
  if (!weightModal) return;
  weightModal.hidden = true; document.body.classList.remove('no-scroll'); state.weightTarget = null;
}
function setWeightUnit(next) {
  const t = state.weightTarget;
  if (!t || next === t.unit) return;
  const p = weightTargetProduct();
  if (!p) return;
  if (next === 'pc' && !canPieces(p)) return;
  if (next === 'ml' && !isDrink(p)) return;
  const grams = toGrams(p, num0(weightInput.value), t.unit);
  const converted = next === 'pc' ? grams / num0(p.piece)
    : next === 'ml' ? grams / drinkDensity(p) : grams;
  weightInput.value = next === 'pc'
    ? Math.max(0.5, Math.round(converted * 2) / 2)
    : Math.max(1, Math.round(converted));
  weightInput.step = next === 'pc' ? '0.5' : '1';
  weightInput.min = next === 'pc' ? '0.5' : '1';
  t.unit = next;
  setUnitUI(next, p);
  updateWeightHint();
}
function updateWeightHint() {
  const t = state.weightTarget;
  if (!t || !weightInput) return;
  const p = weightTargetProduct();
  if (!p) return;
  const amount = Math.max(num0(weightInput.value), 0);
  const m = calcPortion(p, amount, t.unit);
  const grams = t.unit === 'pc' ? ` · ${Math.round(toGrams(p, amount, 'pc'))} г` : '';
  $('#weight-kcal').textContent = `${m.kcal} ккал${grams}`;
}
function saveWeight() {
  const t = state.weightTarget;
  if (!t) return;
  const p = weightTargetProduct();
  const item = dayEntries()[t.meal][t.index];
  const raw = num0(weightInput.value);
  const amount = t.unit === 'pc' ? clamp(Math.round(raw * 2) / 2, 0.5, 200) : clamp(Math.round(raw), 0, 5000);
  if (amount > 0 && p) {
    item.weight = amount;
    item.unit = t.unit;
    if (canPieces(p)) item.piece = num0(p.piece); else delete item.piece;
    pushHistory(item.id, amount, t.unit, item.piece);
  }
  persistDiary(); renderMeals(); renderSummary(); closeWeightModal();
}
function deleteItem(mealKey, index) {
  dayEntries()[mealKey].splice(index, 1);
  persistDiary(); renderMeals(); renderSummary();
}

/* ------------------ 9. НАВИГАЦИЯ ПО ДНЯМ ------------------ */
function shiftDay(delta) {
  state.dayOffset += delta;
  state.date = dateKey(state.dayOffset);
  renderDate(); renderMeals(); renderSummary(); renderWater();
}

/* ------------------ 9.5. ВОДНЫЙ БАЛАНС ------------------ */
const waterEntries = () => {
  if (!Array.isArray(state.water[state.date])) state.water[state.date] = [];
  return state.water[state.date];
};
const persistWater = () => { state.uid = scopeUid(); saveJSON(dbKey(state.uid, 'water'), state.water); };
const waterGoalMl = () => {
  const liters = Number(state.goals && state.goals.waterL);
  return liters > 0 ? Math.round(liters * 1000) : WATER_DEFAULT_ML;
};
function renderWater() {
  const root = $('#water-card');
  if (!root) return;
  const entries = waterEntries();
  const total = entries.reduce((sum, e) => sum + e.ml, 0);
  const goal = waterGoalMl();
  const pct = goal > 0 ? Math.round((total / goal) * 100) : 0;
  const ring = $('#water-ring');
  if (ring) ring.style.strokeDashoffset = String(Math.round(RING_LENGTH * (1 - Math.min(total / goal, 1))));
  const totalEl = $('#water-total'); if (totalEl) totalEl.textContent = total.toLocaleString('ru-RU');
  const goalEl = $('#water-goal'); if (goalEl) goalEl.textContent = `из ${goal.toLocaleString('ru-RU')} мл`;
  const pctEl = $('#water-percent'); if (pctEl) pctEl.textContent = `${pct}%`;
  const bar = $('#water-bar'); if (bar) bar.style.width = `${Math.min(pct, 100)}%`;
  const done = goal > 0 && total >= goal;
  root.classList.toggle('is-done', done);
  const hint = $('#water-hint');
  if (hint) hint.textContent = done
    ? 'Норма воды выполнена — отличная работа!'
    : 'Норма подставляется из вашей цели. Нажимайте на ёмкости, чтобы отмечать выпитое.';
  const list = $('#water-log');
  if (list) {
    list.innerHTML = entries.length
      ? entries.map((e, i) => `<li class="water__log-item">
          <span class="water__log-ml">${e.ml} мл</span>
          <span class="water__log-time">${new Date(e.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
          <button class="water__log-del" type="button" data-water-del="${i}" aria-label="Удалить запись ${e.ml} мл">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </li>`).join('')
      : '<li class="water__log-empty">Пока нет записей — нажмите на ёмкость выше</li>';
  }
}
function addWater(ml) {
  if (!ml || ml <= 0) return;
  waterEntries().unshift({ ml, ts: Date.now() });
  persistWater(); renderWater();
}
function splashWater(btn) {
  btn.classList.remove('is-splash');
  void btn.offsetWidth;
  btn.classList.add('is-splash');
  setTimeout(() => btn.classList.remove('is-splash'), 700);
}
function deleteWater(index) {
  const entries = waterEntries();
  if (!Number.isInteger(index) || index < 0 || index >= entries.length) return;
  entries.splice(index, 1);
  persistWater(); renderWater();
}

/* ==========================================================================
   9.6. СКАНЕР БЛЮДА ПО ФОТО
   ========================================================================== */
const POLZA_URL = 'https://polza.ai/api/v1/chat/completions';
/* ВРЕМЕННЫЙ ключ — потом замени только эту строку */
const POLZA_KEY = 'pza_b7larVmCnOBU30Ubv5waAoL5qtab0QJO';
const SCAN_MODELS = ['google/gemini-3.7-flash', 'google/gemini-3-pro-preview'];
const PHOTOS_LIMIT = 12;

const SCAN_PROMPT = [
  'Ты нутрициолог и эксперт по оценке еды на фотографиях.',
  'Определи все съедобные позиции на снимке блюда.',
  'Для каждой позиции оцени массу в граммах и КБЖУ НА 100 ГРАММ.',
  'Соусы, масло, сметану, сахар и заправку выделяй отдельными позициями.',
  'Напитки указывай в граммах (плотность примерно 1).',
  'Отвечай ТОЛЬКО валидным JSON без markdown и пояснений, схема:',
  '{"dish":"короткое название блюда","items":[{"name":"Пельмени","grams":250,"kcal100":275,"p100":12,"f100":14,"c100":25}],"notes":"краткая оговорка о погрешности"}',
  'Если еды на фото нет, верни {"dish":"","items":[],"notes":"причина"}.',
].join('\n');

const scan = {
  meal: 'breakfast', dataUrl: '', thumb: '', items: [], dish: '', note: '',
  model: '', busy: false, seq: 0, photoId: null, viewMode: false,
};

const shrinkImage = (dataUrl, maxSide, quality) => new Promise((resolve, reject) => {
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
    resolve({ url: c.toDataURL('image/jpeg', quality), w: c.width, h: c.height });
  };
  img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
  img.src = dataUrl;
});

function extractJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('Модель не вернула JSON');
  return JSON.parse(t.slice(a, b + 1));
}

async function scanRequest(model) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(POLZA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${POLZA_KEY}` },
      body: JSON.stringify({
        model,
        max_tokens: 6000,
        reasoning_effort: 'low',
        temperature: model.includes('gemini-3') ? 1 : 0.2,
        messages: [
          { role: 'system', content: 'Ты нутрициолог. Отвечай только валидным JSON без markdown.' },
          { role: 'user', content: [
            { type: 'text', text: SCAN_PROMPT },
            { type: 'image_url', image_url: { url: scan.dataUrl } },
          ] },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      const err = new Error(`${model}: ответ ${res.status}${t ? ' · ' + t.slice(0, 140) : ''}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    if (!content) { const err = new Error(`${model}: пустой ответ модели`); err.status = 502; throw err; }
    return extractJson(typeof content === 'string' ? content : JSON.stringify(content));
  } catch (e) {
    if (e.name === 'AbortError') { const err = new Error(`${model} не ответила за 90 секунд`); err.status = 408; throw err; }
    if (e instanceof TypeError) throw new Error('Браузер заблокировал запрос (CORS или сеть). Нужен локальный прокси-сервер.');
    throw e;
  } finally { clearTimeout(timer); }
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const normName = (s) => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
function matchProduct(name) {
  const qn = normName(name);
  if (!qn) return null;
  const qt = qn.split(' ').filter((w) => w.length > 2);
  let best = null;
  for (const p of allProducts()) {
    const pn = normName(p.name);
    let hit = 0;
    for (const w of qt) if (pn.includes(w)) hit++;
    const score = hit / Math.max(qt.length, 1) + ((pn.includes(qn) || qn.includes(pn)) ? 0.5 : 0);
    if (score >= 0.6 && (!best || score > best.score)) best = { id: p.id, score };
  }
  return best ? best.id : null;
}
function normalizeScanItems(raw) {
  const arr = Array.isArray(raw?.items) ? raw.items : [];
  return arr.slice(0, 12).map((it) => ({
    name: String(it.name || 'Позиция').slice(0, 60),
    grams: clamp(Math.round(num0(it.grams) || 100), 1, 5000),
    kcal100: num0(it.kcal100), p100: num0(it.p100), f100: num0(it.f100), c100: num0(it.c100),
    matchedId: matchProduct(it.name),
  })).filter((it) => it.name);
}
const scanPortion = (it) => {
  const db = it.matchedId ? resolveProduct(it.matchedId) : null;
  if (db) return calcPortion(db, it.grams, 'g');
  const k = it.grams / 100;
  return {
    kcal: Math.round(num0(it.kcal100) * k),
    p: +(num0(it.p100) * k).toFixed(1),
    f: +(num0(it.f100) * k).toFixed(1),
    c: +(num0(it.c100) * k).toFixed(1),
  };
};
function scanTotals() {
  const t = { kcal: 0, p: 0, f: 0, c: 0 };
  scan.items.forEach((it) => { const m = scanPortion(it); t.kcal += m.kcal; t.p += m.p; t.f += m.f; t.c += m.c; });
  t.p = Math.round(t.p); t.f = Math.round(t.f); t.c = Math.round(t.c);
  return t;
}
function setScanStage(stage) {
  $('#scan-pick').hidden = stage !== 'pick';
  $('#scan-busy').hidden = stage !== 'busy';
  $('#scan-result').hidden = stage !== 'result';
  $('#scan-error').hidden = stage !== 'error';
}
function openScan(meal) {
  if (!scanModal) return;
  scan.seq++;
  scan.meal = meal; scan.photoId = null; scan.busy = false; scan.viewMode = false;
  $('#scan-meal').textContent = MEAL_LABELS[meal] || 'Приём пищи';
  setScanStage('pick');
  scanModal.hidden = false;
  document.body.classList.add('no-scroll');
  $('#scan-file').click();
}
function closeScan() {
  if (!scanModal) return;
  scan.seq++; scan.busy = false;
  scanModal.hidden = true;
  document.body.classList.remove('no-scroll');
}
async function handleScanFile(file) {
  if (!file || !file.type.startsWith('image/')) { showToast('Нужен файл изображения'); return; }
  const fr = new FileReader();
  fr.onload = async () => {
    try {
      const send = await shrinkImage(String(fr.result), 1024, 0.8);
      const store = await shrinkImage(String(fr.result), 560, 0.62);
      scan.dataUrl = send.url; scan.thumb = store.url; scan.photoId = null; scan.viewMode = false;
      runScan();
    } catch (e) {
      $('#scan-error-text').textContent = e.message || 'Не удалось прочитать фото';
      setScanStage('error');
    }
  };
  fr.onerror = () => { $('#scan-error-text').textContent = 'Не удалось прочитать файл'; setScanStage('error'); };
  fr.readAsDataURL(file);
}
async function runScan() {
  if (!scan.dataUrl) { setScanStage('pick'); return; }
  const token = ++scan.seq;
  scan.busy = true;
  setScanStage('busy');
  $('#scan-img').src = scan.dataUrl;
  const failures = [];
  for (const model of SCAN_MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      $('#scan-status').textContent = `Сканирую фото · ${model.replace('google/', '')}${attempt > 1 ? ' · повтор ' + attempt : ''}…`;
      try {
        const raw = await scanRequest(model);
        if (token !== scan.seq) return;
        const items = normalizeScanItems(raw);
        if (!items.length) throw new Error(raw?.notes || 'На фото не найдено еды');
        scan.items = items;
        scan.dish = String(raw.dish || items.map((i) => i.name).join(', ')).slice(0, 90);
        scan.note = String(raw.notes || '').slice(0, 160);
        scan.model = model;
        saveScanPhoto();
        renderScanResult();
        setScanStage('result');
        scan.busy = false;
        return;
      } catch (e) {
        if (token !== scan.seq) return;
        failures.push(e.message);
        LOG('Сканер: отказ', model, '| попытка', attempt, '|', e.message);
        const retryable = RETRYABLE.has(e.status) || /502|503|429|500|504|не ответила/i.test(e.message);
        if (attempt === 1 && retryable) {
          await sleep(1500);
          if (token !== scan.seq) return;
          continue;
        }
        break;
      }
    }
  }
  scan.busy = false;
  $('#scan-error-text').textContent = failures.join(' | ') || 'Модели не ответили. Попробуйте ещё раз.';
  setScanStage('error');
}
function renderScanResult() {
  $('#scan-img-result').src = scan.thumb || scan.dataUrl;
  $('#scan-dish').textContent = scan.dish || 'Блюдо';
  $('#scan-items').innerHTML = scan.items.map((it) => {
    const m = scanPortion(it);
    return `<li class="scan__item">
      <span class="scan__item-name">${esc(it.name)}${it.matchedId ? ' <em class="scan__item-db">из базы</em>' : ''}</span>
      <span class="scan__item-g">${it.grams} г</span>
      <span class="scan__item-kcal">${m.kcal} ккал</span>
      <span class="scan__item-macros">Б ${trimNum(m.p)} · Ж ${trimNum(m.f)} · У ${trimNum(m.c)}</span>
    </li>`;
  }).join('');
  const t = scanTotals();
  $('#scan-total-kcal').textContent = `${t.kcal} ккал`;
  $('#scan-total-macros').textContent = `Б ${trimNum(t.p)} · Ж ${trimNum(t.f)} · У ${trimNum(t.c)}`;
  $('#scan-note').textContent = scan.note;
  const hint = $('#scan-hint');
  if (hint) hint.textContent = scan.viewMode
    ? 'Фото из галереи. Чтобы добавить блюдо в приём пищи: «+ Добавить» → вкладка «Фото».'
    : 'Фото сохранено в галерею. Чтобы добавить блюдо в приём пищи: «+ Добавить» → вкладка «Фото».';
}
function saveScanPhoto() {
  const t = scanTotals();
  const photo = {
    id: 'ph' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    ts: Date.now(), date: dateKey(0), meal: scan.meal, dish: scan.dish,
    kcal: t.kcal, img: scan.thumb, model: scan.model,
    items: scan.items.map((i) => ({ ...i })),
  };
  state.photos = [photo, ...(state.photos || [])];
  const ok = persistPhotos();
  scan.photoId = photo.id;
  renderPhotos();
  if (!ok) showToast('Фото не сохранено: хранилище браузера переполнено');
}
function persistPhotos() {
  state.uid = scopeUid();
  let list = (state.photos || []).slice(0, PHOTOS_LIMIT);
  while (list.length) {
    try { saveJSON(dbKey(state.uid, 'photos'), list); state.photos = list; return true; }
    catch { list = list.slice(0, -1); }
  }
  try { saveJSON(dbKey(state.uid, 'photos'), []); state.photos = []; } catch { /* нет места */ }
  return false;
}
function renderPhotos() {
  const grid = $('#photos-grid');
  if (!grid) return;
  const list = state.photos || [];
  const count = $('#photos-count'); if (count) count.textContent = String(list.length);
  const empty = $('#photos-empty'); if (empty) empty.hidden = list.length > 0;
  grid.innerHTML = list.map((ph) => `<li class="photo-card">
    <button class="photo-card__open" type="button" data-photo-open="${ph.id}" aria-label="Открыть фото: ${esc(ph.dish)}">
      <img src="${ph.img}" alt="${esc(ph.dish)}" loading="lazy">
    </button>
    <div class="photo-card__body">
      <strong class="photo-card__name">${esc(ph.dish)}</strong>
      <span class="photo-card__kcal">${ph.kcal} ккал</span>
      <span class="photo-card__meta">${MEAL_LABELS[ph.meal] || ''} · ${fmtDateTime(ph.ts)}</span>
    </div>
    <button class="photo-card__del" type="button" data-photo-del="${ph.id}" aria-label="Удалить фото: ${esc(ph.dish)}" title="Удалить фото">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>
    </button>
  </li>`).join('');
}
function openScanView(id) {
  const ph = (state.photos || []).find((p) => p.id === id);
  if (!ph || !scanModal) return;
  scan.seq++;
  scan.meal = ph.meal; scan.photoId = ph.id; scan.viewMode = true;
  scan.items = (ph.items || []).map((i) => ({ ...i }));
  scan.dish = ph.dish; scan.thumb = ph.img; scan.dataUrl = ph.img;
  scan.model = ph.model || ''; scan.busy = false;
  scan.note = `Сохранено ${fmtDateTime(ph.ts)}`;
  $('#scan-meal').textContent = MEAL_LABELS[ph.meal] || 'Приём пищи';
  renderScanResult();
  setScanStage('result');
  scanModal.hidden = false;
  document.body.classList.add('no-scroll');
}
function deletePhoto(id) {
  state.photos = (state.photos || []).filter((p) => p.id !== id);
  state.photoSelected.delete(id);
  persistPhotos();
  renderPhotos();
  showToast('Фото удалено из галереи');
}
let pendingDeletePhoto = null;
function openConfirmDelete(id) {
  pendingDeletePhoto = id;
  if (confirmModal) { confirmModal.hidden = false; document.body.classList.add('no-scroll'); }
}
function closeConfirmDelete() {
  pendingDeletePhoto = null;
  if (confirmModal) { confirmModal.hidden = true; document.body.classList.remove('no-scroll'); }
}
function confirmDeletePhoto() {
  if (pendingDeletePhoto) deletePhoto(pendingDeletePhoto);
  closeConfirmDelete();
}

/* ==========================================================================
   9.7. ШТРИХКОДЫ
   Своя база → мировая база → карточка товара. Источник пользователю
   не показывается; найденный товар всегда попадает в базу NutriFlow.
   ========================================================================== */
const bc = {
  meal: 'breakfast', code: '', product: null, unit: 'g', amount: 1,
  stream: null, timer: 0, detector: null, seq: 0,
};
const BC_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'];

const persistBarcodes = () => {
  state.uid = scopeUid();
  try { saveJSON(dbKey(state.uid, 'barcodes'), state.barcodes); return true; }
  catch { showToast('Не удалось сохранить товар: нет места в хранилище'); return false; }
};
function saveBcEntry(entry) {
  state.barcodes = [entry, ...(state.barcodes || []).filter((b) => String(b.code) !== entry.code)].slice(0, 200);
  persistBarcodes();
  rebuildBarcodes();
  renderBcSaved();
}
function setBcStatus(text, kind) {
  const el = $('#bc-status');
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind || 'info';
}
function setBcStage(stage) {
  ['start', 'search', 'result', 'new'].forEach((s) => {
    const el = $('#bc-' + s);
    if (el) el.hidden = s !== stage;
  });
}
function openBarcode(meal) {
  if (!bcModal) return;
  bc.meal = meal; bc.seq++;
  $('#bc-meal').textContent = MEAL_LABELS[meal] || 'Приём пищи';
  $('#bc-input').value = '';
  setBcStage('start');
  setBcStatus('Наведите камеру на штрихкод или введите цифры вручную.', 'info');
  renderBcSaved();
  bcModal.hidden = false;
  document.body.classList.add('no-scroll');
}
function closeBarcode() {
  stopBcCamera();
  if (!bcModal) return;
  bc.seq++;
  bcModal.hidden = true;
  document.body.classList.remove('no-scroll');
}
/* ---- Сканирование: нативный детектор (Chrome/Edge) или ZXing (все браузеры) ---- */
let bcReader = null;    // декодер ZXing
let bcControls = null;  // управление камерой ZXing
const hasNativeDetector = () => 'BarcodeDetector' in window;
const hasZxing = () => typeof ZXing !== 'undefined' && Boolean(ZXing.BrowserMultiFormatReader);
const canUseCamera = () => Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

function zxingReader() {
  if (bcReader) return bcReader;
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
    ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39,
  ]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  bcReader = new ZXing.BrowserMultiFormatReader(hints, 250);
  return bcReader;
}

async function makeDetector() {
  const supported = await window.BarcodeDetector.getSupportedFormats();
  const formats = BC_FORMATS.filter((f) => supported.includes(f));
  return new window.BarcodeDetector(formats.length ? { formats } : undefined);
}

async function startBcCamera() {
  const video = $('#bc-video');
  if (!video) return;
  if (!canUseCamera()) {
    setBcStatus('Камера недоступна. Введите цифры вручную — поиск по базе работает везде.', 'warn');
    return;
  }

  /* Путь 1: нативный детектор — самый быстрый, если браузер его умеет */
  if (hasNativeDetector()) {
    try {
      bc.detector = await makeDetector();
      bc.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false,
      });
      video.srcObject = bc.stream;
      await video.play();
      $('#bc-camera').hidden = false;
      setBcStatus('Камера включена. Держите штрихкод внутри рамки.', 'good');
      bcLoop();
      return;
    } catch { stopBcCamera(); }
  }

  /* Путь 2: ZXing — Firefox, Safari и любой другой браузер */
  if (hasZxing()) {
    try {
      const reader = zxingReader();
      $('#bc-camera').hidden = false;
      setBcStatus('Камера включена. Держите штрихкод внутри рамки.', 'good');
      bcControls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        video,
        (result) => {
          if (!result) return;
          const raw = String(result.getText() || '').replace(/\D/g, '');
          if (!raw) return;
          stopBcCamera();
          handleBarcode(raw);
        }
      );
      return;
    } catch (e) {
      stopBcCamera();
      setBcStatus('Камера недоступна: ' + (e.message || e.name) + '. Введите цифры вручную.', 'bad');
      return;
    }
  }

  setBcStatus('Сканер камеры не загрузился. Проверьте интернет или введите цифры вручную.', 'warn');
}

/* Цикл распознавания только для нативного детектора */
function bcLoop() {
  clearTimeout(bc.timer);
  const tick = async () => {
    if (!bc.stream || !bc.detector) return;
    const video = $('#bc-video');
    try {
      const found = await bc.detector.detect(video);
      const raw = found?.[0]?.rawValue?.replace(/\D/g, '');
      if (raw) { stopBcCamera(); handleBarcode(raw); return; }
    } catch { /* кадр ещё не готов */ }
    bc.timer = setTimeout(tick, 200);
  };
  bc.timer = setTimeout(tick, 200);
}

function stopBcCamera() {
  clearTimeout(bc.timer); bc.timer = 0;
  if (bcControls) { try { bcControls.stop(); } catch { /* уже остановлено */ } bcControls = null; }
  if (bc.stream) { bc.stream.getTracks().forEach((t) => t.stop()); bc.stream = null; }
  if (bcReader) { try { bcReader.reset(); } catch { /* нечего сбрасывать */ } }
  const v = $('#bc-video'); if (v) v.srcObject = null;
  const c = $('#bc-camera'); if (c) c.hidden = true;
}

/* Распознавание штрихкода по загруженному фото */
async function detectBarcodeFromImage(file) {
  if (!file || !file.type.startsWith('image/')) { setBcStatus('Нужен файл изображения.', 'bad'); return; }
  setBcStatus('Читаю штрихкод на фото…', 'info');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Не удалось открыть изображение'));
      i.src = url;
    });

    if (hasNativeDetector()) {
      try {
        const detector = await makeDetector();
        const found = await detector.detect(img);
        const raw = found?.[0]?.rawValue?.replace(/\D/g, '');
        if (raw) { handleBarcode(raw); return; }
      } catch { /* переходим к ZXing */ }
    }

    if (hasZxing()) {
      const reader = zxingReader();
      const attempts = [img];
      /* Крупное фото уменьшаем — так полосы штрихкода читаются надёжнее */
      const k = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
      if (k < 1 && typeof reader.decodeFromCanvas === 'function') {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        attempts.push(c);
      }
      for (const source of attempts) {
        try {
          const result = source instanceof HTMLCanvasElement
            ? await reader.decodeFromCanvas(source)
            : await reader.decodeFromImageElement(source);
          const raw = String(result?.getText?.() || '').replace(/\D/g, '');
          if (raw) { handleBarcode(raw); return; }
        } catch { /* код не найден на этом варианте — пробуем следующий */ }
      }
    }

    setBcStatus('На фото штрихкод не найден. Снимите ближе и ровнее или введите цифры.', 'warn');
  } catch (e) {
    setBcStatus('Не удалось прочитать фото: ' + (e.message || e.name), 'bad');
  } finally {
    URL.revokeObjectURL(url);
  }
}
/* Массу штуки и упаковки берём из данных о порции и весе упаковки */
const gramsFromText = (txt) => {
  const m = String(txt || '').replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(?:g|гр|г|грамм)/i);
  return m ? num0(m[1]) : 0;
};
const piecesFromText = (txt) => {
  const m = String(txt || '').match(/(\d+)\s*(?:шт|штук|pieces?|pcs?|pies?|bars?|пирожн|батончик)/i);
  return m ? num0(m[1]) : 0;
};
async function fetchWorldProduct(code) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const fields = 'product_name,product_name_ru,brands,nutriments,serving_quantity,serving_size,product_quantity,quantity';
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${fields}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    const pr = data.product;
    const n = pr.nutriments || {};
    const kcal = num0(n['energy-kcal_100g']) || Math.round(num0(n['energy_100g']) / 4.184);
    const p = num0(n.proteins_100g), f = num0(n.fat_100g), c = num0(n.carbohydrates_100g);
    if (!kcal && !p && !f && !c) return null;

    const servingGrams = num0(pr.serving_quantity) || gramsFromText(pr.serving_size);
    const servingPieces = piecesFromText(pr.serving_size);
    const pack = num0(pr.product_quantity) || gramsFromText(pr.quantity);
    let piece = servingGrams > 0 && servingGrams < 2000
      ? (servingPieces > 1 ? servingGrams / servingPieces : servingGrams)
      : 0;
    const packPieces = piecesFromText(pr.quantity);
    if (!piece && pack > 0 && packPieces > 1) piece = pack / packPieces;
    if (piece && pack && piece > pack) piece = 0;

    return {
      id: null, code, name: pr.product_name_ru || pr.product_name || 'Продукт ' + code,
      brand: String(pr.brands || '').split(',')[0].trim(),
      kcal, p, f, c, cat: 'barcode',
      piece: piece ? Math.round(piece * 10) / 10 : 0,
      pack: pack || 0,
    };
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function prepareBcProduct(product) {
  bc.product = product;
  bc.unit = defaultUnit(product);
  bc.amount = defaultAmount(bc.unit);
}
async function handleBarcode(raw) {
  const code = String(raw || '').replace(/\D/g, '');
  if (code.length < 8) {
    setBcStage('start');
    setBcStatus('Штрихкод содержит 8–14 цифр. Проверьте ввод.', 'bad');
    return;
  }
  const token = ++bc.seq;
  bc.code = code; bc.product = null;
  $('#bc-code-search').textContent = code;
  setBcStage('search');
  setBcStatus(eanValid(code) ? 'Ищу товар…' : 'Контрольная сумма не сходится — проверьте цифры. Всё равно ищу.', eanValid(code) ? 'info' : 'warn');

  const local = findBarcode(code);
  if (local) {
    if (token !== bc.seq) return;
    prepareBcProduct(local);
    renderBcResult();
    setBcStage('result');
    setBcStatus('Товар найден. Выберите порцию и добавьте в приём пищи.', 'good');
    return;
  }

  const remote = await fetchWorldProduct(code);
  if (token !== bc.seq) return;
  if (remote) {
    prepareBcProduct(remote);
    renderBcResult();
    setBcStage('result');
    setBcStatus('Товар найден. Выберите порцию и добавьте в приём пищи.', 'good');
    return;
  }

  $('#bc-code-new').textContent = code;
  $('#bc-new-name').value = ''; $('#bc-new-brand').value = '';
  $('#bc-new-kcal').value = 0; $('#bc-new-p').value = 0;
  $('#bc-new-f').value = 0; $('#bc-new-c').value = 0;
  $('#bc-new-piece').value = 0;
  $('#bc-new-unit').value = 'g'; $('#bc-new-amount').value = 100;
  setBcStage('new');
  setBcStatus(NOT_FOUND_TEXT, 'warn');
}

function renderBcResult() {
  const p = bc.product;
  if (!p) return;
  $('#bc-code').textContent = bc.code;
  $('#bc-name').textContent = p.name;
  const brand = $('#bc-brand');
  brand.textContent = p.brand || '';
  brand.hidden = !p.brand;
  $('#bc-kcal100').textContent = Math.round(num0(p.kcal));
  $('#bc-p100').textContent = trimNum(p.p);
  $('#bc-f100').textContent = trimNum(p.f);
  $('#bc-c100').textContent = trimNum(p.c);

  const pc = canPieces(p), ml = isDrink(p);
  const units = $('#bc-units');
  if (units) {
    $$('.bc__unit-btn', units).forEach((btn) => {
      const u = btn.dataset.bcUnit;
      const avail = u === 'pc' ? pc : u === 'ml' ? ml : true;
      btn.hidden = !avail;
      btn.classList.toggle('is-active', u === bc.unit);
      btn.setAttribute('aria-pressed', String(u === bc.unit));
    });
    units.hidden = !pc && !ml;
  }

  const packEl = $('#bc-pack');
  if (packEl) {
    const parts = [];
    if (pc) parts.push(`1 шт ≈ ${trimNum(p.piece)} г`);
    if (num0(p.pack) > 0) {
      const pcs = pc ? Math.round(num0(p.pack) / num0(p.piece)) : 0;
      parts.push(`упаковка ${trimNum(p.pack)} г${pcs > 1 ? ` ≈ ${pcs} шт` : ''}`);
    }
    packEl.textContent = parts.join(' · ');
    packEl.hidden = parts.length === 0;
  }

  const input = $('#bc-amount');
  input.step = bc.unit === 'pc' ? '0.5' : '1';
  input.min = bc.unit === 'pc' ? '0.5' : '1';
  input.max = bc.unit === 'pc' ? '200' : '5000';
  input.value = bc.amount;
  $('#bc-unit').textContent = unitLabel(bc.unit);
  $('#bc-add').textContent = `Добавить в ${MEAL_LABELS[bc.meal] || 'приём'}`;
  renderBcTotal();
}
function readBcAmount() {
  const raw = num0($('#bc-amount').value) || bc.amount;
  return bc.unit === 'pc' ? clamp(Math.round(raw * 2) / 2, 0.5, 200) : clamp(Math.round(raw), 1, 5000);
}
function renderBcTotal() {
  const p = bc.product;
  if (!p) return;
  bc.amount = readBcAmount();
  const m = calcPortion(p, bc.amount, bc.unit);
  const grams = bc.unit === 'pc' ? ` · ${Math.round(toGrams(p, bc.amount, 'pc'))} г` : '';
  $('#bc-total').textContent = `${m.kcal} ккал${grams} · Б ${trimNum(m.p)} · Ж ${trimNum(m.f)} · У ${trimNum(m.c)}`;
}
function setBcUnit(next) {
  const p = bc.product;
  if (!p || next === bc.unit) return;
  if (next === 'pc' && !canPieces(p)) return;
  if (next === 'ml' && !isDrink(p)) return;
  const grams = toGrams(p, bc.amount, bc.unit);
  bc.unit = next;
  bc.amount = next === 'pc' ? Math.max(0.5, Math.round((grams / num0(p.piece)) * 2) / 2)
    : next === 'ml' ? Math.max(1, Math.round(grams / drinkDensity(p)))
    : Math.max(1, Math.round(grams));
  renderBcResult();
}
function stepBc(dir) {
  const step = bc.unit === 'pc' ? 1 : (bc.amount >= 200 ? 50 : 10);
  const next = bc.amount + dir * step;
  bc.amount = bc.unit === 'pc' ? clamp(Math.round(next * 2) / 2, 0.5, 200) : clamp(Math.round(next), 1, 5000);
  $('#bc-amount').value = bc.amount;
  renderBcTotal();
}
function bcAdd() {
  const p = bc.product;
  if (!p) return;
  const amount = readBcAmount();
  const unit = bc.unit;
  const piece = num0(p.piece);

  /* Найденный товар всегда остаётся в базе NutriFlow */
  if (!isShippedCode(bc.code)) {
    saveBcEntry({
      code: bc.code, name: p.name, brand: p.brand || '',
      kcal: num0(p.kcal), p: num0(p.p), f: num0(p.f), c: num0(p.c),
      unit: isDrink(p) ? 'ml' : 'g', piece, pack: num0(p.pack), ts: Date.now(),
    });
  }
  let id = p.id && resolveProduct(p.id) ? p.id : 'bc-' + bc.code;
  const product = resolveProduct(id);
  const bucket = dayEntries()[bc.meal];
  if (product) {
    const item = { id, weight: amount, unit };
    if (piece > 0) item.piece = piece;
    bucket.push(item);
    pushHistory(id, amount, unit, piece);
  } else {
    bucket.push({
      custom: { name: p.name, kcal100: num0(p.kcal), p100: num0(p.p), f100: num0(p.f), c100: num0(p.c), piece },
      weight: amount, unit,
    });
  }
  persistDiary(); rerenderAll();
  const m = calcPortion(product || p, amount, unit);
  showToast(`${p.name} → ${MEAL_LABELS[bc.meal]}: ${m.kcal} ккал`);
  closeBarcode();
}
function bcNewAdd() {
  const name = $('#bc-new-name').value.trim();
  if (!name) {
    setBcStatus('Введите название товара — без него карточку не сохранить.', 'bad');
    $('#bc-new-name').focus();
    return;
  }
  const unit = $('#bc-new-unit').value === 'ml' ? 'ml' : 'g';
  const piece = clamp(num0($('#bc-new-piece').value), 0, 2000);
  saveBcEntry({
    code: bc.code, name, brand: $('#bc-new-brand').value.trim(),
    kcal: num0($('#bc-new-kcal').value), p: num0($('#bc-new-p').value),
    f: num0($('#bc-new-f').value), c: num0($('#bc-new-c').value),
    unit, piece, pack: 0, ts: Date.now(),
  });
  const amount = clamp(Math.round(num0($('#bc-new-amount').value) || 100), 1, 5000);
  const id = 'bc-' + bc.code;
  const product = resolveProduct(id);
  const item = { id, weight: amount, unit };
  if (piece > 0) item.piece = piece;
  dayEntries()[bc.meal].push(item);
  pushHistory(id, amount, unit, piece);
  persistDiary(); rerenderAll();
  const m = product ? calcPortion(product, amount, unit) : { kcal: 0 };
  showToast(`${name} сохранён и добавлен: ${m.kcal} ккал`);
  closeBarcode();
}
function renderBcSaved() {
  const wrap = $('#bc-saved-wrap'), list = $('#bc-saved');
  if (!wrap || !list) return;
  const items = state.barcodes || [];
  wrap.hidden = items.length === 0;
  list.innerHTML = items.slice(0, 12).map((b) => `<li class="bc__chip">
    <button type="button" data-bc-open="${esc(b.code)}" title="${esc(b.code)}">${esc(b.name)}</button>
    <button type="button" class="bc__chip-x" data-bc-del="${esc(b.code)}" aria-label="Удалить код ${esc(b.code)}">×</button>
  </li>`).join('');
}

/* ------------------ 10. АВТОРИЗАЦИЯ, ПРОФИЛЬ, СВОДКА ЦЕЛИ ------------------ */
let authMode = null;
function setAuthMode(mode) {
  authMode = mode;
  const form = $('#auth-form');
  if (!form) return;
  $('#auth-login-btn').classList.toggle('is-active', mode === 'login');
  $('#auth-register-btn').classList.toggle('is-active', mode === 'register');
  form.hidden = mode === null;
  $('#auth-name-field').hidden = mode !== 'register';
  $('#auth-error').hidden = true;
  const submit = $('#auth-submit');
  if (mode === 'login') { submit.textContent = 'Войти'; submit.className = 'btn btn--ghost auth__submit'; }
  else if (mode === 'register') { submit.textContent = 'Создать аккаунт'; submit.className = 'btn btn--primary auth__submit'; }
}
function submitAuth(event) {
  if (event) event.preventDefault();
  const errorBox = $('#auth-error');
  errorBox.hidden = true;
  const fail = (t) => { errorBox.textContent = t; errorBox.hidden = false; };
  const email = $('#auth-email').value.trim(), password = $('#auth-pass').value;
  if (!email || !password) return fail('Заполните почту и пароль.');
  if (authMode === 'register') {
    const name = $('#auth-name').value.trim();
    if (!name) return fail('Введите имя — оно появится в профиле.');
    if (password.length < 4) return fail('Пароль должен быть не короче 4 символов.');
    const res = registerUser(name, email, password);
    if (res.error) return fail(res.error);
  } else {
    const res = loginUser(email, password);
    if (res.error) return fail(res.error);
  }
  $('#auth-pass').value = '';
  switchScope(); renderProfile(); rerenderAll();
}
const GOAL_LABELS = { lose: 'Похудение', maintain: 'Поддержание веса', gain: 'Набор массы' };
const ACTIVITY_LABELS = { sedentary: 'Сидячий', light: 'Немного активный', active: 'Часто активный', training: 'Регулярные тренировки' };
function renderProfileSummary() {
  const card = $('#profile-summary'), empty = $('#profile-empty');
  if (!card || !empty) return;
  const p = state.profile;
  if (!p) { card.hidden = true; empty.hidden = false; return; }
  empty.hidden = true; card.hidden = false;
  card.dataset.goal = p.goal || 'lose';
  const plan = computePlanData({ ...p, pace: p.paceKgWeek });
  const set = (id, text) => { const el = $(`#${id}`); if (el) el.textContent = text; };
  set('summary-goal', GOAL_LABELS[p.goal] || 'Цель');
  set('summary-height', `${trimNum(p.heightCm)} см`);
  set('summary-weight', `${trimNum(p.weightKg)} кг`);
  set('summary-target', `${trimNum(p.targetKg)} кг`);
  set('summary-pace', `${trimNum(p.paceKgWeek)} кг/нед`);
  set('summary-pace-sub', paceCaption(p.paceKgWeek));
  set('summary-activity', ACTIVITY_LABELS[p.activity] || '—');
  set('summary-date', plan.days > 0 ? fmtFullDate(plan.finish) : 'Уже достигнута');
  set('summary-kcal', `${plan.targetKcal.toLocaleString('ru-RU')} ккал/день`);
  set('summary-water', `${trimNum(plan.waterL)} л воды`);
  set('summary-note', `Калории: ${plan.targetKcal.toLocaleString('ru-RU')} ккал/день · Вода: ${trimNum(plan.waterL)} л/день`);
}
function renderProfile() {
  const authView = $('#auth-view'), profileView = $('#profile-view');
  if (!authView || !profileView) return;
  const user = currentUser();
  authView.hidden = Boolean(user);
  profileView.hidden = !user;
  if (user) {
    $('#user-name').textContent = user.name;
    $('#user-email').textContent = user.email;
    renderProfileSummary();
  } else {
    setAuthMode('login');
    $('#auth-name').value = ''; $('#auth-email').value = ''; $('#auth-pass').value = '';
  }
}
function initAuth() {
  if (!$('#auth-view') || !$('#profile-view')) return;
  $('#auth-login-btn').addEventListener('click', () => setAuthMode('login'));
  $('#auth-register-btn').addEventListener('click', () => setAuthMode('register'));
  $('#auth-submit').addEventListener('click', submitAuth);
  $('#auth-form')?.addEventListener('submit', submitAuth);
  $('#logout-btn').addEventListener('click', () => {
    clearSession(); switchScope(); renderProfile(); rerenderAll();
  });
  $('#goal-btn').addEventListener('click', wizardOpen);
  $('#summary-setup')?.addEventListener('click', wizardOpen);
  $('#summary-edit')?.addEventListener('click', wizardOpen);
  $('#theme-toggle')?.addEventListener('click', toggleTheme);
  renderProfile();
}

/* ==========================================================================
   11. МАСТЕР ЦЕЛИ + РАСЧЁТ ПЛАНА (офлайн)
   ========================================================================== */
const WIZARD_TOTAL = 9;
const WHEEL_ITEM_H = 56;
const WHEEL_VISIBLE = 5;
const KCAL_PER_KG = 7700;
const ACTIVITY_FACTORS = { sedentary: 1.2, light: 1.375, active: 1.55, training: 1.725 };
const WATER_ACTIVITY = { sedentary: 0, light: 0.15, active: 0.35, training: 0.5 };
const MONTHS_SHORT = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const wizardData = { goal: null, sex: null, birth: { day: 1, month: 1, year: 1999 }, height: 170, weight: 70, target: 65, activity: null, pace: 0.5 };
let wizardStep = 1, wheelsReady = false, lastPlan = null;
const wheels = new Map();
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const computeAge = (birth) => {
  const now = new Date();
  let age = now.getFullYear() - birth.year;
  const d = now.getMonth() + 1 - birth.month;
  if (d < 0 || (d === 0 && now.getDate() < birth.day)) age--;
  return clamp(age, 10, 100);
};
function computeEnergy(d) {
  const age = computeAge(d.birth);
  const bmr = d.sex === 'male'
    ? 10 * d.weightKg + 6.25 * d.heightCm - 5 * age + 5
    : 10 * d.weightKg + 6.25 * d.heightCm - 5 * age - 161;
  return { age, bmr, tdee: bmr * (ACTIVITY_FACTORS[d.activity] ?? 1.2) };
}
function computePlanData(d) {
  const diff = d.weightKg - d.targetKg;
  const direction = diff > 0.05 ? 'loss' : diff < -0.05 ? 'gain' : 'keep';
  const { tdee } = computeEnergy(d);
  const pace = d.pace || 0.5;
  const days = direction === 'keep' ? 0 : Math.round((Math.abs(diff) / pace) * 7);
  const start = new Date();
  const finish = new Date(start); finish.setDate(finish.getDate() + days);
  const delta = Math.round((pace * KCAL_PER_KG) / 7 / 10) * 10;
  const targetKcal = Math.max(0, Math.round((tdee + (direction === 'gain' ? delta : direction === 'loss' ? -delta : 0)) / 10) * 10);
  const waterL = +((d.weightKg * 0.03) + (WATER_ACTIVITY[d.activity] ?? 0)).toFixed(1);
  return { direction, tdee, pace, days, start, finish, delta, targetKcal, waterL };
}
const paceCaption = (v) => v <= 0.2 ? 'Надежно' : v <= 0.4 ? 'Умеренно' : v <= 0.6 ? 'Сбалансировано' : v <= 0.8 ? 'Заметно' : 'Быстро';

function createWheel(host, values, initial, format) {
  const viewport = document.createElement('div');
  viewport.className = 'wheel__viewport';
  viewport.tabIndex = 0;
  const pad = () => {
    const p = document.createElement('div');
    p.className = 'wheel__pad';
    p.style.height = `${(WHEEL_ITEM_H * (WHEEL_VISIBLE - 1)) / 2}px`;
    return p;
  };
  viewport.append(pad());
  values.forEach((value, i) => {
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'wheel__item';
    item.style.height = `${WHEEL_ITEM_H}px`;
    item.dataset.index = String(i);
    item.textContent = format ? format(value) : String(value);
    item.addEventListener('click', () => scrollToIndex(i));
    viewport.append(item);
  });
  viewport.append(pad());
  host.append(viewport);
  const wheel = { host, viewport, values, index: 0 };
  wheels.set(host.dataset.wheel, wheel);
  const isVisible = () => viewport.offsetParent !== null;
  function scrollToIndex(i, smooth = true) {
    wheel.index = clamp(i, 0, values.length - 1);
    viewport.scrollTo({ top: wheel.index * WHEEL_ITEM_H, behavior: smooth ? 'smooth' : 'auto' });
    paint();
  }
  function paint() {
    const center = viewport.scrollTop / WHEEL_ITEM_H;
    viewport.querySelectorAll('.wheel__item').forEach((el) => {
      const d = Math.abs(Number(el.dataset.index) - center);
      el.classList.toggle('is-active', d < .5);
      el.style.opacity = d < .5 ? '1' : d < 1.5 ? '.55' : '.3';
    });
  }
  let snapTimer = 0;
  viewport.addEventListener('scroll', () => {
    if (!isVisible()) return;
    paint();
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      if (!isVisible()) return;
      scrollToIndex(Math.round(viewport.scrollTop / WHEEL_ITEM_H));
    }, 120);
  }, { passive: true });
  let wheelAcc = 0, wheelLock = 0;
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    wheelAcc += e.deltaY * unit;
    if (Math.abs(wheelAcc) < 60) return;
    const now = performance.now();
    if (now - wheelLock < 60) return;
    wheelLock = now;
    const dir = wheelAcc > 0 ? 1 : -1;
    wheelAcc = 0;
    scrollToIndex(wheel.index + dir);
  }, { passive: false });
  viewport.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); scrollToIndex(wheel.index + 1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); scrollToIndex(wheel.index - 1); }
  });
  wheel.set = (v, smooth = false) => { const i = values.indexOf(v); scrollToIndex(i === -1 ? 0 : i, smooth); };
  wheel.get = () => values[wheel.index];
  wheel.read = () => {
    if (isVisible()) wheel.index = clamp(Math.round(viewport.scrollTop / WHEEL_ITEM_H), 0, values.length - 1);
    return values[wheel.index];
  };
  requestAnimationFrame(() => wheel.set(initial, false));
  return wheel;
}
function ensureWheels() {
  if (wheelsReady) return;
  wheelsReady = true;
  createWheel($('[data-wheel="b-day"]'), range(1, 31), wizardData.birth.day);
  createWheel($('[data-wheel="b-month"]'), range(1, 12), wizardData.birth.month, (v) => MONTHS_SHORT[v - 1]);
  createWheel($('[data-wheel="b-year"]'), range(1900, 2026), wizardData.birth.year);
  createWheel($('[data-wheel="h-int"]'), range(100, 220), Math.floor(wizardData.height));
  createWheel($('[data-wheel="h-dec"]'), range(0, 9), Math.round((wizardData.height % 1) * 10));
  createWheel($('[data-wheel="w-int"]'), range(30, 200), Math.floor(wizardData.weight));
  createWheel($('[data-wheel="w-dec"]'), range(0, 9), Math.round((wizardData.weight % 1) * 10));
  createWheel($('[data-wheel="t-int"]'), range(30, 200), Math.floor(wizardData.target));
  createWheel($('[data-wheel="t-dec"]'), range(0, 9), Math.round((wizardData.target % 1) * 10));
}
function captureStepWheels(step) {
  if (!wheelsReady) return;
  if (step === 3) {
    wizardData.birth = { day: wheels.get('b-day').read(), month: wheels.get('b-month').read(), year: wheels.get('b-year').read() };
  } else if (step === 4) {
    wizardData.height = wheels.get('h-int').read() + wheels.get('h-dec').read() / 10;
  } else if (step === 5) {
    wizardData.weight = wheels.get('w-int').read() + wheels.get('w-dec').read() / 10;
  } else if (step === 6) {
    wizardData.target = wheels.get('t-int').read() + wheels.get('t-dec').read() / 10;
  }
}
function syncStepWheels(step) {
  if (!wheelsReady) return;
  const apply = () => {
    if (step === 3) {
      wheels.get('b-day').set(wizardData.birth.day);
      wheels.get('b-month').set(wizardData.birth.month);
      wheels.get('b-year').set(wizardData.birth.year);
    } else if (step === 4) {
      wheels.get('h-int').set(Math.floor(wizardData.height));
      wheels.get('h-dec').set(Math.round((wizardData.height % 1) * 10));
    } else if (step === 5) {
      wheels.get('w-int').set(Math.floor(wizardData.weight));
      wheels.get('w-dec').set(Math.round((wizardData.weight % 1) * 10));
    } else if (step === 6) {
      wheels.get('t-int').set(Math.floor(wizardData.target));
      wheels.get('t-dec').set(Math.round((wizardData.target % 1) * 10));
    }
  };
  apply();
  requestAnimationFrame(apply);
}
function computePlan() {
  captureStepWheels(wizardStep);
  const draft = {
    sex: wizardData.sex || 'female', birth: { ...wizardData.birth },
    heightCm: wizardData.height, weightKg: wizardData.weight, targetKg: wizardData.target,
    activity: wizardData.activity, pace: wizardData.pace,
  };
  const plan = computePlanData(draft);
  return { ...plan, draft, current: draft.weightKg, target: draft.targetKg, diff: draft.weightKg - draft.targetKg };
}
function wizardGo(step) {
  captureStepWheels(wizardStep);
  wizardStep = step;
  $$('.wizard__step').forEach((s) => { s.hidden = Number(s.dataset.step) !== step; });
  const fill = $('#wizard-progress');
  if (fill) fill.style.width = `${(step / WIZARD_TOTAL) * 100}%`;
  syncStepWheels(step);
  if (step === 7) syncActivityPick();
  if (step === 8) updatePaceUI();
  if (step === WIZARD_TOTAL) renderResult();
}
const syncActivityPick = () => $$('.wizard__option[data-activity]').forEach((o) => o.classList.toggle('is-picked', o.dataset.activity === wizardData.activity));
function wizardOpen() {
  const root = $('#goal-wizard');
  if (!root) return;
  const p = state.profile;
  if (p) {
    wizardData.goal = p.goal ?? null; wizardData.sex = p.sex ?? null;
    if (p.birth) wizardData.birth = { ...p.birth };
    if (typeof p.heightCm === 'number') wizardData.height = p.heightCm;
    if (typeof p.weightKg === 'number') wizardData.weight = p.weightKg;
    if (typeof p.targetKg === 'number') wizardData.target = p.targetKg;
    if (p.activity) wizardData.activity = p.activity;
    if (typeof p.paceKgWeek === 'number') wizardData.pace = p.paceKgWeek;
  }
  root.hidden = false;
  document.body.classList.add('no-scroll');
  ensureWheels();
  wizardStep = 1;
  const slider = $('#pace-slider');
  if (slider) slider.value = String(wizardData.pace);
  updatePaceUI();
  wizardGo(1);
}
function wizardClose() {
  const root = $('#goal-wizard');
  if (!root) return;
  captureStepWheels(wizardStep);
  root.hidden = true;
  document.body.classList.remove('no-scroll');
}
function pushWeightRecord(kg) {
  const list = Array.isArray(state.weight) ? state.weight : [];
  const today = dateKey(0);
  const ex = list.find((r) => r.date === today);
  if (ex) { ex.kg = kg; ex.ts = Date.now(); } else list.unshift({ date: today, kg, ts: Date.now() });
  state.weight = list.slice(0, 365);
  saveJSON(dbKey(state.uid, 'weight'), state.weight);
}
function updatePaceUI() {
  const slider = $('#pace-slider'), value = $('#pace-value'), caption = $('#pace-caption');
  if (!slider) return;
  const v = Number(slider.value);
  if (value) value.textContent = `${v.toFixed(1).replace('.', ',')} кг/неделя`;
  if (caption) caption.textContent = paceCaption(v);
  const percent = ((v - 0.1) / 0.9) * 100;
  slider.style.background = `linear-gradient(90deg, #0a4b2c ${percent}%, #b9cdc4 ${percent}%)`;
}
function buildWeightSeries(current, target, pace, weeks) {
  let seed = (Math.round(current * 10) * 31 + Math.round(target * 10) * 17 + Math.round(pace * 100)) % 233280;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const pts = [current];
  let w = current;
  for (let i = 1; i < weeks; i++) {
    const base = (target - w) / (weeks - i + 1);
    let k = 0.5 + rnd();
    if (rnd() < 0.16) k = -0.35;
    w += base * k;
    pts.push(+w.toFixed(2));
  }
  pts.push(target);
  return pts;
}
function renderWeightChart(plan) {
  const chart = $('#wizard-chart');
  if (!chart) return;
  const weeks = Math.max(1, Math.round(plan.days / 7));
  const series = buildWeightSeries(plan.current, plan.target, plan.pace, weeks);
  const W = 600, H = 300, AX = 36, AY = 264, X0 = 50, X1 = 556, YT = 34, YB = 246;
  const wMax = Math.max(...series) + 0.6, wMin = Math.min(...series) - 0.6;
  const span = Math.max(0.5, wMax - wMin);
  const xOf = (i) => X0 + (i / (series.length - 1)) * (X1 - X0);
  const yOf = (w) => YT + ((wMax - w) / span) * (YB - YT);
  const stride = Math.max(1, Math.ceil(series.length / 26));
  const nodes = series.map((w, i) => ({ x: xOf(i), y: yOf(w) })).filter((_, i) => i % stride === 0 || i === series.length - 1);
  const path = nodes.map((n, i) => `${i ? 'L' : 'M'}${n.x.toFixed(1)} ${n.y.toFixed(1)}`).join(' ');
  const last = nodes[nodes.length - 1], prev = nodes[nodes.length - 2] || last;
  const ang = Math.atan2(last.y - prev.y, last.x - prev.x);
  const tipX = last.x + 16 * Math.cos(ang), tipY = last.y + 16 * Math.sin(ang);
  const arrow = `${tipX.toFixed(1)},${tipY.toFixed(1)} ${(tipX + 13 * Math.cos(ang + 2.6)).toFixed(1)},${(tipY + 13 * Math.sin(ang + 2.6)).toFixed(1)} ${(tipX + 13 * Math.cos(ang - 2.6)).toFixed(1)},${(tipY + 13 * Math.sin(ang - 2.6)).toFixed(1)}`;
  chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Прогноз изменения веса по неделям">
    <defs><filter id="wchart-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity="0.22"/></filter></defs>
    <line x1="${AX}" y1="18" x2="${AX}" y2="${AY}" class="wchart-axis"/>
    <line x1="${AX}" y1="${AY}" x2="584" y2="${AY}" class="wchart-axis"/>
    <path d="${path}" class="wchart-line"/>
    <polygon points="${arrow}" class="wchart-arrow"/>
  </svg>`;
}
function buildMonths(start, finish) {
  const list = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const end = new Date(finish.getFullYear(), finish.getMonth(), 1);
  while (cursor <= end) { list.push(MONTHS_SHORT[cursor.getMonth()]); cursor.setMonth(cursor.getMonth() + 1); }
  if (list.length === 1) list.push(MONTHS_SHORT[cursor.getMonth() % 12]);
  if (list.length > 8) {
    const step = Math.ceil(list.length / 8);
    const out = list.filter((_, i) => i % step === 0);
    if (out[out.length - 1] !== list[list.length - 1]) out.push(list[list.length - 1]);
    return out;
  }
  return list;
}
function renderResult() {
  const plan = computePlan();
  lastPlan = plan;
  const { target, direction, days, finish, delta, targetKcal, waterL } = plan;
  const weightEl = $('#wizard-result-weight');
  if (weightEl) weightEl.textContent = `${trimNum(target)} кг`;
  const planEl = $('#wizard-result-date');
  if (planEl) planEl.textContent = days > 0 ? `Вы достигнете своей цели к ${fmtFullDate(finish)}` : 'Цель достигнута — просто держим вес!';
  const kcalEl = $('#wizard-result-kcal');
  if (kcalEl) kcalEl.textContent = direction === 'keep'
    ? `Держим вес: ${targetKcal.toLocaleString('ru-RU')} ккал в день`
    : `Цель по калориям: ${targetKcal.toLocaleString('ru-RU')} ккал в день (${direction === 'loss' ? 'дефицит' : 'профицит'} ${delta.toLocaleString('ru-RU')} ккал)`;
  const waterEl = $('#wizard-result-water');
  if (waterEl) waterEl.textContent = `Вода для обмена веществ: ${trimNum(waterL)} л в день (30 мл/кг + активность)`;
  const noteEl = $('#wizard-result-note');
  if (noteEl) {
    const low = direction !== 'keep' && targetKcal > 0 && targetKcal < 1200;
    noteEl.hidden = !low;
    if (low) noteEl.textContent = 'Внимание: при таком темпе калорийность опускается ниже минимума ВОЗ (1200 ккал) — сверьтесь со специалистом.';
  }
  const months = $('#wizard-months');
  if (months) { months.innerHTML = buildMonths(plan.start, finish).map((m) => `<span>${m}</span>`).join(''); months.style.width = '100%'; }
  renderWeightChart(plan);
}
function wizardFinish() {
  const plan = computePlan();
  lastPlan = plan;
  const d = plan.draft;
  const profile = {
    goal: wizardData.goal, sex: wizardData.sex, birth: { ...d.birth },
    heightCm: d.heightCm, weightKg: d.weightKg, targetKg: d.targetKg,
    activity: wizardData.activity, paceKgWeek: wizardData.pace, updatedAt: Date.now(),
  };
  state.profile = profile;
  saveJSON(dbKey(state.uid, 'profile'), profile);
  pushWeightRecord(profile.weightKg);
  renderProfileSummary();
  wizardClose();
  openPlanModal(plan);
}
function openPlanModal(plan) {
  const modal = $('#plan-modal');
  if (!modal) return;
  $('#plan-kcal').textContent = plan.targetKcal.toLocaleString('ru-RU');
  $('#plan-water').textContent = trimNum(plan.waterL);
  const note = $('#plan-note');
  if (note) note.textContent = plan.direction === 'keep'
    ? `Норма поддержки ≈ ${Math.round(plan.tdee).toLocaleString('ru-RU')} ккал · вода: 30 мл/кг + активность`
    : `Норма ≈ ${Math.round(plan.tdee).toLocaleString('ru-RU')} ккал · ${plan.direction === 'loss' ? 'дефицит' : 'профицит'} ${plan.delta.toLocaleString('ru-RU')} ккал · вода: 30 мл/кг + активность`;
  modal.hidden = false; document.body.classList.add('no-scroll');
}
function applyPlan() {
  if (!lastPlan) return;
  state.goals = { ...state.goals, kcal: lastPlan.targetKcal, waterL: lastPlan.waterL };
  saveJSON(dbKey(state.uid, 'goals'), state.goals);
  const modal = $('#plan-modal');
  if (modal) modal.hidden = true;
  document.body.classList.remove('no-scroll');
  wizardClose(); rerenderAll(); renderProfileSummary();
  LOG('Цели обновлены: ккал', state.goals.kcal, '| вода', state.goals.waterL, 'л');
}
function initWizard() {
  const root = $('#goal-wizard');
  if (!root) return;
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-wizard-close]')) { wizardClose(); return; }
    const option = e.target.closest('.wizard__option');
    if (option) {
      if (option.dataset.goal) { wizardData.goal = option.dataset.goal; wizardGo(wizardStep + 1); return; }
      if (option.dataset.sex) { wizardData.sex = option.dataset.sex; wizardGo(wizardStep + 1); return; }
      if (option.dataset.activity) {
        wizardData.activity = option.dataset.activity;
        $$('.wizard__option[data-activity]', root).forEach((o) => o.classList.remove('is-picked'));
        option.classList.add('is-picked');
        setTimeout(() => wizardGo(wizardStep + 1), 280);
        return;
      }
    }
    if (e.target.closest('[data-wizard-next]')) { if (wizardStep < WIZARD_TOTAL) wizardGo(wizardStep + 1); return; }
    if (e.target.closest('[data-wizard-finish]')) wizardFinish();
  });
  $('#wizard-back')?.addEventListener('click', () => { if (wizardStep === 1) wizardClose(); else wizardGo(wizardStep - 1); });
  $('#pace-slider')?.addEventListener('input', (e) => { wizardData.pace = Number(e.target.value); updatePaceUI(); });
  $('#plan-ok')?.addEventListener('click', applyPlan);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) wizardClose(); });
}

/* ------------------ 12. САЙДБАР, СОБЫТИЯ, СИНХРОНИЗАЦИЯ ------------------ */
function initSidebar() {
  const sidebar = $('#sidebar'), backdrop = $('#sidebar-backdrop');
  if (!sidebar || !backdrop) return;
  const close = () => { sidebar.classList.remove('is-open'); backdrop.classList.remove('is-open'); };
  $('#sidebar-open')?.addEventListener('click', () => { sidebar.classList.add('is-open'); backdrop.classList.add('is-open'); });
  $('#sidebar-close')?.addEventListener('click', close);
  backdrop.addEventListener('click', close);
}
function initTodayDate() {
  const el = $('#today-date');
  if (el) el.textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
}
function initDiaryEvents() {
  $$('[data-meal-add]').forEach((btn) => btn.addEventListener('click', () => openModal(btn.dataset.mealAdd)));
  $$('.meal-card').forEach((card) => card.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    const index = Number(actionBtn.closest('.meal-item').dataset.index);
    const meal = card.dataset.meal;
    if (actionBtn.dataset.action === 'delete') deleteItem(meal, index);
    if (actionBtn.dataset.action === 'edit-weight') openWeightModal(meal, index);
  }));

  modalEl = $('#product-modal'); modalList = $('#modal-list');
  modalSearch = $('#modal-search-input'); modalSave = $('#modal-save');
  weightModal = $('#weight-modal'); weightInput = $('#weight-input');
  scanModal = $('#scan-modal'); confirmModal = $('#confirm-modal'); bcModal = $('#barcode-modal');

  if (modalEl) {
    modalEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-modal-close]')) { closeModal(); return; }
      const tab = e.target.closest('.modal__tab');
      if (tab) { switchTab(tab.dataset.tab); return; }
      const photoBtn = e.target.closest('[data-photo-pick]');
      if (photoBtn) { togglePhotoPick(photoBtn); return; }
      const itemBtn = e.target.closest('.modal__item-btn');
      if (itemBtn) toggleProduct(itemBtn);
    });
    modalSave.addEventListener('click', saveSelection);
    modalSearch.addEventListener('input', () => { state.modalQuery = modalSearch.value; renderModalList(); });
    $('#modal-search-clear')?.addEventListener('click', () => {
      modalSearch.value = ''; state.modalQuery = ''; renderModalList(); modalSearch.focus();
    });
  }
  if (weightModal) {
    weightModal.addEventListener('click', (e) => {
      if (e.target.closest('[data-weight-close]')) { closeWeightModal(); return; }
      const unitBtn = e.target.closest('.unit-switch__btn');
      if (unitBtn) setWeightUnit(unitBtn.dataset.unit);
    });
    weightInput.addEventListener('input', updateWeightHint);
    $('#weight-save')?.addEventListener('click', saveWeight);
  }

  /* Вода */
  $$('[data-water-add]').forEach((btn) => btn.addEventListener('click', () => {
    splashWater(btn);
    addWater(Number(btn.dataset.waterAdd));
  }));
  $('#water-log')?.addEventListener('click', (e) => {
    const del = e.target.closest('[data-water-del]');
    if (del) deleteWater(Number(del.dataset.waterDel));
  });

  /* Фото-сканер */
  $$('[data-meal-photo]').forEach((btn) => btn.addEventListener('click', () => openScan(btn.dataset.mealPhoto)));
  if (scanModal) {
    scanModal.addEventListener('click', (e) => { if (e.target.closest('[data-scan-close]')) closeScan(); });
    scanModal.addEventListener('dragover', (e) => e.preventDefault());
    scanModal.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) handleScanFile(f);
    });
    $('#scan-file').addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) handleScanFile(f);
    });
    $('#scan-drop').addEventListener('click', () => $('#scan-file').click());
    $('#scan-other-err').addEventListener('click', () => { setScanStage('pick'); $('#scan-file').click(); });
    $('#scan-retry').addEventListener('click', runScan);
  }

  /* Галерея */
  $('#photos-grid')?.addEventListener('click', (e) => {
    const del = e.target.closest('[data-photo-del]');
    if (del) { openConfirmDelete(del.dataset.photoDel); return; }
    const open = e.target.closest('[data-photo-open]');
    if (open) openScanView(open.dataset.photoOpen);
  });
  if (confirmModal) {
    confirmModal.addEventListener('click', (e) => { if (e.target.closest('[data-confirm-close]')) closeConfirmDelete(); });
    $('#confirm-ok')?.addEventListener('click', confirmDeletePhoto);
  }

  /* Штрихкоды */
  $$('[data-meal-barcode]').forEach((btn) => btn.addEventListener('click', () => openBarcode(btn.dataset.mealBarcode)));
  if (bcModal) {
    bcModal.addEventListener('click', (e) => { if (e.target.closest('[data-bc-close]')) closeBarcode(); });
    $('#bc-camera-on').addEventListener('click', startBcCamera);
    $('#bc-stop').addEventListener('click', () => { stopBcCamera(); setBcStatus('Камера выключена.', 'info'); });
    $('#bc-photo').addEventListener('click', () => $('#bc-file').click());
    $('#bc-file').addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) detectBarcodeFromImage(f);
    });
    $('#bc-form').addEventListener('submit', (e) => { e.preventDefault(); handleBarcode($('#bc-input').value); });
    $('#bc-again').addEventListener('click', () => {
      setBcStage('start'); setBcStatus('Введите или отсканируйте другой код.', 'info');
      $('#bc-input').value = ''; $('#bc-input').focus();
    });
    $('#bc-new-cancel').addEventListener('click', () => { setBcStage('start'); setBcStatus('Введите другой код.', 'info'); });
    $('#bc-units').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bc-unit]');
      if (btn) setBcUnit(btn.dataset.bcUnit);
    });
    $('#bc-minus').addEventListener('click', () => stepBc(-1));
    $('#bc-plus').addEventListener('click', () => stepBc(1));
    $('#bc-amount').addEventListener('input', renderBcTotal);
    $('#bc-add').addEventListener('click', bcAdd);
    $('#bc-new-add').addEventListener('click', bcNewAdd);
    $('#bc-saved').addEventListener('click', (e) => {
      const del = e.target.closest('[data-bc-del]');
      if (del) {
        const code = del.dataset.bcDel;
        state.barcodes = (state.barcodes || []).filter((b) => String(b.code) !== code);
        persistBarcodes(); rebuildBarcodes(); renderBcSaved();
        showToast('Товар удалён из базы');
        return;
      }
      const open = e.target.closest('[data-bc-open]');
      if (open) handleBarcode(open.dataset.bcOpen);
    });
  }

  $('#diary-prev')?.addEventListener('click', () => shiftDay(-1));
  $('#diary-next')?.addEventListener('click', () => shiftDay(1));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (confirmModal && !confirmModal.hidden) closeConfirmDelete();
    else if (bcModal && !bcModal.hidden) closeBarcode();
    else if (weightModal && !weightModal.hidden) closeWeightModal();
    else if (modalEl && !modalEl.hidden) closeModal();
    else if (scanModal && !scanModal.hidden) closeScan();
  });
}
window.addEventListener('pageshow', () => { applyTheme(getTheme()); switchScope(); renderProfile(); rerenderAll(); });
window.addEventListener('storage', () => { applyTheme(getTheme()); switchScope(); renderProfile(); rerenderAll(); });
window.addEventListener('pagehide', stopBcCamera);

/* Старт */
initSidebar();
initTodayDate();
initDiaryEvents();
initAuth();
initWizard();
rerenderAll();