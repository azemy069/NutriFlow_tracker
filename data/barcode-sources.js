/* ==========================================================================
   NUTRIFLOW · ПОИСК ТОВАРОВ ПО ШТРИХКОДУ (версия 3)
   Правила достоверности:
   КБЖУ автоматически подставляются ТОЛЬКО при точном совпадении кода.
   Поиск по названию никогда не подставляет КБЖУ молча — он возвращает
   список кандидатов, среди которых выбирает пользователь.
   Приоритет — товары, продающиеся в России, и русские названия.
   Код проверяется во всех нормализациях: EAN-13, EAN-8, UPC-A, ITF-14.

   ИСПРАВЛЕНО В ВЕРСИИ 3:
   · Open Food Facts API v2 отдаёт status:"success" (v0/v1 отдавали 1).
     Теперь принимаются оба варианта — точный поиск по коду снова работает.
   · Имя товара ищется и в языковых полях (en/de/fr/es/it/pl/uk),
     поэтому вместо «Товар 7622201706289» подставляется настоящее название.
   · Безымянные записи без КБЖУ не попадают в кандидаты и не блокируют
     дальнейшие источники каскада.
   ========================================================================== */
'use strict';

const BarcodeSources = (() => {
  const HOSTS = {
    food: 'https://world.openfoodfacts.org',
    foodRu: 'https://ru.openfoodfacts.org',
    products: 'https://world.openproductsfacts.org',
    beauty: 'https://world.openbeautyfacts.org',
    pet: 'https://world.openpetfoodfacts.org',
  };

  /* Языковые варианты имени добавлены: у части товаров OFF имя лежит
     только в product_name_en/de/… , а не в product_name_ru/product_name */
  const FIELDS = 'code,product_name,product_name_ru,generic_name,generic_name_ru,brands,'
    + 'product_name_en,product_name_de,product_name_fr,product_name_es,product_name_it,product_name_pl,product_name_uk,'
    + 'nutriments,serving_quantity,serving_size,product_quantity,quantity,categories_tags,'
    + 'countries_tags,stores,image_front_small_url';

  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const norm = (s) => clean(s).toLowerCase().replace(/ё/g, 'е');

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const usdaKey = () => lsGet('nutriflow.usdaKey') || 'DEMO_KEY';
  const isDebug = () => /[?&]debug=1/.test(location.search) || lsGet('nutriflow.bcDebug') === '1';

  let trace = [];
  const mark = (source, status, note, t0) => {
    trace.push({ source, status, note: note || '', ms: Math.round(performance.now() - t0) });
  };

  async function fetchJSON(url, ms = 9000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
      return await res.json();
    } catch (e) {
      if (e.name === 'AbortError') { const t = new Error('таймаут'); t.status = 408; throw t; }
      throw e;
    } finally { clearTimeout(timer); }
  }

  /* ---------- Нормализации штрихкода ---------- */
  const codeVariants = (raw) => {
    const d = digits(raw);
    const set = new Set();
    if (d) set.add(d);
    const noLead = d.replace(/^0+/, '');
    if (noLead.length >= 8) set.add(noLead);
    if (d.length === 12) set.add('0' + d);
    if (d.length === 13 && d[0] === '0') set.add(d.slice(1));
    if (d.length === 14 && d[0] === '0') set.add(d.slice(1));
    if (d.length === 8) set.add('00000' + d);
    return [...set].filter((x) => x.length >= 8 && x.length <= 14);
  };

  /* ---------- Масса упаковки и штуки из строки ---------- */
  function parseQty(txt) {
    const t = norm(txt).replace(',', '.');
    const multi = t.match(/(\d+)\s*(?:[x×*]|по)\s*(\d+(?:\.\d+)?)\s*(мл|ml|гр|г|g)/);
    if (multi) {
      const n = num(multi[1]);
      const each = num(multi[2]);
      const ml = /мл|ml/.test(multi[3]);
      if (n > 0 && each > 0) return { pack: Math.round(n * each * 10) / 10, piece: each, unit: ml ? 'ml' : 'g' };
    }
    const m = t.match(/(\d+(?:\.\d+)?)\s*(кг|kg|мл|ml|л|l|гр|г|g)\b/);
    if (m) {
      let v = num(m[1]);
      const u = m[2];
      const ml = /мл|ml/.test(u) || (/л|l/.test(u) && !/мл|ml/.test(u));
      if (/кг|kg/.test(u)) v *= 1000;
      else if (/^(л|l)$/.test(u)) v *= 1000;
      return { pack: Math.round(v * 10) / 10, piece: 0, unit: ml ? 'ml' : 'g' };
    }
    return { pack: 0, piece: 0, unit: 'g' };
  }
  const gramsFromText = (txt) => parseQty(txt).pack;

  /* ---------- КБЖУ: строго на 100 г, пересчёт с порции ---------- */
  function per100(n, key, servingG) {
    const direct = num(n[key + '_100g']);
    if (direct > 0) return direct;
    const byServing = num(n[key + '_serving']);
    if (byServing > 0 && servingG > 0) return Math.round((byServing * 100 / servingG) * 10) / 10;
    return 0;
  }

  const STOP = new Set(['и', 'с', 'со', 'без', 'для', 'в', 'во', 'на', 'из', 'по', 'the', 'and', 'with',
    'г', 'гр', 'мл', 'кг', 'л', 'g', 'ml', 'kg', 'l', 'шт', 'упаковка', 'пачка', 'батончик', 'шоколад']);
  const tokens = (s) => norm(s).split(/[^a-zа-я0-9%]+/).filter((w) => w.length > 1 && !STOP.has(w));
  const drinkTags = (tags) => Array.isArray(tags) && tags.some((t) => /^en:(beverages|drinks|sodas|juices|waters|milks|teas|coffees|dairy-drinks|plant-based-beverages|fermented-milks|yogurts)/.test(String(t)));
  const isRussia = (pr) => Array.isArray(pr.countries_tags) && pr.countries_tags.some((t) => /russia|russian-federation/.test(String(t)));

  function fullNameOf(brand, name, generic, qty) {
    let base = clean(name) || clean(generic);
    if (!base) return '';
    if (brand && !norm(base).includes(norm(brand))) base = clean(brand) + ' ' + base;
    const g = clean(generic);
    if (g && g.length < 70 && norm(g) !== norm(name) && !norm(base).includes(norm(g))) base += ' — ' + g;
    if (qty && !norm(base).includes(norm(qty))) base += ', ' + clean(qty);
    return clean(base).slice(0, 140);
  }

  /* ---------- Приведение записи Open Food Facts ---------- */
  function fromOFF(pr, source) {
    const n = pr.nutriments || {};
    const qty = parseQty(pr.quantity);
    const servingG = num(pr.serving_quantity) || gramsFromText(pr.serving_size);

    let kcal = per100(n, 'energy-kcal', servingG);
    if (!kcal) {
      const kj = per100(n, 'energy-kj', servingG) || num(n['energy_100g']);
      if (kj > 0) kcal = Math.round(kj / 4.184);
    }
    const p = per100(n, 'proteins', servingG);
    const f = per100(n, 'fat', servingG);
    const c = per100(n, 'carbohydrates', servingG);

    const brand = clean(String(pr.brands || '').split(',')[0]);
    const nameRu = clean(pr.product_name_ru);
    const nameAny = clean(pr.product_name);
    /* Имя может лежать только в иностранном языковом поле */
    const nameLang = clean(pr.product_name_en || pr.product_name_de || pr.product_name_fr
      || pr.product_name_es || pr.product_name_it || pr.product_name_pl || pr.product_name_uk);
    const generic = clean(pr.product_name_ru ? pr.generic_name_ru : pr.generic_name) || clean(pr.generic_name_ru);
    const name = nameRu || nameAny || nameLang || generic;
    const nameReal = Boolean(name);

    const pack = num(pr.product_quantity) || qty.pack;
    let piece = qty.piece;
    const servingPieces = (() => {
      const m = norm(pr.serving_size).match(/(\d+)\s*(?:шт|pieces?|pcs?|пирожн|батончик|порц)/);
      return m ? num(m[1]) : 0;
    })();
    if (!piece && servingG > 0 && servingG < 2000) piece = servingPieces > 1 ? Math.round(servingG / servingPieces * 10) / 10 : servingG;
    if (!piece && pack > 0 && servingPieces > 1) piece = Math.round(pack / servingPieces * 10) / 10;
    if (piece && pack && piece > pack) piece = 0;

    const unit = qty.unit === 'ml' || drinkTags(pr.categories_tags) ? 'ml' : 'g';

    return {
      id: null,
      code: digits(pr.code),
      name: name || 'Товар ' + digits(pr.code),
      nameReal,
      brand,
      fullName: fullNameOf(brand, name, generic, clean(pr.quantity)) || name,
      kcal, p, f, c,
      piece: piece || 0,
      pack: pack || 0,
      unit,
      ru: isRussia(pr),
      image: pr.image_front_small_url || '',
      hasNutrition: kcal > 0 || p > 0 || f > 0 || c > 0,
      searchText: [brand, nameRu, nameAny, nameLang, generic, pr.quantity].filter(Boolean).join(' '),
      source,
    };
  }

  async function offByCode(host, code, source) {
    const data = await fetchJSON(`${host}/api/v2/product/${code}.json?fields=${FIELDS}&lc=ru`, 9000);
    /* API v2 отдаёт status:"success", v0/v1 отдавали 1 — принимаем оба,
       иначе точный поиск по коду всегда считался «пусто». */
    const ok = data.status === 1 || String(data.status).startsWith('success');
    if (!ok || !data.product) return null;
    const item = fromOFF(data.product, source);
    /* Без имени и без КБЖУ товар бесполезен — пускаем каскад дальше */
    return (item.hasNutrition || item.nameReal) ? item : null;
  }

  async function offSearch(query, { ru = true, limit = 14 } = {}) {
    const params = new URLSearchParams({
      search_terms: query, search_simple: '1', action: 'process',
      json: '1', page_size: String(limit), fields: FIELDS, lc: 'ru',
    });
    if (ru) params.set('countries_tags_en', 'russia');
    const data = await fetchJSON(`${HOSTS.food}/cgi/search.pl?${params.toString()}`, 11000);
    const arr = Array.isArray(data.products) ? data.products : [];
    /* Безымянные «Товар CODE» в кандидаты не пускаем */
    return arr.map((pr) => fromOFF(pr, 'Open Food Facts')).filter((x) => x.nameReal);
  }

  /* ---------- UPCitemdb: только название и бренд, без КБЖУ ---------- */
  async function upcitemdb(code) {
    const data = await fetchJSON(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`, 9000);
    const item = Array.isArray(data.items) ? data.items[0] : null;
    if (!item) return null;
    const title = clean(item.title);
    if (!title) return null;
    const qty = parseQty(title + ' ' + clean(item.size));
    return {
      code, name: title, brand: clean(item.brand), fullName: title,
      kcal: 0, p: 0, f: 0, c: 0,
      piece: qty.piece, pack: qty.pack, unit: qty.unit,
      hasNutrition: false, searchText: title + ' ' + clean(item.brand),
      source: 'UPCitemdb',
    };
  }

  /* ---------- USDA: американские бренды, только точный GTIN ---------- */
  function fromUSDA(hit) {
    const list = Array.isArray(hit.foodNutrients) ? hit.foodNutrients : [];
    const take = (nameRe, unitRe) => {
      const it = list.find((x) => nameRe.test(String(x.nutrientName || '')) && unitRe.test(String(x.unitName || '')));
      return num(it && it.value);
    };
    const kcal = take(/^Energy$/i, /^KCAL$/i) || take(/Energy \(Atwater/i, /^KCAL$/i);
    const p = take(/^Protein$/i, /^G$/i);
    const f = take(/^Total lipid \(fat\)$/i, /^G$/i);
    const c = take(/^Carbohydrate, by difference$/i, /^G$/i);
    const qty = parseQty(hit.packageWeight || hit.servingSize);
    const brand = clean(hit.brandOwner || hit.brandName);
    const name = clean(hit.description);
    return {
      id: null, code: digits(hit.gtinUpc), name, brand,
      fullName: fullNameOf(brand, name, '', clean(hit.packageWeight)),
      kcal, p, f, c, piece: 0, pack: qty.pack, unit: qty.unit,
      hasNutrition: kcal > 0 || p > 0 || f > 0 || c > 0,
      searchText: [brand, name, hit.packageWeight].filter(Boolean).join(' '),
      source: 'USDA FoodData Central',
    };
  }

  async function usdaByCode(code) {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(code)}`
      + `&dataType=Branded&pageSize=10&api_key=${encodeURIComponent(usdaKey())}`;
    const data = await fetchJSON(url, 10000);
    const foods = Array.isArray(data.foods) ? data.foods : [];
    const exact = foods.find((f) => codeVariants(f.gtinUpc).includes(code));
    return exact ? fromUSDA(exact) : null;
  }

  /* ---------- Оценка похожести: вариант и масса важнее всего ---------- */
  function scoreCandidate(query, cand, expectPack) {
    const qt = tokens(query);
    if (!qt.length) return 0;
    const ct = new Set(tokens(cand.searchText));
    let hit = 0;
    qt.forEach((w) => { if (ct.has(w)) hit++; });
    let s = hit / qt.length;
    const missing = qt.filter((w) => w.length > 3 && !ct.has(w));
    s -= missing.length * 0.22;
    if (expectPack > 0 && cand.pack > 0) {
      s += Math.abs(cand.pack - expectPack) < 1 ? 0.3 : -0.35;
    }
    if (cand.ru) s += 0.12;
    if (cand.hasNutrition) s += 0.1;
    return Math.round(s * 100) / 100;
  }

  async function collectCandidates(query, expectPack, limit) {
    const seen = new Set();
    let pool = [];
    const push = (arr) => arr.forEach((x) => {
      const key = x.code || norm(x.fullName);
      if (!seen.has(key)) { seen.add(key); pool.push(x); }
    });
    try { push(await offSearch(query, { ru: true, limit: 20 })); } catch { /* источник недоступен */ }
    if (pool.length < 6) {
      try { push(await offSearch(query, { ru: false, limit: 20 })); } catch { /* источник недоступен */ }
    }
    return pool
      .map((x) => ({ ...x, score: scoreCandidate(query, x, expectPack) }))
      .filter((x) => x.score > 0.15)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /* ---------- Основной каскад ---------- */
  async function lookup(rawCode, opts = {}) {
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
    const code = digits(rawCode);
    const variants = codeVariants(code);
    trace = [];
    const TOTAL = 5;
    let step = 0;

    const run = async (label, fn) => {
      const t0 = performance.now();
      try {
        const r = await fn();
        mark(label, r ? 'найдено' : 'пусто', r && r.source ? r.source : '', t0);
        return r;
      } catch (e) {
        mark(label, e.status === 429 ? 'лимит' : 'ошибка', e.message, t0);
        return null;
      }
    };
    const finish = (res) => {
      if (isDebug()) {
        console.log('%c[NutriFlow] код', 'color:#2f7fd6;font-weight:bold', code);
        console.table(trace);
      }
      return res;
    };

    /* Шаг 1. Точный код в пищевой базе (русский домен, затем мировой) */
    onProgress(++step, TOTAL);
    let exact = null;
    for (const host of [HOSTS.foodRu, HOSTS.food]) {
      for (const v of variants) {
        exact = await run('Open Food Facts · точный код', () => offByCode(host, v, 'Open Food Facts'));
        if (exact) break;
      }
      if (exact) break;
    }
    if (exact && exact.hasNutrition) {
      return finish({ ...exact, code, exact: true, needsChoice: false, candidates: [] });
    }

    /* Шаг 2. Точный код в смежных базах */
    onProgress(++step, TOTAL);
    for (const [host, label] of [[HOSTS.products, 'Open Products Facts'], [HOSTS.beauty, 'Open Beauty Facts'], [HOSTS.pet, 'Open Pet Food Facts']]) {
      for (const v of variants) {
        const hit = await run(label + ' · точный код', () => offByCode(host, v, label));
        if (hit && hit.hasNutrition) return finish({ ...hit, code, exact: true, needsChoice: false, candidates: [] });
        if (hit && !exact) exact = hit;
      }
    }

    /* Шаг 3. Название по точному коду из товарного справочника */
    onProgress(++step, TOTAL);
    let titled = null;
    for (const v of variants) {
      titled = await run('UPCitemdb · точный код', () => upcitemdb(v));
      if (titled) break;
    }
    const known = exact || titled;
    const query = known ? [known.brand, known.name].filter(Boolean).join(' ') : '';
    const expectPack = known ? num(known.pack) : 0;

    /* Шаг 4. Кандидаты: сначала российские товары. КБЖУ не подставляем! */
    onProgress(++step, TOTAL);
    let candidates = [];
    if (query) {
      candidates = await run('Кандидаты · товары России', () => collectCandidates(query, expectPack, 12));
      if (!candidates) candidates = [];
    }
    if (!candidates.length) {
      const byCode = await run('Поиск по цифрам кода', () => collectCandidates(code, 0, 8));
      if (byCode) candidates = byCode;
    }

    /* Шаг 5. Американская база — только точный GTIN */
    onProgress(++step, TOTAL);
    const us = await run('USDA · точный код', () => usdaByCode(code));
    if (us && us.hasNutrition) return finish({ ...us, code, exact: true, needsChoice: false, candidates: [] });

    return finish({
      code,
      name: known ? known.name : '',
      brand: known ? known.brand : '',
      fullName: known ? known.fullName : '',
      kcal: 0, p: 0, f: 0, c: 0,
      piece: known ? num(known.piece) : 0,
      pack: expectPack,
      unit: known && known.unit === 'ml' ? 'ml' : 'g',
      hasNutrition: false,
      exact: false,
      needsChoice: candidates.length > 0,
      candidates,
      query,
    });
  }

  /* ---------- Поиск по названию: российские позиции первыми ---------- */
  async function search(query, { limit = 14, expectPack = 0 } = {}) {
    const q = clean(query);
    if (q.length < 3) return [];
    const list = await collectCandidates(q, expectPack, limit);
    if (isDebug()) console.table(list.map((x) => ({ name: x.fullName, kcal: x.kcal, pack: x.pack, score: x.score })));
    return list;
  }

  return { lookup, search, isDebug, lastTrace: () => trace.slice(), codeVariants };
})();