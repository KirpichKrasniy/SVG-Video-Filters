/**
 * VIDEO FILTER 1.0.5 — общее ядро расширения.
 *
 * Содержит:
 *   1. SCHEMA — единственный источник правды по всем настраиваемым
 *      параметрам (им пользуются и popup.html, и сайт-витрина);
 *   2. PRESETS — встроенные пресеты (плюс поддержка пользовательских пресетов);
 *   3. buildFilterMarkup(state) — генератор разметки SVG-фильтра:
 *      Часть 0 (Auto-Exposure) -> Часть 1 (FakeHDR) ->
 *      Часть 2 (LumaSharpen) -> Часть 3 (FXAA) -> смесь -> обрезка по альфе.
 *
 * ВАЖНО: файл намеренно НЕ использует import/export, чтобы его можно было
 * подключать и как content-script из manifest.json, и как <script src="filter.js">
 * в popup.html, и как обычный модуль на сайте-витрине.
 */
(function (global) {
  'use strict';

  var FILTER_ID = 'video-filter-svg';

  /* ------------------------------------------------------------------ */
  /*  СХЕМА ПАРАМЕТРОВ                                                   */
  /* ------------------------------------------------------------------ */

  var SCHEMA = [
    {
      id: 'master',
      part: '—',
      title: 'Глобально',
      note: 'Общие параметры тракта, применяются ко всем частям сразу.',
      params: [
        { key: 'enabled', label: 'Фильтр включён', hint: 'master', type: 'toggle', def: true },
        {
          key: 'mix', label: 'Смесь с оригиналом', hint: 'k2 / k3', type: 'range',
          min: 0, max: 1, step: 0.01, def: 1, unit: ''
        },
        {
          key: 'colorSpace', label: 'Цветовое пространство', hint: 'color-interpolation-filters',
          type: 'enum', def: 'sRGB',
          options: [
            { v: 'sRGB', l: 'sRGB' },
            { v: 'linearRGB', l: 'linearRGB' }
          ]
        }
      ]
    },
    {
      id: 'ae',
      part: 'Часть 0',
      title: 'Адаптивная ночная яркость',
      note: 'Автоэкспозиция: размытая карта яркости сцены превращается в маску подъёма теней.',
      params: [
        { key: 'aeOn', label: 'Блок активен', hint: 'часть 0', type: 'toggle', def: true },
        {
          key: 'aeBlur', label: 'Размытие сцены', hint: 'feGaussianBlur stdDeviation', type: 'range',
          min: 0, max: 120, step: 1, def: 55, unit: 'px'
        },
        {
          key: 'aeK1', label: 'Усиление', hint: 'feComposite k1', type: 'range',
          min: 0, max: 3, step: 0.01, def: 1.05, unit: ''
        },
        {
          key: 'aeK2', label: 'База', hint: 'feComposite k2', type: 'range',
          min: 0, max: 2, step: 0.01, def: 1, unit: ''
        },
        {
          key: 'aeBoost', label: 'Маска яркости', hint: 'feFuncR/G/B table[0]', type: 'range',
          min: 0, max: 1, step: 0.01, def: 0.44, unit: ''
        }
      ]
    },
    {
      id: 'hdr',
      part: 'Часть 1',
      title: 'FakeHDR',
      note: 'Локальный контраст на детали (unsharp) плюс тональная кривая и насыщенность.',
      params: [
        { key: 'hdrOn', label: 'Блок активен', hint: 'часть 1', type: 'toggle', def: true },
        {
          key: 'hdrBlur', label: 'Радиус детали', hint: 'feGaussianBlur stdDeviation', type: 'range',
          min: 0, max: 5, step: 0.1, def: 1, unit: 'px'
        },
        {
          key: 'hdrDetail', label: 'Величина детали', hint: 'k2 = 1 + x, k3 = −x', type: 'range',
          min: 0, max: 2, step: 0.01, def: 0.30, unit: ''
        },
        {
          key: 'hdrCurve', label: 'Кривая контраста', hint: 'feFuncR/G/B table (9 значений)', type: 'range',
          min: 0, max: 2, step: 0.01, def: 1, unit: '×'
        },
        {
          key: 'hdrSat', label: 'Насыщенность', hint: 'feColorMatrix saturate', type: 'range',
          min: 0, max: 2, step: 0.01, def: 1, unit: ''
        },
        {
          key: 'hdrK4', label: 'Сдвиг яркости', hint: 'feComposite k4', type: 'range',
          min: -0.3, max: 0.3, step: 0.01, def: 0, unit: ''
        }
      ]
    },
    {
      id: 'sh',
      part: 'Часть 2',
      title: 'LumaSharpen',
      note: 'Резкость по яркостной составляющей: две встречные разности размытия и оригинала.',
      params: [
        { key: 'shOn', label: 'Блок активен', hint: 'часть 2', type: 'toggle', def: true },
        {
          key: 'shBlur', label: 'Радиус резкости', hint: 'feGaussianBlur stdDeviation', type: 'range',
          min: 0.1, max: 5, step: 0.01, def: 1.4, unit: 'px'
        },
        {
          key: 'shPos', label: 'Положительная разность', hint: 'k2 / k3 у ls_pos', type: 'range',
          min: 0, max: 2, step: 0.01, def: 0.24, unit: ''
        },
        {
          key: 'shNeg', label: 'Отрицательная разность', hint: 'k2 / k3 у ls_neg', type: 'range',
          min: 0, max: 2, step: 0.01, def: 0.24, unit: ''
        },
        {
          key: 'shMix', label: 'Вклад резкости', hint: 'k3 финальных feComposite', type: 'range',
          min: 0, max: 2, step: 0.01, def: 1, unit: '×'
        }
      ]
    },
    {
      id: 'fxaa',
      part: 'Часть 3',
      title: 'FXAA',
      note: 'Быстрое приближённое сглаживание: находит контрастные ступеньки по яркости и мягко сглаживает только грани, сохраняя чёткость текстур.',
      params: [
        { key: 'fxaaOn', label: 'Блок активен', hint: 'часть 3', type: 'toggle', def: true },
        {
          key: 'fxaaSpan', label: 'Радиус сглаживания', hint: 'feGaussianBlur stdDeviation', type: 'range',
          min: 0.2, max: 4, step: 0.05, def: 1.2, unit: 'px'
        },
        {
          key: 'fxaaEdge', label: 'Чувствительность к граням', hint: 'feComposite k2 / −k3', type: 'range',
          min: 0.5, max: 8, step: 0.1, def: 3.2, unit: '×'
        },
        {
          key: 'fxaaThreshold', label: 'Порог контраста', hint: 'feComposite −k4 (отсечка шума)', type: 'range',
          min: 0, max: 0.5, step: 0.01, def: 0.08, unit: ''
        },
        {
          key: 'fxaaSubpix', label: 'Субпиксельное сглаживание', hint: 'feColorMatrix alpha offset', type: 'range',
          min: 0, max: 1, step: 0.01, def: 0.25, unit: ''
        },
        {
          key: 'fxaaMix', label: 'Сила FXAA', hint: 'feColorMatrix alpha gain', type: 'range',
          min: 0, max: 1, step: 0.01, def: 0.85, unit: ''
        }
      ]
    }
  ];

  /* ------------------------------------------------------------------ */
  /*  ПРЕСЕТЫ                                                            */
  /* ------------------------------------------------------------------ */

  var PRESETS = [
    {
      id: 'original',
      name: 'Оригинал',
      desc: 'По умолчанию',
      patch: {
        aeOn: true, aeBoost: 0.44, aeK1: 1.05, aeK2: 1, aeBlur: 55,
        hdrOn: true, hdrDetail: 0.30, hdrCurve: 1, hdrBlur: 1, hdrSat: 1, hdrK4: 0,
        shOn: true, shPos: 0.24, shNeg: 0.24, shBlur: 1.4, shMix: 1,
        fxaaOn: false, fxaaSpan: 1.2, fxaaEdge: 3.2, fxaaThreshold: 0.08, fxaaSubpix: 0.25, fxaaMix: 0.85,
        mix: 1, colorSpace: 'sRGB'
      }
    },
    {
      id: 'night',
      name: 'Ночь',
      desc: 'Максимальный подъём теней',
      patch: {
        aeOn: true, aeBoost: 0.72, aeK1: 1.7, aeK2: 1.1, aeBlur: 60,
        hdrOn: true, hdrDetail: 0.30, hdrCurve: 0.8, hdrBlur: 1, hdrSat: 1, hdrK4: 0,
        shOn: true, shPos: 0.3, shNeg: 0.3, shBlur: 1.4, shMix: 1,
        fxaaOn: false, fxaaSpan: 1.3, fxaaEdge: 3.0, fxaaThreshold: 0.10, fxaaSubpix: 0.30, fxaaMix: 0.85
      }
    },
    {
      id: 'cinema',
      name: 'Кино',
      desc: 'Контраст, плотность, мягкая резкость',
      patch: {
        aeOn: false,
        hdrOn: true, hdrDetail: 0.45, hdrCurve: 1.35, hdrBlur: 1.1, hdrSat: 1.15, hdrK4: 0,
        shOn: true, shBlur: 1.6, shPos: 0.35, shNeg: 0.35, shMix: 0.8,
        fxaaOn: false, fxaaSpan: 1.2, fxaaEdge: 3.5, fxaaThreshold: 0.07, fxaaSubpix: 0.25, fxaaMix: 0.9,
        mix: 1
      }
    },
    {
      id: 'sharp',
      name: 'Резкость + FXAA',
      desc: 'Чёткие детали без ступенек на диагоналях',
      patch: {
        aeOn: false,
        hdrOn: false,
        shOn: true, shBlur: 0.9, shPos: 0.75, shNeg: 0.75, shMix: 1.3,
        fxaaOn: true, fxaaSpan: 1.4, fxaaEdge: 4.0, fxaaThreshold: 0.06, fxaaSubpix: 0.30, fxaaMix: 0.95
      }
    },
    {
      id: 'flat',
      name: 'Плоское',
      desc: 'Мягкая картинка для чтения субтитров',
      patch: {
        aeOn: false,
        hdrOn: true, hdrDetail: 0.20, hdrCurve: 0.3, hdrSat: 0.85,
        shOn: false,
        fxaaOn: false, fxaaSpan: 1.5, fxaaEdge: 2.8, fxaaThreshold: 0.05, fxaaSubpix: 0.40, fxaaMix: 0.9,
        mix: 0.85
      }
    }
  ];

  /* ------------------------------------------------------------------ */
  /*  ЗНАЧЕНИЯ ПО УМОЛЧАНИЮ                                              */
  /* ------------------------------------------------------------------ */

  var DEFAULTS = (function () {
    var d = {};
    SCHEMA.forEach(function (g) {
      g.params.forEach(function (p) { d[p.key] = p.def; });
    });
    return d;
  })();

  function mergeState(patch) {
    var s = {};
    Object.keys(DEFAULTS).forEach(function (k) { s[k] = DEFAULTS[k]; });
    if (patch && typeof patch === 'object') {
      Object.keys(DEFAULTS).forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined) {
          var defVal = DEFAULTS[k];
          if (typeof defVal === 'boolean') s[k] = Boolean(patch[k]);
          else if (typeof defVal === 'number') {
            var num = Number(patch[k]);
            s[k] = isFinite(num) ? num : defVal;
          } else {
            s[k] = String(patch[k]);
          }
        }
      });
    }
    return s;
  }

  /** Возвращает копию параметров без служебных полей для сохранения в пресет. */
  function extractPresetPatch(state) {
    var s = mergeState(state);
    var patch = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      if (k === 'enabled') return;
      patch[k] = s[k];
    });
    return patch;
  }

  var PREFERENCE_DEFAULTS = {
    language: 'ru',
    compareEnabled: false,
    comparePosition: 50
  };

  function mergePreferences(patch) {
    patch = patch && typeof patch === 'object' ? patch : {};
    var position = Number(patch.comparePosition);
    return {
      language: patch.language === 'en' ? 'en' : 'ru',
      compareEnabled: patch.compareEnabled === true,
      comparePosition: patch.comparePosition != null && isFinite(position)
        ? Math.max(0, Math.min(100, position)) : 50
    };
  }

  // Pixel coordinates keep the split aligned for differently sized videos.
  // Both halves use the same SourceGraphic, with no canvas or cloned player.
  function buildComparisonMarkup(preferences, geometry) {
    var p = mergePreferences(preferences);
    if (!p.compareEnabled) return '';
    geometry = geometry || {};
    var width = Math.max(1, Number(geometry.width) || 1920);
    var height = Math.max(1, Number(geometry.height) || 1080);
    var split = width * p.comparePosition / 100;
    var lineWidth = Math.min(2, width);
    var lineX = Math.max(0, Math.min(width - lineWidth, split - lineWidth / 2));

    return '<feFlood x="0" y="0" width="' + n(split) + '" height="' + n(height) +
      '" flood-color="white" result="vf_before_mask"/>' +
      '<feComposite operator="in" in="SourceGraphic" in2="vf_before_mask" result="vf_before"/>' +
      '<feComposite operator="out" in="vf_filtered" in2="vf_before_mask" result="vf_after"/>' +
      '<feMerge result="vf_compared"><feMergeNode in="vf_before"/><feMergeNode in="vf_after"/></feMerge>' +
      '<feFlood x="' + n(lineX) + '" y="0" width="' + n(lineWidth) + '" height="' + n(height) +
      '" flood-color="#38e08c" result="vf_divider_color"/>' +
      '<feComposite operator="in" in="vf_divider_color" in2="SourceGraphic" result="vf_divider"/>' +
      '<feMerge><feMergeNode in="vf_compared"/><feMergeNode in="vf_divider"/></feMerge>';
  }

  /* ------------------------------------------------------------------ */
  /*  ГЕНЕРАТОР РАЗМЕТКИ                                                 */
  /* ------------------------------------------------------------------ */

  function n(v) {
    var x = Number(v);
    if (!isFinite(x)) x = 0;
    return String(Math.round(x * 1000) / 1000);
  }

  var LUMA_MATRIX = '0.21 0.72 0.07 0 0 0.21 0.72 0.07 0 0 0.21 0.72 0.07 0 0 0 0 0 1 0';

  // Опорная линейная таблица и целевая S-кривая из исходного фильтра.
  var CURVE_LIN = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
  var CURVE_TGT = [0, 0.09, 0.21, 0.35, 0.5, 0.65, 0.8, 0.91, 1];

  function curveTable(t) {
    var out = [];
    for (var i = 0; i < 9; i++) {
      var v = CURVE_LIN[i] + (CURVE_TGT[i] - CURVE_LIN[i]) * t;
      out.push(n(Math.max(0, Math.min(1, v))));
    }
    return out.join(' ');
  }

  /**
   * Возвращает разметку примитивов внутри <filter>.
   * state — объект вида DEFAULTS (см. mergeState).
   */
  function buildFilterMarkup(state, preferences, geometry) {
    var s = mergeState(state);

    // Если фильтр глобально выключен или все блоки отключены — чистый сквозной проход
    if (!s.enabled || (!s.aeOn && !s.hdrOn && !s.shOn && !s.fxaaOn)) {
      return '<feMerge><feMergeNode in="SourceGraphic"/></feMerge>';
    }

    var out = '';
    var cur = 'SourceGraphic';

    /* ===== ЧАСТЬ 0: адаптивная ночная яркость (Auto-Exposure) ===== */
    if (s.aeOn) {
      var mask = [s.aeBoost, s.aeBoost * 0.295, s.aeBoost * 0.068, 0, 0, 0, 0]
        .map(function (v) { return n(v); }).join(' ');

      out += '<feColorMatrix type="matrix" in="SourceGraphic" result="ae_luma" values="' + LUMA_MATRIX + '"/>';
      out += '<feGaussianBlur in="ae_luma" stdDeviation="' + n(s.aeBlur) + '" result="ae_scene_avg"/>';
      out += '<feComponentTransfer in="ae_scene_avg" result="ae_boost_mask">' +
        '<feFuncR type="table" tableValues="' + mask + '"/>' +
        '<feFuncG type="table" tableValues="' + mask + '"/>' +
        '<feFuncB type="table" tableValues="' + mask + '"/>' +
        '</feComponentTransfer>';
      out += '<feComposite operator="arithmetic" in="SourceGraphic" in2="ae_boost_mask" k1="' +
        n(s.aeK1) + '" k2="' + n(s.aeK2) + '" k3="0" k4="0" result="ae_out"/>';
      cur = 'ae_out';
    }

    /* ===== ЧАСТЬ 1: FakeHDR ===== */
    if (s.hdrOn) {
      out += '<feGaussianBlur in="' + cur + '" stdDeviation="' + n(s.hdrBlur) + '" result="hdr_blur"/>';
      out += '<feComposite operator="arithmetic" in="' + cur + '" in2="hdr_blur" k1="0" k2="' +
        n(1 + s.hdrDetail) + '" k3="' + n(-s.hdrDetail) + '" k4="' + n(s.hdrK4) + '" result="hdr_detail"/>';
      out += '<feComponentTransfer in="hdr_detail" result="hdr_curve">' +
        '<feFuncR type="table" tableValues="' + curveTable(s.hdrCurve) + '"/>' +
        '<feFuncG type="table" tableValues="' + curveTable(s.hdrCurve) + '"/>' +
        '<feFuncB type="table" tableValues="' + curveTable(s.hdrCurve) + '"/>' +
        '</feComponentTransfer>';
      out += '<feColorMatrix type="saturate" values="' + n(s.hdrSat) + '" in="hdr_curve" result="hdr_out"/>';
      cur = 'hdr_out';
    }

    /* ===== ЧАСТЬ 2: LumaSharpen ===== */
    if (s.shOn) {
      out += '<feColorMatrix type="matrix" in="' + cur + '" result="ls_luma" values="' + LUMA_MATRIX + '"/>';
      out += '<feGaussianBlur in="ls_luma" stdDeviation="' + n(s.shBlur) + '" result="ls_blur"/>';
      out += '<feComposite operator="arithmetic" in="ls_luma" in2="ls_blur" k1="0" k2="' +
        n(s.shPos) + '" k3="' + n(-s.shPos) + '" k4="0" result="ls_pos"/>';
      out += '<feComposite operator="arithmetic" in="ls_blur" in2="ls_luma" k1="0" k2="' +
        n(s.shNeg) + '" k3="' + n(-s.shNeg) + '" k4="0" result="ls_neg"/>';
      out += '<feComposite operator="arithmetic" in="' + cur + '" in2="ls_pos" k1="0" k2="1" k3="' +
        n(s.shMix) + '" k4="0" result="ls_step1"/>';
      out += '<feComposite operator="arithmetic" in="ls_step1" in2="ls_neg" k1="0" k2="1" k3="' +
        n(-s.shMix) + '" k4="0" result="ls_final"/>';
      cur = 'ls_final';
    }

    /* ===== ЧАСТЬ 3: FXAA (Адаптивное сглаживание граней) ===== */
    if (s.fxaaOn && s.fxaaMix > 0.001) {
      var subAlpha = s.fxaaSubpix * s.fxaaMix;
      var maskMatrix = '0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 ' + n(s.fxaaMix) + ' 0 0 0 ' + n(subAlpha);

      out += '<feColorMatrix type="matrix" in="' + cur + '" result="fxaa_luma" values="' + LUMA_MATRIX + '"/>';
      out += '<feGaussianBlur in="fxaa_luma" stdDeviation="' + n(s.fxaaSpan) + '" result="fxaa_luma_blur"/>';
      out += '<feComposite operator="arithmetic" in="fxaa_luma" in2="fxaa_luma_blur" k1="0" k2="' +
        n(s.fxaaEdge) + '" k3="' + n(-s.fxaaEdge) + '" k4="0" result="fxaa_edge_pos"/>';
      out += '<feComposite operator="arithmetic" in="fxaa_luma_blur" in2="fxaa_luma" k1="0" k2="' +
        n(s.fxaaEdge) + '" k3="' + n(-s.fxaaEdge) + '" k4="0" result="fxaa_edge_neg"/>';
      out += '<feComposite operator="arithmetic" in="fxaa_edge_pos" in2="fxaa_edge_neg" k1="0" k2="1" k3="1" k4="' +
        n(-s.fxaaThreshold) + '" result="fxaa_edge"/>';
      out += '<feColorMatrix type="matrix" in="fxaa_edge" result="fxaa_mask" values="' + maskMatrix + '"/>';
      out += '<feGaussianBlur in="' + cur + '" stdDeviation="' + n(s.fxaaSpan) + '" result="fxaa_smooth"/>';
      out += '<feComposite operator="in" in="fxaa_smooth" in2="fxaa_mask" result="fxaa_aa"/>';
      out += '<feComposite operator="over" in="fxaa_aa" in2="' + cur + '" result="fxaa_out"/>';
      cur = 'fxaa_out';
    }

    /* ===== СМЕСЬ С ОРИГИНАЛОМ ===== */
    if (s.mix < 0.999) {
      out += '<feComposite operator="arithmetic" in="' + cur + '" in2="SourceGraphic" k1="0" k2="' +
        n(s.mix) + '" k3="' + n(1 - s.mix) + '" k4="0" result="vf_mix"/>';
      cur = 'vf_mix';
    }

    /* ===== ОБРЕЗКА ПО АЛЬФЕ ИСХОДНОГО КАДРА (как в оригинале) ===== */
    out += '<feComposite operator="in" in="' + cur + '" in2="SourceGraphic" result="vf_filtered"/>';
    out += buildComparisonMarkup(preferences, geometry);

    return out;
  }

  /** Атрибуты элемента <filter> — пригодятся и расширению, и сайту. */
  function filterAttrs(id, colorSpace) {
    return 'id="' + (id || FILTER_ID) + '" x="-15%" y="-15%" width="130%" height="130%" ' +
      'filterUnits="objectBoundingBox" color-interpolation-filters="' +
      (colorSpace === 'linearRGB' ? 'linearRGB' : 'sRGB') + '"';
  }

  global.VF = {
    FILTER_ID: FILTER_ID,
    SCHEMA: SCHEMA,
    PRESETS: PRESETS,
    DEFAULTS: DEFAULTS,
    PREFERENCE_DEFAULTS: PREFERENCE_DEFAULTS,
    mergeState: mergeState,
    mergePreferences: mergePreferences,
    extractPresetPatch: extractPresetPatch,
    buildComparisonMarkup: buildComparisonMarkup,
    buildFilterMarkup: buildFilterMarkup,
    filterAttrs: filterAttrs
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
