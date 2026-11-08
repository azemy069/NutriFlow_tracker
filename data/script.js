/* ==========================================================================
   NUTRIFLOW — логика приложения (ВЕРСИЯ 3 — гарантированная изоляция)
   Каждый пользователь хранит данные под своим ключом:
   nutriflow.db.<id>.diary.v1 / .history.v1 / .weight.v1 / .goals.v1
   Сессия:  nutriflow.db.session.v1  (переживает F5, но не другой компьютер)
   ========================================================================== */
'use strict';

/* Метка версии: откройте консоль (F12) и убедитесь, что видите "версия 3".
   Если её нет — браузер выполняет старый закэшированный файл. */
const APP_VERSION = '3.0';
const LOG = (...args) => console.log('%c[NutriFlow v' + APP_VERSION + ']',
  'color:#0e7d72;font-weight:bold', ...args);

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
const PRODUCT_MAP = new Map(PRODUCTS_DB.map((product) => [product.id, product]));

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
const DB_USERS   = 'nutriflow.db.users.v1';
const DB_SESSION = 'nutriflow.db.session.v1';

const dbKey = (uid, domain) => `nutriflow.db.${uid}.${domain}.v1`;

const loadUsers    = () => loadJSON(DB_USERS, []);
const setSession   = (id) => saveJSON(DB_SESSION, id);
const clearSession = () => localStorage.removeItem(DB_SESSION);
const scopeUid     = () => loadJSON(DB_SESSION, null) || 'guest';

const currentUser = () => {
  const id = loadJSON(DB_SESSION, null);
  return id ? loadUsers().find((u) => u.id === id) || null : null;
};

const uidFrom = (email) => 'u-' + email.replace(/[^a-z0-9@.]/g, '');

function registerUser(name, email, password) {
  const users = loadUsers();
  const clean = email.toLowerCase().trim();
  if (users.some((u) => u.email === clean)) {
    return { error: 'Пользователь с такой почтой уже зарегистрирован — попробуйте войти.' };
  }
  const user = { id: uidFrom(clean), name: name.trim(), email: clean, password };
  users.push(user);
  saveJSON(DB_USERS, users);
  migrateLegacy(user.id);
  migrateGuestTo(user.id);  
  setSession(user.id);
  LOG('Зарегистрирован пользователь, uid =', user.id);
  return { user };
}

function loginUser(email, password) {
  const clean = email.toLowerCase().trim();
  const user = loadUsers().find((u) => u.email === clean);
  if (!user || user.password !== password) {
    return { error: 'Неверная почта или пароль. Проверьте ввод и попробуйте ещё раз.' };
  }
  migrateLegacy(user.id);
  migrateGuestTo(user.id);
  setSession(user.id);
  LOG('Вход выполнен, uid =', user.id);
  return { user };
}

/* Полная очистка гостевых данных. Вызывается при выходе из аккаунта,
   чтобы «осколки» гостевого дневника не переехали в следующий аккаунт. */
function clearGuestData() {
  ['diary', 'history', 'weight', 'goals'].forEach((domain) => {
    localStorage.removeItem(dbKey('guest', domain));
  });
}

