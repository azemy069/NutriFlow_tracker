/* ==========================================================================
NUTRIFLOW — логика приложения (ВЕРСИЯ 7)
· Темп берётся ТОЧНО как выбрал пользователь (без ограничений).
· Дата цели выводится с годом — порядок шагов больше не путается.
· Вода: 30 мл на кг веса + добавка за активность (показывается в шаге 9 и в окне плана).
· Кнопка «ОК» переносит цель по ккал и воду в цели пользователя —
  кольцо дневника сразу показывает новую норму вместо 1800.
Базы (localStorage), раздельно по аккаунтам:
nutriflow.db.<uid>.diary.v1 / .history.v1 / .weight.v2 / .goals.v2 / .profile.v2
========================================================================== */
'use strict';

const APP_VERSION = '7.0';
const LOG = (...args) => console.log(
  `%c[NutriFlow v${APP_VERSION}]`,
  'color:#0e7d72;font-weight:bold',
  ...args
);

/* ------------------ 1. УТИЛИТЫ И ДАТЫ ------------------ */
const $  = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const loadJSON = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const saveJSON = (key, value) => localStorage.setItem(key, JSON.stringify(value));

const GOALS = { kcal: 1800, p: 120, f: 70, c: 200 };
const RING_LENGTH = 327;
const MEALS = [{ key: 'breakfast' }, { key: 'lunch' }, { key: 'dinner' }, { key: 'snack' }];
const HISTORY_LIMIT = 20;

const SAFE_PRODUCTS = typeof PRODUCTS_DB !== 'undefined' && Array.isArray(PRODUCTS_DB) ? PRODUCTS_DB : [];
const PRODUCT_MAP = new Map(SAFE_PRODUCTS.map((product) => [product.id, product]));

const calcPortion = (product, weight) => {
  const k = weight / 100;
  return {
    kcal: Math.round(product.kcal * k),
    p: +(product.p * k).toFixed(1),
    f: +(product.f * k).toFixed(1),
    c: +(product.c * k).toFixed(1),
  };
};

const fmtDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const dateKey = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return fmtDate(d);
};

const parseKey = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const dateTitle = (key) => {
  const plain = parseKey(key).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  if (key === dateKey(0))  return `Сегодня, ${plain}`;
  if (key === dateKey(-1)) return `Вчера, ${plain}`;
  if (key === dateKey(1))  return `Завтра, ${plain}`;
  return parseKey(key).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
};

/* ------------------ 2. БАЗЫ ДАННЫХ И СЕССИЯ ------------------ */
const DB_USERS   = 'nutriflow.db.users.v2';
const DB_SESSION = 'nutriflow.db.session.v2';
const dbKey = (uid, domain) => `nutriflow.db.${uid}.${domain}.v2`;

const loadUsers    = () => loadJSON(DB_USERS, []);
const setSession   = (id) => saveJSON(DB_SESSION, id);
const clearSession = () => localStorage.removeItem(DB_SESSION);

const currentUser = () => {
  const id = loadJSON(DB_SESSION, null);
  if (!id) return null;
  return loadUsers().find((u) => u.id === id) || null;
};

const scopeUid = () => {
  const user = currentUser();
  return user ? user.id : 'guest';
};

const generateUid = (email) => {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash << 5) - hash + email.charCodeAt(i);
    hash |= 0;
  }
  const randomSuffix = Math.random().toString(36).slice(2, 7);
  return `u_${Math.abs(hash).toString(36)}_${randomSuffix}`;
};

function registerUser(name, email, password) {
  const users = loadUsers();
  const clean = email.toLowerCase().trim();
  if (users.some((u) => u.email === clean)) {
    return { error: 'Пользователь с такой почтой уже зарегистрирован — попробуйте войти.' };
  }
  const user = { id: generateUid(clean), name: name.trim(), email: clean, password };
  users.push(user);
  saveJSON(DB_USERS, users);
  saveJSON(dbKey(user.id, 'diary'), {});
  saveJSON(dbKey(user.id, 'history'), []);
  saveJSON(dbKey(user.id, 'weight'), []);
  saveJSON(dbKey(user.id, 'goals'), { ...GOALS });
  setSession(user.id);
  LOG('Зарегистрирован новый пользователь:', user.email, '| uid =', user.id);
  return { user };
}

function loginUser(email, password) {
  const clean = email.toLowerCase().trim();
  const user = loadUsers().find((u) => u.email === clean);
  if (!user || user.password !== password) {
    return { error: 'Неверная почта или пароль. Проверьте ввод и попробуйте ещё раз.' };
  }
  setSession(user.id);
  LOG('Вход выполнен:', user.email, '| uid =', user.id);
  return { user };
}

/* ------------------ 3. ОБЛАСТЬ ДАННЫХ ПОЛЬЗОВАТЕЛЯ ------------------ */
function loadScope(uid) {
  const diary = loadJSON(dbKey(uid, 'diary'), {});
  return {
    diary:   diary && typeof diary === 'object' ? diary : {},
    history: loadJSON(dbKey(uid, 'history'), []),
    weight:  loadJSON(dbKey(uid, 'weight'), []),
    goals:   loadJSON(dbKey(uid, 'goals'), null) || { ...GOALS },
    profile: loadJSON(dbKey(uid, 'profile'), null),
  };
}

/* ------------------ 4. СОСТОЯНИЕ ------------------ */
const state = {
  uid: scopeUid(),
  date: dateKey(0),
  dayOffset: 0,
  diary: {},
  history: [],
  weight: [],
  goals: { ...GOALS },
  profile: null,
  modalMeal: null,
  modalTab: 'search',
  modalQuery: '',
  selected: new Map(),
  weightTarget: null,
};

