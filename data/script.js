/* ==========================================================================
   NUTRIFLOW — логика приложения (ВЕРСИЯ 8)
   · Напитки: порция в мл, пересчёт через плотность, база не ломается.
   · Профиль: сводка цели под шапкой аккаунта, обновляется после каждого мастера.
   · Футер прижат к низу на всех страницах (CSS).
   · Тёмная тема: переключатель солнце/луна, тост, сохранение между страницами.
   ========================================================================== */
'use strict';

const APP_VERSION = '8.0';
const LOG = (...args) => console.log(`%c[NutriFlow v${APP_VERSION}]`, 'color:#0e7d72;font-weight:bold', ...args);

/* ------------------ 1. УТИЛИТЫ И ДАТЫ ------------------ */
const $  = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const loadJSON = (key, fallback) => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
};
const saveJSON = (key, value) => localStorage.setItem(key, JSON.stringify(value));

const GOALS = { kcal: 1800, p: 120, f: 70, c: 200 };
const RING_LENGTH = 327;
const MEALS = [{ key: 'breakfast' }, { key: 'lunch' }, { key: 'dinner' }, { key: 'snack' }];
const HISTORY_LIMIT = 20;

const SAFE_PRODUCTS = typeof PRODUCTS_DB !== 'undefined' && Array.isArray(PRODUCTS_DB) ? PRODUCTS_DB : [];
const PRODUCT_MAP = new Map(SAFE_PRODUCTS.map((p) => [p.id, p]));

/* ---- Напитки: мл ↔ г через плотность (ккал в базе на 100 г) ---- */
const isDrink = (p) => Boolean(p) && p.cat === 'drinks';
const drinkDensity = (p) => {
  const id = p.id;
  if (/^(vodka|cognac|whiskey|rum|gin)/.test(id)) return 0.95;      // крепкий алкоголь
  if (/^(wine|champagne|beer)/.test(id)) return 0.99;               // вино/пиво
  if (/^(milkshake|cocoa-milk|latte|cappuccino|coffee-milk|frappe|mocha)/.test(id)) return 1.03;
  if (/^(juice|smoothie|compote|mors|kissel|lemonade|cola|pepsi|fanta|sprite|energy|kvass)/.test(id)) return 1.04;
  return 1;                                                       // вода, чай, кофе
};
const toGrams = (p, amount, unit) => unit === 'ml' ? amount * drinkDensity(p) : amount;
const unitLabel = (unit) => unit === 'ml' ? 'мл' : 'г';

const calcPortion = (p, amount, unit = 'g') => {
  const k = toGrams(p, amount, unit) / 100;
  return {
    kcal: Math.round(p.kcal * k),
    p: +(p.p * k).toFixed(1),
    f: +(p.f * k).toFixed(1),
    c: +(p.c * k).toFixed(1),
  };
};

const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateKey = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return fmtDate(d); };
const parseKey = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtFullDate = (d) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s?г\.$/, '');
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
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }
}
let toastTimer = 0;
function showToast(message) {
  let el = $('#app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.className = 'app-toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2200);
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
  return {
    diary: diary && typeof diary === 'object' ? diary : {},
    history: loadJSON(dbKey(uid, 'history'), []),
    weight: loadJSON(dbKey(uid, 'weight'), []),
    goals: loadJSON(dbKey(uid, 'goals'), null) || { ...GOALS },
    profile: loadJSON(dbKey(uid, 'profile'), null),
  };
}

/* ------------------ 4. СОСТОЯНИЕ ------------------ */
const state = {
  uid: scopeUid(), date: dateKey(0), dayOffset: 0,
  diary: {}, history: [], weight: [], goals: { ...GOALS }, profile: null,
  modalMeal: null, modalTab: 'search', modalQuery: '',
  selected: new Map(), weightTarget: null,
};