const isEmptyValue = (value) => {
  if (value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
};

/* Гостевые записи переезжают в аккаунт при ПЕРВОМ входе/регистрации.
   После переноса гостевые данные удаляются, чтобы не «прилипнуть» к другому аккаунту. */
function migrateGuestTo(uid) {
  // Ничего не делаем — миграция отключена
  return;
}

function migrateLegacy(uid) {
  const legacy = loadJSON(`nutriflow.user.${uid}.v1`, null);
  if (!legacy) return;
  if (legacy.diary && loadJSON(dbKey(uid, 'diary'), null) === null) {
    saveJSON(dbKey(uid, 'diary'), legacy.diary);
  }
  if (Array.isArray(legacy.history) && legacy.history.length) saveJSON(dbKey(uid, 'history'), legacy.history);
  if (Array.isArray(legacy.weight)  && legacy.weight.length)  saveJSON(dbKey(uid, 'weight'),  legacy.weight);
  if (legacy.goals) saveJSON(dbKey(uid, 'goals'), legacy.goals);
  localStorage.removeItem(`nutriflow.user.${uid}.v1`);
}

/* ------------------ 3. ОБЛАСТЬ ДАННЫХ ПОЛЬЗОВАТЕЛЯ ------------------ */
function loadScope(uid) {
  let diary = loadJSON(dbKey(uid, 'diary'), null);
  if (diary === null) diary = uid === 'guest' ? seedDemoDiary() : {};
  return {
    diary,
    history: loadJSON(dbKey(uid, 'history'), []),
    weight:  loadJSON(dbKey(uid, 'weight'), []),
    goals:   loadJSON(dbKey(uid, 'goals'), null) || { ...GOALS },
  };
}

const seedDemoDiary = () => ({
  [dateKey(0)]: {
    breakfast: [{ id: 'oatmeal-water', weight: 250 }, { id: 'coffee-milk', weight: 200 }],
    lunch: [{ id: 'chicken-fillet-boil', weight: 150 }, { id: 'buckwheat-boiled', weight: 180 }, { id: 'tomato', weight: 120 }],
    dinner: [{ id: 'tvorog-5', weight: 180 }, { id: 'banana', weight: 110 }],
    snack: [],
  },
});

/* ------------------ 4. СОСТОЯНИЕ ------------------ */
migrateLegacy(scopeUid());

const state = {
  uid: scopeUid(),
  date: dateKey(0),
  dayOffset: 0,
  diary: {}, history: [], weight: [], goals: { ...GOALS },
  modalMeal: null,
  modalTab: 'search',
  modalQuery: '',
  selected: new Map(),
  weightTarget: null,
};

/* КРИТИЧЕСКИ ВАЖНО для изоляции: при любой смене пользователя полностью
   сбрасываем state и читаем данные ЗАНОВО из хранилища нового uid. */
function switchScope() {
  const newUid = scopeUid();

  state.uid = newUid;
  state.date = dateKey(0);
  state.dayOffset = 0;
  state.diary = {};
  state.history = [];
  state.weight = [];
  state.goals = { ...GOALS };
  state.modalMeal = null;
  state.modalQuery = '';
  state.selected.clear();
  state.weightTarget = null;

  const scope = loadScope(newUid);
  state.diary   = scope.diary;
  state.history = scope.history;
  state.weight  = scope.weight;
  state.goals   = scope.goals;

  LOG('Активный пользователь:', newUid, '| ключ дневника:', dbKey(newUid, 'diary'));
}

/* Первичная загрузка данных текущего пользователя */
switchScope();

const dayEntries = () => {
  if (!state.diary[state.date]) {
    state.diary[state.date] = { breakfast: [], lunch: [], dinner: [], snack: [] };
  }
  return state.diary[state.date];
};

const persistDiary = () => {
  const key = dbKey(state.uid, 'diary');
  saveJSON(key, state.diary);
  LOG('Дневник сохранён →', key);
};

const persistHistory = () => saveJSON(dbKey(state.uid, 'history'), state.history);

function rerenderAll() {
  renderDate();
  renderMeals();
  renderSummary();
}

/* ------------------ 5. СВОДКА ДНЯ ------------------ */
function dayTotals() {
  const totals = { kcal: 0, p: 0, f: 0, c: 0 };
  const day = dayEntries();
  MEALS.forEach(({ key }) => {
    day[key].forEach(({ id, weight }) => {
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
  return `<li class="meal-item" data-index="${index}"> <span class="meal-item__name">${product.name}</span> <button class="meal-item__weight" data-action="edit-weight" title="Нажмите, чтобы изменить граммовку">${item.weight} г</button> <span class="meal-item__cals">${portion.kcal} ккал</span> <button class="meal-item__delete" data-action="delete" aria-label="Удалить «${product.name}»"> <svg viewBox="0 0 24 24" aria-hidden="true"> <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/> </svg> </button> </li>`;
}

function renderMeals() {
  const day = dayEntries();
  MEALS.forEach(({ key }) => {
    const list  = $(`[data-meal-list="${key}"]`);
    const total = $(`[data-meal-total="${key}"]`);
    if (!list) return;
    const items = day[key];
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
  return `<li class="modal__item"> <button class="modal__item-btn ${isSelected ? 'is-selected' : ''}" data-product="${product.id}" data-last="${lastWeight ?? ''}"> <span class="modal__item-name">${product.name}</span> ${lastWeight ? `<span class="modal__item-last">последний раз ${lastWeight} г</span>` : ''} <span class="modal__item-kcal">${product.kcal} ккал</span> <span class="modal__item-check" aria-hidden="true"> <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg> </span> </button> </li>`;
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
    ? PRODUCTS_DB.filter((p) => p.name.toLowerCase().includes(query))
    : PRODUCTS_DB;
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

function submitAuth() {
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
    setAuthMode(null);
    $('#auth-name').value = '';
    $('#auth-email').value = '';
    $('#auth-pass').value = '';
  }
}

function initAuth() {
  const authView = $('#auth-view');
  const profileView = $('#profile-view');
  if (!authView || !profileView) return;

  $('#auth-login-btn').addEventListener('click', () =>
    setAuthMode(authMode === 'login' ? null : 'login'));
  $('#auth-register-btn').addEventListener('click', () =>
    setAuthMode(authMode === 'register' ? null : 'register'));
  $('#auth-submit').addEventListener('click', submitAuth);

 /* Выход: чистим сессию, очищаем гостевые данные
   (чтобы следующий гость начал с пустого дневника),
   перезагружаем state и перерисовываем */
$('#logout-btn').addEventListener('click', () => {
  clearSession();
  clearGuestData();
  switchScope();
  renderProfile();
  rerenderAll();
  LOG('Выход из аккаунта. Теперь вы гость.');
});

  $('#goal-btn').addEventListener('click', () => { /* TODO: редактор целей */ });

  renderProfile();
}

/* ------------------ 11. САЙДБАР, СОБЫТИЯ, СТАРТ ------------------ */
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

/* Старт приложения */
initSidebar();
initTodayDate();
initDiaryEvents();
initAuth();
rerenderAll();