function switchScope() {
  const newUid = scopeUid();
  const scope = loadScope(newUid);
  state.uid          = newUid;
  state.date         = dateKey(state.dayOffset);
  state.diary        = scope.diary;
  state.history      = scope.history;
  state.weight       = scope.weight;
  state.goals        = scope.goals;
  state.profile      = scope.profile;
  state.modalMeal    = null;
  state.modalQuery   = '';
  state.selected.clear();
  state.weightTarget = null;
  renderUserBadge();
  LOG('Активный профиль:', newUid, '| Ключ БД:', dbKey(newUid, 'diary'));
}

function renderUserBadge() {
  const foot = $('.sidebar__foot');
  if (!foot) return;
  let badge = $('#sidebar-user-badge');
  if (!badge) {
    badge = document.createElement('a');
    badge.id = 'sidebar-user-badge';
    badge.href = 'profile.html';
    badge.className = 'sidebar__note';
    badge.style.fontWeight = '700';
    badge.style.color = 'var(--clr-teal-deep)';
    foot.prepend(badge);
  }
  const user = currentUser();
  badge.textContent = user
    ? `Аккаунт: ${user.name} (${user.email})`
    : 'Режим: Гость (войти в профиль)';
}

switchScope();

const dayEntries = () => {
  if (!state.diary[state.date]) {
    state.diary[state.date] = { breakfast: [], lunch: [], dinner: [], snack: [] };
  }
  return state.diary[state.date];
};

const persistDiary = () => {
  state.uid = scopeUid();
  const key = dbKey(state.uid, 'diary');
  saveJSON(key, state.diary);
  LOG('Дневник сохранён →', key);
};

const persistHistory = () => {
  state.uid = scopeUid();
  saveJSON(dbKey(state.uid, 'history'), state.history);
};

function rerenderAll() {
  renderUserBadge();
  renderDate();
  renderMeals();
  renderSummary();
}

/* ------------------ 5. СВОДКА ДНЯ ------------------ */
function dayTotals() {
  const totals = { kcal: 0, p: 0, f: 0, c: 0 };
  const day = dayEntries();
  MEALS.forEach(({ key }) => {
    (day[key] || []).forEach(({ id, weight }) => {
      const product = PRODUCT_MAP.get(id);
      if (!product) return;
      const portion = calcPortion(product, weight);
      totals.kcal += portion.kcal;
      totals.p += portion.p;
      totals.f += portion.f;
      totals.c += portion.c;
    });
  });
  totals.p = Math.round(totals.p);
  totals.f = Math.round(totals.f);
  totals.c = Math.round(totals.c);
  return totals;
}

function renderSummary() {
  const totals = dayTotals();
  const goals = state.goals || GOALS;
  const ring  = $('#ring-progress');
  const value = $('#ring-value');
  const goalLabel = $('#ring-goal');

  if (ring && value) {
    const ratio = Math.min(totals.kcal / goals.kcal, 1);
    ring.style.strokeDashoffset = String(Math.round(RING_LENGTH * (1 - ratio)));
    ring.classList.toggle('is-over', totals.kcal > goals.kcal);
    value.textContent = totals.kcal.toLocaleString('ru-RU');
  }
  if (goalLabel) goalLabel.textContent = `из ${goals.kcal} ккал`;

  [['protein', totals.p, goals.p], ['fat', totals.f, goals.f], ['carb', totals.c, goals.c]]
    .forEach(([key, fact, goal]) => {
      const bar   = $(`[data-macro-bar="${key}"]`);
      const label = $(`[data-macro-value="${key}"]`);
      if (bar)   bar.style.width = `${Math.min((fact / goal) * 100, 100)}%`;
      if (label) label.textContent = `${fact} / ${goal} г`;
    });
}

const renderDate = () => {
  const el = $('#diary-date');
  if (el) el.textContent = dateTitle(state.date);
};

/* ------------------ 6. РЕНДЕР ПРИЁМОВ ПИЩИ ------------------ */
function mealItemTemplate(item, index) {
  const product = PRODUCT_MAP.get(item.id);
  if (!product) return '';
  const portion = calcPortion(product, item.weight);
  return `<li class="meal-item" data-index="${index}">
    <span class="meal-item__name">${product.name}</span>
    <button class="meal-item__weight" data-action="edit-weight"
      title="Нажмите, чтобы изменить граммовку">${item.weight} г</button>
    <span class="meal-item__cals">${portion.kcal} ккал</span>
    <button class="meal-item__delete" data-action="delete" aria-label="Удалить «${product.name}»">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
      </svg>
    </button>
  </li>`;
}

function renderMeals() {
  const day = dayEntries();
  MEALS.forEach(({ key }) => {
    const list  = $(`[data-meal-list="${key}"]`);
    const total = $(`[data-meal-total="${key}"]`);
    if (!list) return;
    const items = day[key] || [];
    list.innerHTML = items.length
      ? items.map(mealItemTemplate).join('')
      : '<li class="meal-card__empty">Пока ничего не добавлено</li>';
    if (total) {
      const kcal = items.reduce((sum, item) => {
        const product = PRODUCT_MAP.get(item.id);
        return product ? sum + calcPortion(product, item.weight).kcal : sum;
      }, 0);
      total.textContent = `${kcal} ккал`;
    }
  });
}