function switchScope() {
  const scope = loadScope(scopeUid());
  state.uid = scopeUid();
  state.date = dateKey(state.dayOffset);
  state.diary = scope.diary; state.history = scope.history;
  state.weight = scope.weight; state.goals = scope.goals; state.profile = scope.profile;
  state.modalMeal = null; state.modalQuery = '';
  state.selected.clear(); state.weightTarget = null;
  renderUserBadge();
  LOG('Активный профиль:', state.uid, '| Ключ БД:', dbKey(state.uid, 'diary'));
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
  badge.textContent = user ? `Аккаунт: ${user.name} (${user.email})` : 'Режим: Гость (войти в профиль)';
}
switchScope();

const dayEntries = () => {
  if (!state.diary[state.date]) state.diary[state.date] = { breakfast: [], lunch: [], dinner: [], snack: [] };
  return state.diary[state.date];
};
const persistDiary = () => { state.uid = scopeUid(); saveJSON(dbKey(state.uid, 'diary'), state.diary); };
const persistHistory = () => { state.uid = scopeUid(); saveJSON(dbKey(state.uid, 'history'), state.history); };

function rerenderAll() { renderUserBadge(); renderDate(); renderMeals(); renderSummary(); }

/* ------------------ 5. СВОДКА ДНЯ ------------------ */
function dayTotals() {
  const totals = { kcal: 0, p: 0, f: 0, c: 0 };
  const day = dayEntries();
  MEALS.forEach(({ key }) => (day[key] || []).forEach((item) => {
    const p = PRODUCT_MAP.get(item.id);
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
  const p = PRODUCT_MAP.get(item.id);
  if (!p) return '';
  const unit = item.unit === 'ml' ? 'ml' : 'g';
  const portion = calcPortion(p, item.weight, unit);
  return `<li class="meal-item" data-index="${index}">
    <span class="meal-item__name">${p.name}</span>
    <button class="meal-item__weight" data-action="edit-weight" title="Нажмите, чтобы изменить порцию">${item.weight} ${unitLabel(unit)}</button>
    <span class="meal-item__cals">${portion.kcal} ккал</span>
    <button class="meal-item__delete" data-action="delete" aria-label="Удалить «${p.name}»">
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
        const p = PRODUCT_MAP.get(item.id);
        return p ? sum + calcPortion(p, item.weight, item.unit).kcal : sum;
      }, 0);
      total.textContent = `${kcal} ккал`;
    }
  });
}

/* ------------------ 7. ОКНО ВЫБОРА ПРОДУКТОВ ------------------ */
let modalEl = null, modalList = null, modalSearch = null, modalSave = null;

function openModal(mealKey) {
  if (!modalEl) return;
  state.modalMeal = mealKey; state.modalQuery = ''; state.selected.clear();
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
function rowTemplate(p, lastWeight, lastUnit) {
  const selected = state.selected.has(p.id);
  const unit = lastUnit || (isDrink(p) ? 'ml' : 'g');
  return `<li class="modal__item">
    <button class="modal__item-btn ${selected ? 'is-selected' : ''}" data-product="${p.id}" data-last="${lastWeight ?? ''}" data-last-unit="${unit}">
      <span class="modal__item-name">${p.name}</span>
      ${lastWeight ? `<span class="modal__item-last">последний раз ${lastWeight} ${unitLabel(unit)}</span>` : ''}
      <span class="modal__item-kcal">${p.kcal} ккал / 100 ${isDrink(p) ? 'мл' : 'г'}</span>
      <span class="modal__item-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>
    </button>
  </li>`;
}
function renderModalList() {
  if (!modalList) return;
  const rows = state.modalTab === 'search' ? searchRows() : recentRows();
  modalList.innerHTML = rows.length ? rows.join('') : '<li class="modal__empty">Ничего не найдено — попробуйте другой запрос</li>';
}
function searchRows() {
  const q = state.modalQuery.trim().toLowerCase();
  const source = q ? SAFE_PRODUCTS.filter((p) => p.name.toLowerCase().includes(q)) : SAFE_PRODUCTS;
  return source.map((p) => rowTemplate(p, null));
}
function recentRows() {
  return state.history.map((r) => {
    const p = PRODUCT_MAP.get(r.id);
    return p ? rowTemplate(p, r.weight, r.unit) : '';
  }).filter(Boolean);
}
function toggleProduct(btn) {
  const id = btn.dataset.product;
  if (state.selected.has(id)) { state.selected.delete(id); btn.classList.remove('is-selected'); }
  else {
    const last = Number(btn.dataset.last);
    state.selected.set(id, { weight: last > 0 ? last : 100, unit: btn.dataset.lastUnit || (isDrink(PRODUCT_MAP.get(id)) ? 'ml' : 'g') });
    btn.classList.add('is-selected');
  }
  updateSaveBtn();
}
function updateSaveBtn() {
  if (!modalSave) return;
  const n = state.selected.size;
  modalSave.textContent = n > 0 ? `Сохранить (${n})` : 'Сохранить';
  modalSave.disabled = n === 0;
}
function saveSelection() {
  const target = dayEntries()[state.modalMeal];
  state.selected.forEach(({ weight, unit }, id) => {
    target.push({ id, weight, unit });
    pushHistory(id, weight, unit);
  });
  persistDiary(); renderMeals(); renderSummary(); closeModal();
}
function pushHistory(id, weight, unit) {
  state.history = state.history.filter((r) => r.id !== id);
  state.history.unshift({ id, weight, unit, ts: Date.now() });
  state.history = state.history.slice(0, HISTORY_LIMIT);
  persistHistory();
}

/* ------------------ 8. ПОРЦИЯ: ГРАММЫ / МИЛЛИЛИТРЫ ------------------ */
let weightModal = null, weightInput = null;

/* Подсветка выбранной единицы и заголовок окна */
function setUnitUI(unit) {
  const toggle = $('#weight-unit-toggle');
  if (toggle) {
    $$('.unit-switch__btn', toggle).forEach((btn) => {
      const active = btn.dataset.unit === unit;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }
  const title = $('#weight-title');
  if (title) title.textContent = unit === 'ml' ? 'Изменить объём' : 'Изменить граммовку';
}

function openWeightModal(mealKey, index) {
  if (!weightModal) return;
  const item = dayEntries()[mealKey][index];
  const p = PRODUCT_MAP.get(item.id);
  if (!p) return;
  /* Напитки без сохранённой единицы открываем в мл, остальное — в граммах */
  const unit = item.unit === 'ml' ? 'ml' : item.unit === 'g' ? 'g' : (isDrink(p) ? 'ml' : 'g');
  state.weightTarget = { meal: mealKey, index, unit };
  $('#weight-name').textContent = p.name;
  setUnitUI(unit);
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

/* Переключение г ↔ мл: значение пересчитывается через плотность продукта,
   поэтому калорийность остаётся той же при смене единицы */
function setWeightUnit(next) {
  if (!state.weightTarget || next === state.weightTarget.unit) return;
  const item = dayEntries()[state.weightTarget.meal][state.weightTarget.index];
  const p = PRODUCT_MAP.get(item.id);
  if (!p) return;
  const cur = Number(weightInput.value) || 0;
  const density = drinkDensity(p);
  const converted = next === 'ml' ? cur / density : cur * density;
  weightInput.value = Math.max(1, Math.round(converted));
  state.weightTarget.unit = next;
  setUnitUI(next);
  updateWeightHint();
}

function updateWeightHint() {
  if (!state.weightTarget || !weightInput) return;
  const item = dayEntries()[state.weightTarget.meal][state.weightTarget.index];
  const p = PRODUCT_MAP.get(item.id);
  if (!p) return;
  const amount = Math.max(Number(weightInput.value) || 0, 0);
  $('#weight-kcal').textContent = `${calcPortion(p, amount, state.weightTarget.unit).kcal} ккал`;
}

function saveWeight() {
  if (!state.weightTarget) return;
  const amount = Math.min(Math.max(Math.round(Number(weightInput.value) || 0), 0), 5000);
  const item = dayEntries()[state.weightTarget.meal][state.weightTarget.index];
  if (amount > 0) {
    item.weight = amount;
    item.unit = state.weightTarget.unit;
    pushHistory(item.id, amount, item.unit);
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
  renderDate(); renderMeals(); renderSummary();
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
  const plan = computePlanData({ ...p, pace: p.paceKgWeek });
  $('#summary-goal').textContent = GOAL_LABELS[p.goal] || 'Цель';
  $('#summary-height').textContent = `${trimNum(p.heightCm)} см`;
  $('#summary-weight').textContent = `${trimNum(p.weightKg)} кг`;
  $('#summary-target').textContent = `${trimNum(p.targetKg)} кг`;
  $('#summary-pace').textContent = `${trimNum(p.paceKgWeek)} кг/нед`;
  $('#summary-pace-sub').textContent = paceCaption(p.paceKgWeek);
  $('#summary-activity').textContent = ACTIVITY_LABELS[p.activity] || '—';
  $('#summary-date').textContent = plan.days > 0 ? fmtFullDate(plan.finish) : 'Уже достигнута';
  $('#summary-note').textContent = `Калории: ${plan.targetKcal.toLocaleString('ru-RU')} ккал/день · Вода: ${trimNum(plan.waterL)} л/день`;
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
    LOG('Выход из аккаунта выполнен.');
  });
  $('#goal-btn').addEventListener('click', wizardOpen);
  $('#summary-setup')?.addEventListener('click', wizardOpen);
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

const wizardData = { goal: null, sex: null, birth: { day: 1, month: 1, year: 2000 }, height: 170, weight: 70, target: 65, activity: null, pace: 0.5 };
let wizardStep = 1, wheelsReady = false, lastPlan = null;
const wheels = new Map();
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const computeAge = (birth) => {
  const now = new Date();
  let age = now.getFullYear() - birth.year;
  const d = now.getMonth() + 1 - birth.month;
  if (d < 0 || (d === 0 && now.getDate() < birth.day)) age--;
  return Math.max(10, Math.min(100, age));
};
function computeEnergy(d) {
  const age = computeAge(d.birth);
  const bmr = d.sex === 'male'
    ? 10 * d.weightKg + 6.25 * d.heightCm - 5 * age + 5
    : 10 * d.weightKg + 6.25 * d.heightCm - 5 * age - 161;
  return { age, bmr, tdee: bmr * (ACTIVITY_FACTORS[d.activity] ?? 1.2) };
}

/* Единый расчёт: темп ровно как выбрал пользователь, дата с годом */
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
const readWheels = () => ({
  birth: { day: wheels.get('b-day').get(), month: wheels.get('b-month').get(), year: wheels.get('b-year').get() },
  heightCm: wheels.get('h-int').get() + wheels.get('h-dec').get() / 10,
  weightKg: wheels.get('w-int').get() + wheels.get('w-dec').get() / 10,
  targetKg: wheels.get('t-int').get() + wheels.get('t-dec').get() / 10,
});
function computePlan() {
  const rw = readWheels();
  const plan = computePlanData({ sex: wizardData.sex || 'female', birth: rw.birth, heightCm: rw.heightCm, weightKg: rw.weightKg, targetKg: rw.targetKg, activity: wizardData.activity, pace: wizardData.pace });
  return { ...plan, rw, current: rw.weightKg, target: rw.targetKg, diff: rw.weightKg - rw.targetKg };
}

const trimNum = (n) => { const s = Number(n).toFixed(1); return s.endsWith('.0') ? s.slice(0, -2) : s.replace('.', ','); };
const paceCaption = (v) => v <= 0.2 ? 'Надежно' : v <= 0.4 ? 'Умеренно' : v <= 0.6 ? 'Сбалансировано' : v <= 0.8 ? 'Заметно' : 'Быстро';

/* ---- Колесо выбора ---- */
function createWheel(host, values, initial, format) {
  const viewport = document.createElement('div');
  viewport.className = 'wheel__viewport';
  viewport.tabIndex = 0;
  const pad = () => { const p = document.createElement('div'); p.className = 'wheel__pad'; p.style.height = `${(WHEEL_ITEM_H * (WHEEL_VISIBLE - 1)) / 2}px`; return p; };
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
    paint(); clearTimeout(snapTimer);
    snapTimer = setTimeout(() => scrollToIndex(Math.round(viewport.scrollTop / WHEEL_ITEM_H)), 120);
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
  $$('.wizard__step').forEach((s) => { s.hidden = Number(s.dataset.step) !== step; });
  const fill = $('#wizard-progress');
  if (fill) fill.style.width = `${(step / WIZARD_TOTAL) * 100}%`;
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
  ensureWheels(); syncWheels();
  const slider = $('#pace-slider');
  if (slider) slider.value = String(wizardData.pace);
  updatePaceUI();
  root.hidden = false; document.body.classList.add('no-scroll');
  wizardGo(1);
}
function wizardClose() {
  const root = $('#goal-wizard');
  if (!root) return;
  root.hidden = true; document.body.classList.remove('no-scroll');
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

/* ---- График прогноза: тонкая линия по неделям ---- */
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
const smoothPathUnused = null; // совместимость

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
  const rw = plan.rw;
  const profile = {
    goal: wizardData.goal, sex: wizardData.sex, birth: { ...rw.birth },
    heightCm: rw.heightCm, weightKg: rw.weightKg, targetKg: rw.targetKg,
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
  LOG('Цели обновлены →', dbKey(state.uid, 'goals'), '| ккал:', state.goals.kcal, '| вода:', state.goals.waterL);
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

  if (modalEl) {
    modalEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-modal-close]')) { closeModal(); return; }
      const tab = e.target.closest('.modal__tab');
      if (tab) { switchTab(tab.dataset.tab); return; }
      const itemBtn = e.target.closest('.modal__item-btn');
      if (itemBtn) toggleProduct(itemBtn);
    });
    modalSave.addEventListener('click', saveSelection);
    modalSearch.addEventListener('input', () => { state.modalQuery = modalSearch.value; renderModalList(); });
    $('#modal-search-clear')?.addEventListener('click', () => { modalSearch.value = ''; state.modalQuery = ''; renderModalList(); modalSearch.focus(); });
  }
  
  if (weightModal) {
    weightModal.addEventListener('click', (event) => {
      if (event.target.closest('[data-weight-close]')) { closeWeightModal(); return; }
      const unitBtn = event.target.closest('.unit-switch__btn');
      if (unitBtn) setWeightUnit(unitBtn.dataset.unit);
    });
    weightInput.addEventListener('input', updateWeightHint);
    $('#weight-save')?.addEventListener('click', saveWeight);
  }
  $('#diary-prev')?.addEventListener('click', () => shiftDay(-1));
  $('#diary-next')?.addEventListener('click', () => shiftDay(1));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (weightModal && !weightModal.hidden) closeWeightModal();
    else if (modalEl && !modalEl.hidden) closeModal();
  });
}

window.addEventListener('pageshow', () => { applyTheme(getTheme()); switchScope(); renderProfile(); rerenderAll(); });
window.addEventListener('storage', () => { applyTheme(getTheme()); switchScope(); renderProfile(); rerenderAll(); });

/* Старт */
initSidebar();
initTodayDate();
initDiaryEvents();
initAuth();
initWizard();
rerenderAll();