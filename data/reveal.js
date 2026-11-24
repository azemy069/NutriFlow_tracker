/* ==========================================================================
   NutriFlow · REVEAL «КАСКАД СБОКУ» (версия 4, самонастраивающаяся)
   Подключение: <head>, сразу после styles.css, БЕЗ defer/async.

   Блоки находятся ДВУМЯ способами одновременно:
   1) по знакомым классам страниц;
   2) автоматически — вложенность контента любой страницы.
   Поэтому главная и статистика анимируются так же, как дневник и планировщик,
   даже если их разметка отличается от ожидаемой.
   ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
     НАСТРОЙКИ АНИМАЦИИ — крути только эти числа
     ====================================================================== */
  var RISE_MS   = 850;    // длительность вылета и поворота, мс
  var FADE_MS   = 500;    // длительность проявления, мс
  var BLUR_MS   = 460;    // длительность снятия размытия, мс
  var BLUR_PX   = 6;      // стартовое размытие, px (0 — без размытия)
  var STEP_MS   = 80;     // задержка между соседними блоками, мс
  var CAP_MS    = 480;    // предел задержки каскада, мс
  var SHIFT_X   = 46;     // горизонтальный сдвиг старта, px
  var SHIFT_Y   = 18;     // вертикальный сдвиг старта, px
  var TILT_DEG  = 1.4;    // стартовый наклон, градусы
  var SCALE     = 0.975;  // стартовый масштаб
  var EASE_MOVE = 'cubic-bezier(.2,.9,.24,1.03)';
  var EASE_FADE = 'ease-out';
  var GUARD_MS  = 2500;   // страховка: показать всё, если запуск не удался
  /* ====================================================================== */

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;

  var root = document.documentElement;

  /* --- 1. Селекторы: каждый проверяется отдельно, битые отбрасываются --- */
  var KNOWN_RAW = [
    '[data-reveal]',
    '.article__lead', '.article__hero', '.article__body', '.stats-band',
    '.feature', '.story-card', '.cta-band', '.section__title',
    '.diary__header', '.diary__summary', '.meal-card',
    '.water__summary', '.water__card', '.water__log', '.photos',
    '.auth', '.profile__head', '.profile-summary', '.profile__body > *',
    '.pl__head', '.pl-cell', '.pl-day', '.ai',
    '.st__head', '.st-tile', '.st-card', '.st-disclaimer',
    '.site-footer'
  ];
  var GENERIC_RAW = ['.content > * > *', 'main > * > *'];

  function valid(sel) {
    try { document.querySelector(sel); return true; } catch (e) { return false; }
  }
  var KNOWN = KNOWN_RAW.filter(valid);
  var GENERIC = GENERIC_RAW.filter(valid);
  var ALL = KNOWN.concat(GENERIC);
  if (!ALL.length) return;

  var SEL_ALL = ALL.join(',');
  var supportsWhere = !!(window.CSS && CSS.supports && CSS.supports('selector(:where(a))'));

  /* --- 2. Стили: скрытие с нулевым весом, раскрытие всегда сильнее --- */
  var HIDE =
    'opacity:0;' +
    'transform:translate3d(var(--rv-x,-' + SHIFT_X + 'px),' + SHIFT_Y + 'px,0)' +
    ' rotate(var(--rv-r,-' + TILT_DEG + 'deg)) scale(' + SCALE + ');' +
    'filter:blur(' + BLUR_PX + 'px);';

  var css = '.rv-on .reveal{animation:none !important;}';
  if (supportsWhere) css += '.rv-on :where(' + SEL_ALL + '){' + HIDE + '}';
  css +=
    '.rv-on .rv{' + HIDE + '}' +
    '.rv-on .rv:not(.rv-done){' +
      'transition:opacity ' + FADE_MS + 'ms ' + EASE_FADE + ',' +
      'transform ' + RISE_MS + 'ms ' + EASE_MOVE + ',' +
      'filter ' + BLUR_MS + 'ms ' + EASE_FADE + ';' +
      'will-change:opacity,transform,filter;' +
    '}' +
    '.rv-on .rv-in,.rv-on .rv-done{opacity:1;transform:none;filter:none}';

  var style = document.createElement('style');
  style.id = 'rv-style';
  style.textContent = css;
  (document.head || root).appendChild(style);
  root.classList.add('rv-on');

  var managed = new WeakSet();
  var nodes = [];
  var io = null;
  var booted = false;
  var bootAt = 0;

  /* --- 3. Аварийный показ: контент не может остаться невидимым --- */
  function revealEverything() {
    try {
      var all = [].slice.call(document.querySelectorAll(SEL_ALL + ',.rv'));
      all.forEach(function (el) {
        el.classList.add('rv-done');
        el.classList.remove('rv', 'rv-in');
        el.style.removeProperty('transition');
        el.style.removeProperty('transition-delay');
        el.style.removeProperty('will-change');
        el.style.removeProperty('--rv-x');
        el.style.removeProperty('--rv-r');
      });
    } catch (e) { /* снимаем режим целиком */ }
    root.classList.remove('rv-on');
    if (io) { try { io.disconnect(); } catch (e) {} io = null; }
  }
  var guard = setTimeout(function () { if (!booted) revealEverything(); }, GUARD_MS);
  window.addEventListener('error', function () { if (!booted) revealEverything(); });

  function finish(el) {
    if (el.dataset.rvDone === '1') return;
    el.dataset.rvDone = '1';
    el.classList.remove('rv', 'rv-in');
    el.classList.add('rv-done');
    el.style.removeProperty('transition');
    el.style.removeProperty('transition-delay');
    el.style.removeProperty('will-change');
    el.style.removeProperty('--rv-x');
    el.style.removeProperty('--rv-r');
  }

  function show(el, delay) {
    if (el.dataset.rvStarted === '1') return;
    el.dataset.rvStarted = '1';
    el.style.transitionDelay = delay + 'ms';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add('rv-in'); });
    });
    var done = function (ev) {
      if (ev.target !== el || ev.propertyName !== 'transform') return;
      finish(el);
      el.removeEventListener('transitionend', done);
    };
    el.addEventListener('transitionend', done);
    setTimeout(function () {
      finish(el);
      el.removeEventListener('transitionend', done);
    }, delay + RISE_MS + 600);
  }

  function prep(el, i) {
    var left = i % 2 === 0;
    el.style.setProperty('--rv-x', (left ? -SHIFT_X : SHIFT_X) + 'px');
    el.style.setProperty('--rv-r', (left ? -TILT_DEG : TILT_DEG) + 'deg');
    el.classList.add('rv');
    managed.add(el);
  }

  /* --- 4. Перерисованный контент показываем сразу, без мигания --- */
  function watchDynamic() {
    if (!('MutationObserver' in window)) return;
    new MutationObserver(function (records) {
      records.forEach(function (r) {
        [].forEach.call(r.addedNodes, function (n) {
          if (n.nodeType !== 1) return;
          var list = [];
          try {
            if (n.matches && n.matches(SEL_ALL)) list.push(n);
            if (n.querySelectorAll) list = list.concat([].slice.call(n.querySelectorAll(SEL_ALL)));
          } catch (e) { return; }
          list.forEach(function (el) {
            if (managed.has(el)) return;
            managed.add(el);
            if (booted && io && el.getClientRects().length) {
              prep(el, nodes.length);
              nodes.push(el);
              io.observe(el);
            } else {
              el.classList.add('rv-done');
            }
          });
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  /* Служебные и невидимые узлы никогда не анимируем */
  function usable(el) {
    if (!el.getClientRects().length) return false;
    if (el.closest('[hidden]')) return false;
    if (el.closest('.modal, .wizard, .st-drawer-wrap, .sidebar, .topbar, .bg-aura')) return false;
    var tag = el.tagName;
    return tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'LINK' && tag !== 'TEMPLATE';
  }

  function collect() {
    var pool = [];
    try { pool = [].slice.call(document.querySelectorAll(SEL_ALL)); } catch (e) { pool = []; }
    pool = pool.filter(usable);

    /* убираем обёртки, внутри которых есть свои блоки — иначе двойная анимация */
    var targets = pool.filter(function (el) {
      return !pool.some(function (other) { return other !== el && el.contains(other); });
    });

    /* всё, что скрыто правилом, но не анимируется — показываем немедленно */
    pool.forEach(function (el) {
      if (targets.indexOf(el) === -1 && !managed.has(el)) {
        managed.add(el);
        el.classList.add('rv-done');
      }
    });
    return targets;
  }

  function init() {
    try {
      nodes = collect();
      if (!nodes.length) {
        booted = true;
        clearTimeout(guard);
        watchDynamic();
        return;
      }

      nodes.forEach(function (el, i) { prep(el, i); });

      io = new IntersectionObserver(function (entries) {
        entries.filter(function (e) { return e.isIntersecting; })
          .map(function (e) { return e.target; })
          .sort(function (a, b) { return nodes.indexOf(a) - nodes.indexOf(b); })
          .forEach(function (el, i) {
            io.unobserve(el);
            show(el, Math.min(i * STEP_MS, CAP_MS));
          });
      }, { threshold: 0.06, rootMargin: '0px 0px -5% 0px' });

      nodes.forEach(function (el) { io.observe(el); });
      watchDynamic();
      booted = true;
      bootAt = performance.now();
      clearTimeout(guard);

      /* поздняя страховка: всё, что видно на экране, но ещё скрыто — показать */
      setTimeout(function () {
        nodes.forEach(function (el) {
          if (el.dataset.rvDone === '1' || el.dataset.rvStarted === '1') return;
          var r = el.getBoundingClientRect();
          if (r.bottom > 0 && r.top < (window.innerHeight || 800)) finish(el);
        });
      }, 4000);
    } catch (e) { revealEverything(); }
  }

  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    nodes.forEach(finish);
    try {
      [].slice.call(document.querySelectorAll(SEL_ALL)).forEach(function (el) {
        if (!managed.has(el)) { managed.add(el); el.classList.add('rv-done'); }
      });
    } catch (err) {}
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();