/* ------------------ 7. ОКНО ВЫБОРА ПРОДУКТОВ ------------------ */
let modalEl = null, modalList = null, modalSearch = null, modalSave = null;

function openModal(mealKey) {
  if (!modalEl) return;
  state.modalMeal  = mealKey;
  state.modalQuery = '';
  state.selected.clear();
  modalSearch.value = '';
  modalEl.hidden = false;
  document.body.classList.add('no-scroll');
  switchTab('search');
  updateSaveBtn();
  modalSearch.focus();
}

function closeModal() {
  if (!modalEl) return;
  modalEl.hidden = true;
  document.body.classList.remove('no-scroll');
  state.modalMeal = null;
}

function switchTab(tab) {
  state.modalTab = tab;
  $$('.modal__tab').forEach((btn) => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  const wrap = $('#modal-search-wrap');
  if (wrap) wrap.hidden = tab !== 'search';
  renderModalList();
}

function rowTemplate(product, lastWeight) {
  const isSelected = state.selected.has(product.id);
  return `<li class="modal__item">
    <button class="modal__item-btn ${isSelected ? 'is-selected' : ''}"
      data-product="${product.id}" data-last="${lastWeight ?? ''}">
      <span class="modal__item-name">${product.name}</span>
      ${lastWeight ? `<span class="modal__item-last">последний раз ${lastWeight} г</span>` : ''}
      <span class="modal__item-kcal">${product.kcal} ккал</span>
      <span class="modal__item-check" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>
      </span>
    </button>
  </li>`;
}

function renderModalList() {
  if (!modalList) return;
  const rows = state.modalTab === 'search' ? searchRows() : recentRows();
  modalList.innerHTML = rows.length
    ? rows.join('')
    : '<li class="modal__empty">Ничего не найдено — попробуйте другой запрос</li>';
}

function searchRows() {
  const query = state.modalQuery.trim().toLowerCase();
  const source = query
    ? SAFE_PRODUCTS.filter((p) => p.name.toLowerCase().includes(query))
    : SAFE_PRODUCTS;
  return source.map((p) => rowTemplate(p, null));
}

function recentRows() {
  return state.history
    .map((record) => {
      const product = PRODUCT_MAP.get(record.id);
      return product ? rowTemplate(product, record.weight) : '';
    })
    .filter(Boolean);
}

function toggleProduct(btn) {
  const id = btn.dataset.product;
  if (state.selected.has(id)) {
    state.selected.delete(id);
    btn.classList.remove('is-selected');
  } else {
    const last = Number(btn.dataset.last);
    state.selected.set(id, last > 0 ? last : 100);
    btn.classList.add('is-selected');
  }
  updateSaveBtn();
}

function updateSaveBtn() {
  if (!modalSave) return;
  const count = state.selected.size;
  modalSave.textContent = count > 0 ? `Сохранить (${count})` : 'Сохранить';
  modalSave.disabled = count === 0;
}

function saveSelection() {
  const target = dayEntries()[state.modalMeal];
  state.selected.forEach((weight, id) => {
    target.push({ id, weight });
    pushHistory(id, weight);
  });
  persistDiary();
  renderMeals();
  renderSummary();
  closeModal();
}

function pushHistory(id, weight) {
  state.history = state.history.filter((r) => r.id !== id);
  state.history.unshift({ id, weight, ts: Date.now() });
  state.history = state.history.slice(0, HISTORY_LIMIT);
  persistHistory();
}

/* ------------------ 8. ГРАММОВКА И УДАЛЕНИЕ ------------------ */
let weightModal = null, weightInput = null;

function openWeightModal(mealKey, index) {
  if (!weightModal) return;
  const item = dayEntries()[mealKey][index];
  const product = PRODUCT_MAP.get(item.id);
  if (!product) return;
  state.weightTarget = { meal: mealKey, index };
  $('#weight-name').textContent = product.name;
  weightInput.value = item.weight;
  updateWeightHint();
  weightModal.hidden = false;
  document.body.classList.add('no-scroll');
  weightInput.focus();
  weightInput.select();
}

function closeWeightModal() {
  if (!weightModal) return;
  weightModal.hidden = true;
  document.body.classList.remove('no-scroll');
  state.weightTarget = null;
}

function updateWeightHint() {
  if (!state.weightTarget || !weightInput) return;
  const item = dayEntries()[state.weightTarget.meal][state.weightTarget.index];
  const product = PRODUCT_MAP.get(item.id);
  if (!product) return;
  const weight = Math.max(Number(weightInput.value) || 0, 0);
  $('#weight-kcal').textContent = `${calcPortion(product, weight).kcal} ккал`;
}

function saveWeight() {
  if (!state.weightTarget) return;
  const weight = Math.min(Math.max(Math.round(Number(weightInput.value) || 0), 0), 5000);
  const item = dayEntries()[state.weightTarget.meal][state.weightTarget.index];
  if (weight > 0) {
    item.weight = weight;
    pushHistory(item.id, weight);
  }
  persistDiary();
  renderMeals();
  renderSummary();
  closeWeightModal();
}

function deleteItem(mealKey, index) {
  dayEntries()[mealKey].splice(index, 1);
  persistDiary();
  renderMeals();
  renderSummary();
}

/* ------------------ 9. НАВИГАЦИЯ ПО ДНЯМ ------------------ */
function shiftDay(delta) {
  state.dayOffset += delta;
  state.date = dateKey(state.dayOffset);
  renderDate();
  renderMeals();
  renderSummary();
}

/* ------------------ 10. АВТОРИЗАЦИЯ И ПРОФИЛЬ ------------------ */
let authMode = null;

function setAuthMode(mode) {
  authMode = mode;
  const form = $('#auth-form');
  if (!form) return;
  $('#auth-login-btn').classList.toggle('is-active', mode === 'login');
  $('#auth-register-btn').classList.toggle('is-active', mode === 'register');
  form.hidden = (mode === null);
  $('#auth-name-field').hidden = (mode !== 'register');
  $('#auth-error').hidden = true;
  const submit = $('#auth-submit');
  if (mode === 'login') {
    submit.textContent = 'Войти';
    submit.className = 'btn btn--ghost auth__submit';
  } else if (mode === 'register') {
    submit.textContent = 'Создать аккаунт';
    submit.className = 'btn btn--primary auth__submit';
  }
}

function submitAuth(event) {
  if (event) event.preventDefault();
  const errorBox = $('#auth-error');
  errorBox.hidden = true;
  const fail = (text) => { errorBox.textContent = text; errorBox.hidden = false; };
  const email = $('#auth-email').value.trim();
  const password = $('#auth-pass').value;
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
  switchScope();
  renderProfile();
  rerenderAll();
}

function renderProfile() {
  const authView = $('#auth-view');
  const profileView = $('#profile-view');
  if (!authView || !profileView) return;

  const user = currentUser();
  authView.hidden = Boolean(user);
  profileView.hidden = !user;

  if (user) {
    $('#user-name').textContent = user.name;
    $('#user-email').textContent = user.email;
  } else {
    setAuthMode('login');
    $('#auth-name').value = '';
    $('#auth-email').value = '';
    $('#auth-pass').value = '';
  }
}

function initAuth() {
  const authView = $('#auth-view');
  const profileView = $('#profile-view');
  if (!authView || !profileView) return;

  $('#auth-login-btn').addEventListener('click', () => setAuthMode('login'));
  $('#auth-register-btn').addEventListener('click', () => setAuthMode('register'));
  $('#auth-submit').addEventListener('click', submitAuth);
  $('#auth-form')?.addEventListener('submit', submitAuth);

  $('#logout-btn').addEventListener('click', () => {
    clearSession();
    switchScope();
    renderProfile();
    rerenderAll();
    LOG('Выход из аккаунта выполнен.');
  });

  $('#goal-btn').addEventListener('click', wizardOpen);

  renderProfile();
}

/* ==========================================================================
   11. МАСТЕР ЦЕЛИ: 9 ШАГОВ + РАСЧЁТ ПЛАНА (офлайн)
   Темп берётся ТОЧНО как выбрал пользователь: 1 кг/нед = 1 кг/нед.
   Недели = |разница весов| ÷ темп; дата = сегодня + недели × 7 (с годом).
   Калории: TDEE (Миффлин–Сан-Жеор × активность) ± дефицит темпа (1 кг ≈ 7700 ккал).
   Вода: 30 мл/кг + добавка за активность.
   ========================================================================== */
const WIZARD_TOTAL = 9;
const WHEEL_ITEM_H = 56;
const WHEEL_VISIBLE = 5;
const KCAL_PER_KG = 7700;
const ACTIVITY_FACTORS = { sedentary: 1.2, light: 1.375, active: 1.55, training: 1.725 };
const WATER_ACTIVITY = { sedentary: 0, light: 0.15, active: 0.35, training: 0.5 };
const MONTHS_SHORT = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь',
                      'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

const wizardData = {
  goal: null,
  sex: null,
  birth: { day: 1, month: 1, year: 2000 },
  height: 170,
  weight: 70,
  target: 65,
  activity: null,
  pace: 0.5,
};

let wizardStep = 1;
let wheelsReady = false;
const wheels = new Map();

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const computeAge = (birth) => {
  const now = new Date();
  let age = now.getFullYear() - birth.year;
  const delta = now.getMonth() + 1 - birth.month;
  if (delta < 0 || (delta === 0 && now.getDate() < birth.day)) age--;
  return Math.max(10, Math.min(100, age));
};

function computeEnergy(data) {
  const age = computeAge(data.birth);
  const bmr = data.sex === 'male'
    ? 10 * data.weightKg + 6.25 * data.heightCm - 5 * age + 5
    : 10 * data.weightKg + 6.25 * data.heightCm - 5 * age - 161;
  const tdee = bmr * (ACTIVITY_FACTORS[data.activity] ?? 1.2);
  return { age, bmr, tdee };
}

/* Плавная кривая через точки: Catmull-Rom → Безье */
const smoothPath = (pts) => {
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    d += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)} ${(p1.y + (p2.y - p0.y) / 6).toFixed(1)},`
       + ` ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)} ${(p2.y - (p3.y - p1.y) / 6).toFixed(1)},`
       + ` ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
};

