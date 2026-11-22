/* ==========================================================================
   NutriFlow — раннее применение темы
   Вставляется в <head> ПЕРЕД styles.css, чтобы тёмная тема применялась
   до первого кадра и страницы не «вспыхивали» светлой темой.
   ========================================================================== */
(function () {
  'use strict';
  var theme = 'light';
  try {
    if (localStorage.getItem('nutriflow.theme') === 'dark') theme = 'dark';
  } catch (e) { /* localStorage недоступен — остаётся светлая */ }
  document.documentElement.dataset.theme = theme;
})();