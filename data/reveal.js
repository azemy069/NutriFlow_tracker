/* ==========================================================================
   NutriFlow — плавный вылет блоков при заходе на страницу (версия 2)
   Эффект «стеклянный фокус-ин»: блок поднимается снизу, чуть увеличивается
   и «проявляется» из размытия с мягким пружинным перелётом.
   Каскад: каждый следующий блок стартует чуть позже предыдущего,
   причём вылетают не только крупные секции, но и плитки/карточки внутри них.
   Подключать последним скриптом: <script src="data/reveal.js"></script>
   ========================================================================== */
(function () {
  'use strict';

  /* Уважение к «уменьшить движение» и страховка для старых браузеров */
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!('IntersectionObserver' in window)) return;

  /* Блоки и внутренние карточки, которые вылетают (порядок = порядок в DOM) */
  var SELECTOR = [
    '[data-reveal]',
    '.article__lead', '.article__hero', '.stats-band', '.feature', '.cta-band',
    '.story-card',
    '.diary__header', '.diary__summary', '.meal-card', '.water', '.photos',
    '.auth', '.profile__head', '.profile-summary', '#profile-empty',
    '.pl__head', '.pl__strip', '.pl-day', '.pl__aside',
    '.st__head', '.st-tile', '.st-card',
    '.site-footer'
  ].join(', ');

  var STEP = 115;   // задержка между соседними блоками, мс
  var CAP  = 690;   // предел этой задержки, мс
  var LIFE = 1500;  // запас на очистку после самой длинной анимации, мс

  /* Стили инжектятся самим скриптом, чтобы не трогать styles.css */
  var styleEl = document.createElement('style');
  styleEl.textContent =
    '.rv{' +
      'opacity:0;' +
      'transform:translate3d(0,38px,0) scale(.958);' +
      'filter:blur(9px);' +
      'will-change:opacity,transform,filter;' +
      'transition:' +
        'opacity .85s cubic-bezier(.25,.6,.25,1),' +
        'transform 1.15s cubic-bezier(.18,.8,.26,1.04),' +
        'filter .85s cubic-bezier(.25,.6,.25,1);' +
    '}' +
    '.rv.rv-in{opacity:1;transform:translate3d(0,0,0) scale(1);filter:blur(0);}';
  document.head.appendChild(styleEl);

  function init() {
    var nodes = [].slice.call(document.querySelectorAll(SELECTOR)).filter(function (el) {
      /* пропускаем скрытые блоки и уже анимированные */
      return el.getClientRects().length > 0 && !el.classList.contains('rv');
    });
    if (!nodes.length) return;

    /* гасим нативную scroll-анимацию, чтобы не конфликтовала */
    nodes.forEach(function (el) {
      el.classList.remove('reveal');
      el.classList.add('rv');
    });

    var io = new IntersectionObserver(function (entries) {
      var batch = entries
        .filter(function (e) { return e.isIntersecting; })
        .map(function (e) { return e.target; })
        .sort(function (a, b) { return nodes.indexOf(a) - nodes.indexOf(b); });

      batch.forEach(function (el, i) {
        var delay = Math.min(i * STEP, CAP);
        el.style.transitionDelay = delay + 'ms';
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { el.classList.add('rv-in'); });
        });
        io.unobserve(el);

        /* после полёта возвращаем родные стили элемента:
           hover-переходы и стекло работают как раньше */
        var cleaned = false;
        var onEnd = function (ev) {
          if (ev.propertyName === 'transform') cleanup();
        };
        var cleanup = function () {
          if (cleaned) return;
          cleaned = true;
          el.classList.remove('rv', 'rv-in');
          el.style.transitionDelay = '';
          el.style.removeProperty('will-change');
          el.removeEventListener('transitionend', onEnd);
        };
        el.addEventListener('transitionend', onEnd);
        setTimeout(cleanup, delay + LIFE);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });

    nodes.forEach(function (el) { io.observe(el); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();