/* Месяцы с текущего по месяц цели; последний месяц всегда виден */
function buildMonths(start, finish) {
  const list = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const end = new Date(finish.getFullYear(), finish.getMonth(), 1);
  while (cursor <= end) {
    list.push(MONTHS_SHORT[cursor.getMonth()]);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  if (list.length === 1) list.push(MONTHS_SHORT[cursor.getMonth() % 12]);
  if (list.length > 8) {
    const step = Math.ceil(list.length / 8);
    const out = list.filter((_, i) => i % step === 0);
    if (out[out.length - 1] !== list[list.length - 1]) out.push(list[list.length - 1]);
    return out;
  }
  return list;
}

/* ---------- Колесо выбора ---------- */
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
    item.type = 'button';
    item.className = 'wheel__item';
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

  function scrollToIndex(i, smooth = true) {
    wheel.index = Math.max(0, Math.min(values.length - 1, i));
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
    paint();
    clearTimeout(snapTimer);
    snapTimer = setTimeout(
      () => scrollToIndex(Math.round(viewport.scrollTop / WHEEL_ITEM_H)),
      120
    );
  }, { passive: true });

  /* 1 событие колеса = ровно 1 шаг (без перескоков через значения) */
  let wheelAcc = 0;
  let wheelLock = 0;
  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1;
    wheelAcc += event.deltaY * unit;
    const STEP_PX = 60;
    if (Math.abs(wheelAcc) < STEP_PX) return;
    const now = performance.now();
    if (now - wheelLock < 60) return;
    wheelLock = now;
    const dir = wheelAcc > 0 ? 1 : -1;
    wheelAcc = 0;
    scrollToIndex(wheel.index + dir);
  }, { passive: false });

  viewport.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); scrollToIndex(wheel.index + 1); }
    if (event.key === 'ArrowUp')   { event.preventDefault(); scrollToIndex(wheel.index - 1); }
  });

  wheel.set = (value, smooth = false) => {
    const idx = values.indexOf(value);
    scrollToIndex(idx === -1 ? 0 : idx, smooth);
  };
  wheel.get = () => values[wheel.index];

  requestAnimationFrame(() => wheel.set(initial, false));
  return wheel;
}

