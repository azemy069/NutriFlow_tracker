/* ==========================================================================
NUTRIFLOW — логика приложения (ВЕРСИЯ 6 — мастер цели из 9 шагов)
Данные каждого пользователя лежат раздельно и структурированно:
nutriflow.db.<uid>.diary.v1    — блюда по дням
nutriflow.db.<uid>.history.v1  — недавние продукты
nutriflow.db.<uid>.weight.v2   — журнал веса: одна запись на день { date, kg, ts }
nutriflow.db.<uid>.goals.v2    — цели (ккал и БЖУ)
nutriflow.db.<uid>.profile.v2  — анкета цели: цель, пол, дата, рост, вес,
                                 целевой вес, активность, темп
========================================================================== */
'use strict';

const APP_VERSION = '6.1';
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

/* Безопасная инициализация базы продуктов (не падает, если products.js не подключён) */
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
/* Версия ключей v2 отсекает старые склеенные данные из прошлых тестов */
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

/* Если сессия указывает на несуществующего пользователя, сбрасываем в guest */
const scopeUid = () => {
  const user = currentUser();
  return user ? user.id : 'guest';
};

/* Надёжная генерация уникального ID без коллизий */
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
  /* Личные пустые хранилища нового аккаунта */
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

/* Индикатор текущего аккаунта в сайдбаре, чтобы всегда видеть, чей дневник открыт */
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
  /* Перед записью сверяем актуальный uid из сессии */
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

  /* Кнопка «Изменить цель» открывает мастер из 9 шагов */
  $('#goal-btn').addEventListener('click', wizardOpen);

  renderProfile();
}

/* ==========================================================================
   11. МАСТЕР ПОСТАНОВКИ ЦЕЛИ — 9 ШАГОВ
   1 цель · 2 пол · 3 дата рождения · 4 рост · 5 вес · 6 целевой вес ·
   7 образ жизни · 8 темп изменений · 9 итоговый план
   Ответы сохраняются в nutriflow.db.<uid>.profile.v2, текущий вес
   дополнительно попадает в журнал nutriflow.db.<uid>.weight.v2.
   ========================================================================== */
const WIZARD_TOTAL = 9;
const WHEEL_ITEM_H = 56;
const WHEEL_VISIBLE = 5;

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

