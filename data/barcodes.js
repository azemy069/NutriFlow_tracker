/* ==========================================================================
   NUTRIFLOW — ЛОКАЛЬНАЯ БАЗА ШТРИХКОДОВ (EAN-13)
   Штрихкод — точный ключ товара: поиск идёт по базе, а не через нейросеть.
   Поля записи:
     code            — штрихкод
     id              — ссылка на продукт из products.js (необязательно)
     name/brand      — название и бренд для самостоятельных товаров
     kcal/p/f/c      — КБЖУ на 100 г
     unit            — 'g' или 'ml' (базовая единица товара)
     piece           — масса ОДНОЙ ШТУКИ в граммах (если товар счётный)
     pack            — масса всей упаковки в граммах (если известна)
   ========================================================================== */
'use strict';

/* Контрольная сумма EAN-13 */
const eanCheckDigit = (base) => {
  const digits = String(base).split('').map(Number).reverse();
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
};

let bcSeq = 0;
const nextCode = () => {
  bcSeq += 1;
  const base = '460000000' + String(bcSeq).padStart(3, '0');
  return base + eanCheckDigit(base);
};
const map = (id) => ({ code: nextCode(), id });
const mapP = (id, piece, pack = 0) => ({ code: nextCode(), id, piece, pack });
const mapMl = (id) => ({ code: nextCode(), id, unit: 'ml' });
const own = (data) => ({ code: nextCode(), unit: 'g', ...data });