function ensureWheels() {
  if (wheelsReady) return;
  wheelsReady = true;
  createWheel($('[data-wheel="b-day"]'),   range(1, 31),      wizardData.birth.day);
  createWheel($('[data-wheel="b-month"]'), range(1, 12),      wizardData.birth.month, (v) => MONTHS_SHORT[v - 1]);
  createWheel($('[data-wheel="b-year"]'),  range(1900, 2026), wizardData.birth.year);
  createWheel($('[data-wheel="h-int"]'),   range(100, 220),   Math.floor(wizardData.height));
  createWheel($('[data-wheel="h-dec"]'),   range(0, 9),       Math.round((wizardData.height % 1) * 10));
  createWheel($('[data-wheel="w-int"]'),   range(30, 200),    Math.floor(wizardData.weight));
  createWheel($('[data-wheel="w-dec"]'),   range(0, 9),       Math.round((wizardData.weight % 1) * 10));
  createWheel($('[data-wheel="t-int"]'),   range(30, 200),    Math.floor(wizardData.target));
  createWheel($('[data-wheel="t-dec"]'),   range(0, 9),       Math.round((wizardData.target % 1) * 10));
}

function syncWheels() {
  if (!wheelsReady) return;
  wheels.get('b-day').set(wizardData.birth.day);
  wheels.get('b-month').set(wizardData.birth.month);
  wheels.get('b-year').set(wizardData.birth.year);
  wheels.get('h-int').set(Math.floor(wizardData.height));
  wheels.get('h-dec').set(Math.round((wizardData.height % 1) * 10));
  wheels.get('w-int').set(Math.floor(wizardData.weight));
  wheels.get('w-dec').set(Math.round((wizardData.weight % 1) * 10));
  wheels.get('t-int').set(Math.floor(wizardData.target));
  wheels.get('t-dec').set(Math.round((wizardData.target % 1) * 10));
}

const readWheels = () => ({
  birth:    { day: wheels.get('b-day').get(), month: wheels.get('b-month').get(), year: wheels.get('b-year').get() },
  heightCm: wheels.get('h-int').get() + wheels.get('h-dec').get() / 10,
  weightKg: wheels.get('w-int').get() + wheels.get('w-dec').get() / 10,
  targetKg: wheels.get('t-int').get() + wheels.get('t-dec').get() / 10,
});

/* ---------- Единый расчёт плана: БЕЗ изменения выбора пользователя ---------- */
function computePlan() {
  const rw = readWheels();
  const current = rw.weightKg;
  const target  = rw.targetKg;
  const diff = current - target;
  const direction = diff > 0.05 ? 'loss' : diff < -0.05 ? 'gain' : 'keep';
  const sex = wizardData.sex || 'female';

  const { tdee } = computeEnergy({
    sex, birth: rw.birth, heightCm: rw.heightCm,
    weightKg: current, activity: wizardData.activity,
  });

  /* Темп — ровно тот, что выбрал пользователь */
  const pace = wizardData.pace || 0.5;

  /* Недели = кг ÷ темп; дата = сегодня + недели × 7 */
  const days = direction === 'keep' ? 0 : Math.round((Math.abs(diff) / pace) * 7);
  const start  = new Date();
  const finish = new Date(start);
  finish.setDate(finish.getDate() + days);

  const delta = Math.round((pace * KCAL_PER_KG) / 7 / 10) * 10;
  const targetKcal = Math.max(0, Math.round(
    (tdee + (direction === 'gain' ? delta : direction === 'loss' ? -delta : 0)) / 10
  ) * 10);

  const waterL = +((current * 0.03) + (WATER_ACTIVITY[wizardData.activity] ?? 0)).toFixed(1);

  return { rw, current, target, diff, direction, tdee, pace,
           days, start, finish, delta, targetKcal, waterL };
}

let lastPlan = null;