/* ---------- Колесо выбора: скролл со снапом по центру ---------- */
function createWheel(host, values, initial, format) {
  const viewport = document.createElement('div');
  viewport.className = 'wheel__viewport';
  viewport.tabIndex = 0;

  /* Пустые блоки сверху и снизу, чтобы крайние значения доходили до центра */
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

  /* Подсветка и «таяние» значений по мере удаления от центра */
  function paint() {
    const center = viewport.scrollTop / WHEEL_ITEM_H;
    viewport.querySelectorAll('.wheel__item').forEach((el) => {
      const d = Math.abs(Number(el.dataset.index) - center);
      el.classList.toggle('is-active', d < .5);
      el.style.opacity = d < .5 ? '1' : d < 1.5 ? '.55' : '.3';
    });
  }

  /* Доснап после остановки скролла (свайп, тач, перетаскивание полосы) */
  let snapTimer = 0;
  viewport.addEventListener('scroll', () => {
    paint();
    clearTimeout(snapTimer);
    snapTimer = setTimeout(
      () => scrollToIndex(Math.round(viewport.scrollTop / WHEEL_ITEM_H)),
      120
    );
  }, { passive: true });

  /* ФИКС прыжков через значение: колесо мыши перехватывается вручную.
     ЛЮБОЕ событие колеса (дельта 100, 160, 240 px — не важно) даёт
     строго ОДИН шаг: дельта копится до порога чувствительности,
     остаток сбрасывается, а замок 60 мс гасит серийные события.
     Трекпад при этом листает плавно, потому что присылает много
     мелких событий, и каждое преодолевает порог по очереди. */
  let wheelAcc = 0;
  let wheelLock = 0;
  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1;
    wheelAcc += event.deltaY * unit;
    const STEP_PX = 60;                 // порог чувствительности
    if (Math.abs(wheelAcc) < STEP_PX) return;
    const now = performance.now();
    if (now - wheelLock < 60) return;   // серия событий подряд — подождать
    wheelLock = now;
    const dir = wheelAcc > 0 ? 1 : -1;  // направление прокрутки
    wheelAcc = 0;                       // одно событие — максимум один шаг
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

/* Создание всех колёс один раз при первом открытии мастера */
function ensureWheels() {
  if (wheelsReady) return;
  wheelsReady = true;
  const MONTHS = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь',
                  'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
  createWheel($('[data-wheel="b-day"]'),   range(1, 31),      wizardData.birth.day);
  createWheel($('[data-wheel="b-month"]'), range(1, 12),      wizardData.birth.month, (v) => MONTHS[v - 1]);
  createWheel($('[data-wheel="b-year"]'),  range(1900, 2026), wizardData.birth.year);
  createWheel($('[data-wheel="h-int"]'),   range(100, 220),   Math.floor(wizardData.height));
  createWheel($('[data-wheel="h-dec"]'),   range(0, 9),       Math.round((wizardData.height % 1) * 10));
  createWheel($('[data-wheel="w-int"]'),   range(30, 200),    Math.floor(wizardData.weight));
  createWheel($('[data-wheel="w-dec"]'),   range(0, 9),       Math.round((wizardData.weight % 1) * 10));
  createWheel($('[data-wheel="t-int"]'),   range(30, 200),    Math.floor(wizardData.target));
  createWheel($('[data-wheel="t-dec"]'),   range(0, 9),       Math.round((wizardData.target % 1) * 10));
}

/* Подставить сохранённые ранее ответы в колёса */
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

/* Подсветка ранее выбранного варианта активности */
const syncActivityPick = () => {
  $$('.wizard__option[data-activity]').forEach((o) => {
    o.classList.toggle('is-picked', o.dataset.activity === wizardData.activity);
  });
};

function wizardOpen() {
  const root = $('#goal-wizard');
  if (!root) return;

  /* Предзаполнение из сохранённой анкеты пользователя */
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

/* Журнал веса: одна запись на день, свежая перезаписывает сегодняшнюю */
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

/* ---------- Шаг 8: слайдер темпа ---------- */
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

/* ---------- Шаг 9: итоговый план с графиком и датой цели ---------- */
function renderResult() {
  const current = wheels.get('w-int').get() + wheels.get('w-dec').get() / 10;
  const target  = wheels.get('t-int').get() + wheels.get('t-dec').get() / 10;
  const diff  = current - target;                       // > 0 — похудение
  const weeks = Math.abs(diff) / (wizardData.pace || 0.5);
  const days  = Math.round(weeks * 7);
  const finish = new Date();
  finish.setDate(finish.getDate() + days);

  const weightEl = $('#wizard-result-weight');
  if (weightEl) weightEl.textContent = `${trimNum(target)} кг`;

  const planEl = $('#wizard-result-date');
  if (planEl) {
    planEl.textContent = days > 0
      ? `Вы достигнете своей цели к ${finish.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
      : 'Цель достигнута — просто держим вес!';
  }

  const after = new Date(finish);
  after.setMonth(after.getMonth() + 1);
  const months = $('#wizard-months');
  if (months) {
    const fmt = (d) => d.toLocaleDateString('ru-RU', { month: 'short' });
    months.innerHTML =
      `<span>${fmt(new Date())}</span><span>${fmt(finish)}</span><span>${fmt(after)}</span>`;
  }

  const chart = $('#wizard-chart');
  if (chart) {
    const losing  = diff > 0.05;
    const gaining = diff < -0.05;
    const yStart  = losing ? 50 : gaining ? 190 : 120;
    const first   = (losing || gaining)
      ? `M0 ${yStart} L240 ${(yStart + 120) / 2} L370 120`
      : `M0 120 L370 120`;
    chart.innerHTML = `
      <svg viewBox="0 0 600 240">
        <path d="${first}" class="wizard__chart-line wizard__chart-line--active"/>
        <path d="M400 120 L600 120" class="wizard__chart-line wizard__chart-line--plan"/>
        <circle cx="370" cy="120" r="14" class="wizard__chart-dot--end"/>
        <circle cx="400" cy="120" r="12" class="wizard__chart-dot--start"/>
      </svg>`;
  }
}

/* Финал: анкета и вес уезжают в личную базу пользователя */
function wizardFinish() {
  wizardData.birth = {
    day:   wheels.get('b-day').get(),
    month: wheels.get('b-month').get(),
    year:  wheels.get('b-year').get(),
  };
  wizardData.height = wheels.get('h-int').get() + wheels.get('h-dec').get() / 10;
  wizardData.weight = wheels.get('w-int').get() + wheels.get('w-dec').get() / 10;
  wizardData.target = wheels.get('t-int').get() + wheels.get('t-dec').get() / 10;

  const profile = {
    goal:       wizardData.goal,
    sex:        wizardData.sex,
    birth:      { ...wizardData.birth },
    heightCm:   wizardData.height,
    weightKg:   wizardData.weight,
    targetKg:   wizardData.target,
    activity:   wizardData.activity,
    paceKgWeek: wizardData.pace,
    updatedAt:  Date.now(),
  };

  state.profile = profile;
  saveJSON(dbKey(state.uid, 'profile'), profile);
  pushWeightRecord(profile.weightKg);
  LOG('Анкета сохранена →', dbKey(state.uid, 'profile'), profile);
  wizardClose();
}

function initWizard() {
  const root = $('#goal-wizard');
  if (!root) return;

  /* Делегирование: дымка, карточки-ответы, «Далее», «Продолжить» */
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
        setTimeout(() => wizardGo(wizardStep + 1), 280);   // салатовая вспышка как в референсе
        return;
      }
    }

    if (event.target.closest('[data-wizard-next]')) {
      if (wizardStep < WIZARD_TOTAL) wizardGo(wizardStep + 1);
      return;
    }

    if (event.target.closest('[data-wizard-finish]')) wizardFinish();
  });

  /* Стрелка назад: с 1-го шага закрывает мастер */
  $('#wizard-back')?.addEventListener('click', () => {
    if (wizardStep === 1) wizardClose();
    else wizardGo(wizardStep - 1);
  });

  /* Слайдер темпа: метка и заливка дорожки обновляются сразу */
  $('#pace-slider')?.addEventListener('input', (event) => {
    wizardData.pace = Number(event.target.value);
    updatePaceUI();
  });

  /* Escape закрывает мастер */
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

/* Синхронизация при возврате по кнопке «Назад» (bfcache) и между вкладками */
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