const BARCODES_DB = [
  /* Крупы, макароны, хлеб */
  map('buckwheat-dry'), map('buckwheat-boiled'), map('buckwheat-milk'),
  map('rice-dry'), map('rice-boiled'), map('rice-brown-dry'), map('rice-basmati-dry'),
  map('oatmeal-dry'), map('oatmeal-water'), map('oatmeal-milk'),
  map('semolina-milk'), map('millet-boiled'), map('barley-boiled'),
  map('bulgur-boiled'), map('quinoa-boiled'), map('couscous-boiled'),
  map('pasta-dry'), map('pasta-boiled'), map('spaghetti-dry'), map('spaghetti-bolog'),
  map('noodles-egg'), map('udon'), map('noodles-rice'), map('ramen-packet'),
  mapP('bread-rye', 35, 700), mapP('bread-wheat', 30, 500), mapP('bread-borodinsky', 35, 650),
  mapP('bread-whole', 32, 400), mapP('bread-crisp', 10, 100),
  mapP('lavash', 90, 180), mapP('pita', 60, 240), mapP('tortilla-wheat', 62, 250),
  mapP('baguette', 250), mapP('croissant', 60, 300), mapP('pancakes', 55, 330),
  mapP('syrniki', 50, 300),

  /* Мясо, колбасы, рыба */
  map('chicken-fillet-raw'), map('chicken-fillet-boil'), map('chicken-fillet-grill'),
  map('chicken-leg-boil'), map('turkey-fillet'), map('turkey-fillet-boil'),
  map('beef-boiled'), map('beef-grill'), map('pork-shashlik'), map('lamb-shashlik'),
  map('mince-beef'), map('mince-chicken'),
  mapP('cutlet-chicken', 90, 450), mapP('cutlet-pork', 100, 500),
  map('liver-chicken'),
  mapP('sausage-doktorskaya', 25, 400), mapP('frankfurter', 50, 400),
  mapP('ham', 20, 200), mapP('ham-turkey', 20, 200), map('bacon'), map('jamon-serrano'),
  map('cod-boiled'), map('pollock'), map('salmon-baked'), map('salmon-smoked'),
  map('trout'), map('tuna-can-own'), map('tuna-can-oil'), map('shrimp-boiled'),
  map('squid'), map('herring-salt'), map('caviar-red'),

  /* Молочное и яйца */
  mapMl('milk-05'), mapMl('milk-15'), mapMl('milk-25'), mapMl('milk-32'),
  mapMl('kefir-0'), mapMl('kefir-1'), mapMl('kefir-25'), mapMl('ryazhenka-32'),
  mapMl('cream-10'), mapMl('cream-20'),
  mapP('yogurt-natural', 125, 500), mapP('yogurt-fruit', 125, 500), mapP('yogurt-greek', 140),
  mapP('tvorog-0', 180), mapP('tvorog-2', 180), mapP('tvorog-5', 180),
  mapP('tvorog-9', 180), mapP('tvorog-18', 180),
  map('curd-cheese'), map('philadelphia'), map('ricotta'),
  map('sour-cream-10'), map('sour-cream-15'), map('sour-cream-20'),
  map('cheese-russian'), map('cheese-cheddar'), map('cheese-parmesan'),
  map('cheese-mozzarella'), map('cheese-feta'), map('butter'), map('ghee'),
  mapP('egg-chicken', 60, 600), mapP('egg-boiled', 60, 600),
  mapP('omelette', 150), mapP('eggs-scrambled', 150),

  /* Овощи, грибы, фрукты, бобовые, орехи */
  mapP('tomato', 120), mapP('tomato-cherry', 15), mapP('cucumber', 110),
  mapP('pepper-bell', 150), mapP('carrot', 90), map('beet-boiled'),
  map('cabbage-white'), map('broccoli'), map('broccoli-boiled'), map('zucchini'),
  mapP('potato', 130), map('potato-boiled'), mapP('onion', 80), map('onion-green'),
  map('garlic'), map('lettuce'), map('spinach'), map('arugula'), mapP('avocado', 150),
  map('corn-canned'), map('peas-green'), map('olives-green'), map('olives-black'),
  map('mushroom-champignon'), map('mushroom-oyster'), map('mushroom-fried'),
  mapP('apple', 180), mapP('banana', 120), mapP('orange', 200), mapP('mandarin', 90),
  mapP('pear', 160), map('grape'), mapP('kiwi', 75), map('mango'), map('pineapple'),
  map('watermelon'), map('strawberry'), map('blueberry'),
  map('dates'), map('raisins'), map('prunes'),
  map('beans-boiled'), map('lentils-boiled'), map('chickpeas-boiled'),
  map('tofu'), map('hummus'), map('falafel'),
  map('walnut'), map('almond'), map('peanuts'), map('cashew'), map('pistachio'),
  map('peanut-butter'), map('chia'), map('flax-seeds'), map('sesame'),

  /* Масла, соусы, сладости, снеки */
  map('oil-olive'), map('oil-sunflower'), map('mayonnaise-67'), map('mayonnaise-light'),
  map('ketchup'), map('mustard'), map('soy-sauce'), map('teriyaki'), map('pesto'),
  map('honey'), map('jam-strawberry'), map('nutella'),
  map('sugar'), map('choco-dark-70'), map('choco-dark-85'),
  mapP('choco-milk', 25, 100), mapP('cookie-oatmeal', 25, 300),
  mapP('cookie-choco-chip', 20, 200), mapP('marshmallow', 35, 250),
  map('halva-sunflower'), mapP('ice-cream-plombir', 80, 400),
  mapP('cheesecake', 120), mapP('tiramisu', 110),
  mapP('snickers', 50, 500), mapP('mars', 51, 510), mapP('twix', 25, 250),
  mapP('bounty', 28, 280), mapP('protein-bar', 45, 540),
  map('chips-lays'), map('chips-pringles'), map('popcorn-salt'), mapP('granola-bar', 30, 180),

  /* Готовые блюда и кухни мира */
  mapP('burger-beef', 220), mapP('burger-chicken', 210),
  mapP('pizza-margherita', 110, 330), mapP('pizza-pepperoni', 115, 345),
  mapP('shawarma-chicken', 350), mapP('chicken-nuggets', 20, 200),
  map('borsch-meat'), map('chicken-noodle'), map('mushroom-cream'),
  map('tom-yum'), map('ramen-soup'), map('miso-soup'),
  map('olivier'), map('caesar-chicken'), map('greek'), map('vinegret'),
  mapP('roll-philadelphia', 30, 240), mapP('roll-california', 28, 224),
  mapP('sushi-salmon', 35), map('ramen-tonkotsu'), mapP('gyoza', 25, 250), map('pad-thai'),
  mapP('echpochmak', 90), map('chak-chak'), mapP('kystybyi', 110),
  map('plov-uzbek'), mapP('manti', 45), mapP('samsa-uzbek', 100),
  mapP('khinkali', 90), map('khachapuri-adjarian'), map('lobio'),

  /* Напитки — базовая единица миллилитры */
  mapMl('water'), mapMl('water-mineral'), mapMl('tea-black'), mapMl('tea-green'),
  mapMl('tea-sugar'), mapMl('coffee-black'), mapMl('coffee-milk'), mapMl('cappuccino'),
  mapMl('latte'), mapMl('americano'), mapMl('cocoa-milk'), mapMl('juice-apple'),
  mapMl('juice-orange'), mapMl('juice-tomato'), mapMl('juice-grape'), mapMl('cola'),
  mapMl('cola-zero'), mapMl('pepsi'), mapMl('sprite'), mapMl('energy-redbull'),
  mapMl('kvass'), mapMl('compote'), mapMl('mors-cranberry'), mapMl('smoothie-berry'),
  mapMl('beer-light'), mapMl('wine-red-dry'),

  /* Самостоятельные товары (их нет в основном справочнике) */
  own({ name: 'Протеиновый коктейль сывороточный', brand: 'NutriFlow Sport', kcal: 380, p: 75, f: 6, c: 8, piece: 30, pack: 900 }),
  own({ name: 'Батончик энергетический гелевый', brand: 'NutriFlow Sport', kcal: 250, p: 0, f: 0, c: 62, piece: 40, pack: 480 }),
  own({ name: 'Молоко безлактозное 1,5%', brand: 'NutriFlow', kcal: 44, p: 2.8, f: 1.5, c: 4.7, unit: 'ml', pack: 1000 }),
  own({ name: 'Йогурт питьевой клубника 2,5%', brand: 'NutriFlow', kcal: 78, p: 2.9, f: 2.5, c: 11, unit: 'ml', piece: 270, pack: 1080 }),
  own({ name: 'Творожок детский ванильный', brand: 'NutriFlow Kids', kcal: 105, p: 7, f: 4, c: 10, piece: 100, pack: 400 }),
  own({ name: 'Хлебцы гречневые', brand: 'NutriFlow', kcal: 310, p: 10, f: 2, c: 62, piece: 8, pack: 100 }),
  own({ name: 'Паста арахисовая без сахара', brand: 'NutriFlow', kcal: 590, p: 25, f: 50, c: 12, pack: 250 }),
  own({ name: 'Соус соевый классический', brand: 'NutriFlow', kcal: 53, p: 8, f: 0, c: 5, unit: 'ml', pack: 250 }),
  own({ name: 'Напиток овсяный бариста', brand: 'NutriFlow Plant', kcal: 60, p: 1, f: 3, c: 7, unit: 'ml', pack: 1000 }),
  own({ name: 'Сыр творожный лёгкий', brand: 'NutriFlow', kcal: 180, p: 11, f: 13, c: 4, pack: 200 }),

  /* Реальный код из практики: Orion Choco Pie, упаковка 360 г = 12 штук */
  { code: '4607176440249', name: 'Choco Pie', brand: 'Orion', kcal: 438, p: 4, f: 18, c: 65, unit: 'g', piece: 30, pack: 360 },
];