function wizardGo(step) {
  wizardStep = step;
  $$('.wizard__step').forEach((section) => {
    section.hidden = Number(section.dataset.step) !== step;
  });
  const fill = $('#wizard-progress');
  if (fill) fill.style.width = `${(step / WIZARD_TOTAL) * 100}%`;
  if (step === 7) syncActivityPick();
  if (step === 8) updatePaceUI();
  if (step === WIZARD_TOTAL) renderResult();
}

const syncActivityPick = () => {
  $$('.wizard__option[data-activity]').forEach((o) => {
    o.classList.toggle('is-picked', o.dataset.activity === wizardData.activity);
  });
};

function wizardOpen() {
  const root = $('#goal-wizard');
  if (!root) return;

  const p = state.profile;
  if (p) {
    wizardData.goal = p.goal ?? null;
    wizardData.sex  = p.sex ?? null;
    if (p.birth) wizardData.birth = { ...p.birth };
    if (typeof p.heightCm === 'number')   wizardData.height = p.heightCm;
    if (typeof p.weightKg === 'number')   wizardData.weight = p.weightKg;
    if (typeof p.targetKg === 'number')   wizardData.target = p.targetKg;
    if (p.activity)                       wizardData.activity = p.activity;
    if (typeof p.paceKgWeek === 'number') wizardData.pace = p.paceKgWeek;
  }

  ensureWheels();
  syncWheels();
  const slider = $('#pace-slider');
  if (slider) slider.value = String(wizardData.pace);
  updatePaceUI();

  root.hidden = false;
  document.body.classList.add('no-scroll');
  wizardGo(1);
  LOG('Мастер цели открыт для:', state.uid);
}

function wizardClose() {
  const root = $('#goal-wizard');
  if (!root) return;
  root.hidden = true;
  document.body.classList.remove('no-scroll');
}

function pushWeightRecord(kg) {
  const list = Array.isArray(state.weight) ? state.weight : [];
  const today = dateKey(0);
  const existing = list.find((record) => record.date === today);
  if (existing) {
    existing.kg = kg;
    existing.ts = Date.now();
  } else {
    list.unshift({ date: today, kg, ts: Date.now() });
  }
  state.weight = list.slice(0, 365);
  saveJSON(dbKey(state.uid, 'weight'), state.weight);
  LOG('Запись веса сохранена →', dbKey(state.uid, 'weight'));
}

/* ---------- Слайдер темпа ---------- */
const trimNum = (n) => {
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s.replace('.', ',');
};

const paceCaption = (v) => {
  if (v <= 0.2) return 'Надежно';
  if (v <= 0.4) return 'Умеренно';
  if (v <= 0.6) return 'Сбалансировано';
  if (v <= 0.8) return 'Заметно';
  return 'Быстро';
};

function updatePaceUI() {
  const slider  = $('#pace-slider');
  const value   = $('#pace-value');
  const caption = $('#pace-caption');
  if (!slider) return;
  const v = Number(slider.value);
  if (value)   value.textContent = `${v.toFixed(1).replace('.', ',')} кг/неделя`;
  if (caption) caption.textContent = paceCaption(v);
  const percent = ((v - 0.1) / 0.9) * 100;
  slider.style.background =
    `linear-gradient(90deg, #0a4b2c ${percent}%, #b9cdc4 ${percent}%)`;
}

/* ---------- Шаг 9: итоговый экран ---------- */

/* Недельный ряд веса: в среднем за неделю — ровно темп пользователя,
   но с живыми колебаниями (плато и небольшие «откаты»), как в реальности.
   Ряд детерминированный: при тех же данных график не «прыгает». */
function buildWeightSeries(current, target, pace, weeks) {
  let seed = (Math.round(current * 10) * 31 + Math.round(target * 10) * 17 + Math.round(pace * 100)) % 233280;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const pts = [current];
  let w = current;
  for (let i = 1; i < weeks; i++) {
    const base = (target - w) / (weeks - i + 1);   // равномерный шаг до финиша
    let k = 0.5 + rnd();                            // 0.5–1.5 от шага
    if (rnd() < 0.16) k = -0.35;                    // неделя-«откат»
    w += base * k;
    pts.push(+w.toFixed(2));
  }
  pts.push(target);                                 // финиш точно в целевом весе
  return pts;
}

/* Тонкий «живой» график с осями и стрелкой, как в референсе */
function renderWeightChart(plan) {
  const chart = $('#wizard-chart');
  if (!chart) return;
  const { current, target, pace, days } = plan;
  const weeks = Math.max(1, Math.round(days / 7));
  const series = buildWeightSeries(current, target, pace, weeks);

  const W = 600, H = 300;
  const AX = 36, AY = 264;                          // угол осей
  const X0 = 50, X1 = 556, YT = 34, YB = 246;       // область данных

  const wMax = Math.max(...series) + 0.6;
  const wMin = Math.min(...series) - 0.6;
  const span = Math.max(0.5, wMax - wMin);
  const xOf = (i) => X0 + (i / (series.length - 1)) * (X1 - X0);
  const yOf = (w) => YT + ((wMax - w) / span) * (YB - YT);

  /* Не более ~26 узлов на линию, чтобы график читался */
  const stride = Math.max(1, Math.ceil(series.length / 26));
  const nodes = series
    .map((w, i) => ({ x: xOf(i), y: yOf(w) }))
    .filter((_, i) => i % stride === 0 || i === series.length - 1);

  const path = nodes.map((n, i) => `${i ? 'L' : 'M'}${n.x.toFixed(1)} ${n.y.toFixed(1)}`).join(' ');
  const last = nodes[nodes.length - 1];
  const prev = nodes[nodes.length - 2] || last;
  const ang = Math.atan2(last.y - prev.y, last.x - prev.x);
  const tipX = last.x + 16 * Math.cos(ang);
  const tipY = last.y + 16 * Math.sin(ang);
  const arrow = `${tipX.toFixed(1)},${tipY.toFixed(1)} ` +
    `${(tipX + 13 * Math.cos(ang + 2.6)).toFixed(1)},${(tipY + 13 * Math.sin(ang + 2.6)).toFixed(1)} ` +
    `${(tipX + 13 * Math.cos(ang - 2.6)).toFixed(1)},${(tipY + 13 * Math.sin(ang - 2.6)).toFixed(1)}`;

  chart.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Прогноз изменения веса по неделям">
      <defs>
        <filter id="wchart-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.22"/>
        </filter>
      </defs>
      <line x1="${AX}" y1="18" x2="${AX}" y2="${AY}" class="wchart-axis"/>
      <line x1="${AX}" y1="${AY}" x2="584" y2="${AY}" class="wchart-axis"/>
      <path d="${path}" class="wchart-line"/>
      <polygon points="${arrow}" class="wchart-arrow"/>
    </svg>`;
}

function renderResult() {
  const plan = computePlan();
  lastPlan = plan;
  const { target, direction, days, finish, delta, targetKcal, waterL } = plan;

  const weightEl = $('#wizard-result-weight');
  if (weightEl) weightEl.textContent = `${trimNum(target)} кг`;

  /* Дата ВСЕГДА с годом — порядок «медленнее/быстрее» читается однозначно */
  const planEl = $('#wizard-result-date');
  if (planEl) {
    if (days > 0) {
      const dateStr = finish.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
        .replace(/\s?г\.$/, '');
      planEl.textContent = `Вы достигнете своей цели к ${dateStr}`;
    } else {
      planEl.textContent = 'Цель достигнута — просто держим вес!';
    }
  }

  const kcalEl = $('#wizard-result-kcal');
  if (kcalEl) {
    kcalEl.textContent = direction === 'keep'
      ? `Держим вес: ${targetKcal.toLocaleString('ru-RU')} ккал в день`
      : `Цель по калориям: ${targetKcal.toLocaleString('ru-RU')} ккал в день `
        + `(${direction === 'loss' ? 'дефицит' : 'профицит'} ${delta.toLocaleString('ru-RU')} ккал)`;
  }

  /* Вода для обмена веществ — сразу под калориями */
  const waterEl = $('#wizard-result-water');
  if (waterEl) {
    waterEl.textContent =
      `Вода для обмена веществ: ${trimNum(waterL)} л в день (30 мл/кг + активность)`;
  }

  /* Предупреждение только информационное: расчёт НЕ меняется */
  const noteEl = $('#wizard-result-note');
  if (noteEl) {
    const low = direction !== 'keep' && targetKcal > 0 && targetKcal < 1200;
    noteEl.hidden = !low;
    if (low) noteEl.textContent =
      'Внимание: при таком темпе калорийность опускается ниже минимума ВОЗ (1200 ккал) — сверьтесь со специалистом.';
  }

  /* Месяцы — ровным рядом под всем графиком */
  const months = $('#wizard-months');
  if (months) {
    months.innerHTML = buildMonths(plan.start, finish).map((m) => `<span>${m}</span>`).join('');
    months.style.width = '100%';
  }

  renderWeightChart(plan);
}

/* «Поехали!»: сохраняем анкету, ЗАКРЫВАЕМ мастер и сразу показываем плашку плана */
function wizardFinish() {
  const plan = computePlan();
  lastPlan = plan;
  const rw = plan.rw;

  const profile = {
    goal:       wizardData.goal,
    sex:        wizardData.sex,
    birth:      { ...rw.birth },
    heightCm:   rw.heightCm,
    weightKg:   rw.weightKg,
    targetKg:   rw.targetKg,
    activity:   wizardData.activity,
    paceKgWeek: wizardData.pace,
    updatedAt:  Date.now(),
  };

  state.profile = profile;
  saveJSON(dbKey(state.uid, 'profile'), profile);
  pushWeightRecord(profile.weightKg);
  LOG('Анкета сохранена →', dbKey(state.uid, 'profile'), profile);

  wizardClose();          // сначала убираем мастер с экрана…
  openPlanModal(plan);    // …и сразу показываем плашку плана поверх всего
}

/* ---------- Окно плана: калории + вода ---------- */
function openPlanModal(plan) {
  const modal = $('#plan-modal');
  if (!modal) return;
  $('#plan-kcal').textContent = plan.targetKcal.toLocaleString('ru-RU');
  $('#plan-water').textContent = trimNum(plan.waterL);
  const note = $('#plan-note');
  if (note) {
    note.textContent = plan.direction === 'keep'
      ? `Норма поддержки ≈ ${Math.round(plan.tdee).toLocaleString('ru-RU')} ккал · вода: 30 мл/кг + активность`
      : `Норма ≈ ${Math.round(plan.tdee).toLocaleString('ru-RU')} ккал · `
        + `${plan.direction === 'loss' ? 'дефицит' : 'профицит'} ${plan.delta.toLocaleString('ru-RU')} ккал · `
        + `вода: 30 мл/кг + активность`;
  }
  modal.hidden = false;
  document.body.classList.add('no-scroll');
}

/* «ОК»: цель по ккал и вода уезжают в цели пользователя —
   кольцо дневника покажет новую норму вместо 1800 */
function applyPlan() {
  if (!lastPlan) return;
  state.goals = { ...state.goals, kcal: lastPlan.targetKcal, waterL: lastPlan.waterL };
  saveJSON(dbKey(state.uid, 'goals'), state.goals);

  const modal = $('#plan-modal');
  if (modal) modal.hidden = true;
  document.body.classList.remove('no-scroll');
  wizardClose();
  rerenderAll();
  LOG('Цели обновлены →', dbKey(state.uid, 'goals'), '| ккал:', state.goals.kcal, '| вода:', state.goals.waterL);
}

function initWizard() {
  const root = $('#goal-wizard');
  if (!root) return;

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-wizard-close]')) { wizardClose(); return; }

    const option = event.target.closest('.wizard__option');
    if (option) {
      if (option.dataset.goal) { wizardData.goal = option.dataset.goal; wizardGo(wizardStep + 1); return; }
      if (option.dataset.sex)  { wizardData.sex  = option.dataset.sex;  wizardGo(wizardStep + 1); return; }
      if (option.dataset.activity) {
        wizardData.activity = option.dataset.activity;
        $$('.wizard__option[data-activity]', root).forEach((o) => o.classList.remove('is-picked'));
        option.classList.add('is-picked');
        setTimeout(() => wizardGo(wizardStep + 1), 280);
        return;
      }
    }

    if (event.target.closest('[data-wizard-next]')) {
      if (wizardStep < WIZARD_TOTAL) wizardGo(wizardStep + 1);
      return;
    }

    if (event.target.closest('[data-wizard-finish]')) wizardFinish();
  });

  $('#wizard-back')?.addEventListener('click', () => {
    if (wizardStep === 1) wizardClose();
    else wizardGo(wizardStep - 1);
  });

  $('#pace-slider')?.addEventListener('input', (event) => {
    wizardData.pace = Number(event.target.value);
    updatePaceUI();
  });

  /* ВАЖНО: именно эта строка переносит ккал и воду в кольцо дневника */
  $('#plan-ok')?.addEventListener('click', applyPlan);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !root.hidden) wizardClose();
  });
}

/* ------------------ 12. САЙДБАР, СОБЫТИЯ, СИНХРОНИЗАЦИЯ ------------------ */
function initSidebar() {
  const sidebar  = $('#sidebar');
  const backdrop = $('#sidebar-backdrop');
  if (!sidebar || !backdrop) return;

  const close = () => {
    sidebar.classList.remove('is-open');
    backdrop.classList.remove('is-open');
  };

  $('#sidebar-open')?.addEventListener('click', () => {
    sidebar.classList.add('is-open');
    backdrop.classList.add('is-open');
  });
  $('#sidebar-close')?.addEventListener('click', close);
  backdrop.addEventListener('click', close);
}

function initTodayDate() {
  const el = $('#today-date');
  if (el) {
    el.textContent = new Date().toLocaleDateString('ru-RU', {
      weekday: 'short', day: 'numeric', month: 'long'
    });
  }
}

function initDiaryEvents() {
  $$('[data-meal-add]').forEach((btn) =>
    btn.addEventListener('click', () => openModal(btn.dataset.mealAdd)));

  $$('.meal-card').forEach((card) => {
    card.addEventListener('click', (event) => {
      const actionBtn = event.target.closest('[data-action]');
      if (!actionBtn) return;
      const index = Number(actionBtn.closest('.meal-item').dataset.index);
      const meal  = card.dataset.meal;
      if (actionBtn.dataset.action === 'delete')      deleteItem(meal, index);
      if (actionBtn.dataset.action === 'edit-weight') openWeightModal(meal, index);
    });
  });

  modalEl     = $('#product-modal');
  modalList   = $('#modal-list');
  modalSearch = $('#modal-search-input');
  modalSave   = $('#modal-save');
  weightModal = $('#weight-modal');
  weightInput = $('#weight-input');

  if (modalEl) {
    modalEl.addEventListener('click', (event) => {
      if (event.target.closest('[data-modal-close]')) { closeModal(); return; }
      const tab = event.target.closest('.modal__tab');
      if (tab) { switchTab(tab.dataset.tab); return; }
      const itemBtn = event.target.closest('.modal__item-btn');
      if (itemBtn) toggleProduct(itemBtn);
    });
    modalSave.addEventListener('click', saveSelection);
    modalSearch.addEventListener('input', () => {
      state.modalQuery = modalSearch.value;
      renderModalList();
    });
    $('#modal-search-clear')?.addEventListener('click', () => {
      modalSearch.value = '';
      state.modalQuery = '';
      renderModalList();
      modalSearch.focus();
    });
  }

  if (weightModal) {
    weightModal.addEventListener('click', (event) => {
      if (event.target.closest('[data-weight-close]')) closeWeightModal();
    });
    weightInput.addEventListener('input', updateWeightHint);
    $('#weight-save')?.addEventListener('click', saveWeight);
  }

  $('#diary-prev')?.addEventListener('click', () => shiftDay(-1));
  $('#diary-next')?.addEventListener('click', () => shiftDay(1));

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (weightModal && !weightModal.hidden) closeWeightModal();
    else if (modalEl && !modalEl.hidden)    closeModal();
  });
}

window.addEventListener('pageshow', () => {
  switchScope();
  renderProfile();
  rerenderAll();
});

window.addEventListener('storage', () => {
  switchScope();
  renderProfile();
  rerenderAll();
});

/* Старт приложения */
initSidebar();
initTodayDate();
initDiaryEvents();
initAuth();
initWizard();
rerenderAll();