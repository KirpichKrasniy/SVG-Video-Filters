(function (global) {
  'use strict';

  var TEXT = {
    ru: {
      subtitle: 'SVG-фильтры для видео', language: 'Язык меню',
      master: 'Включить или выключить фильтр', on: 'ВКЛ', off: 'ВЫКЛ',
      compareTitle: 'До / после', compareNote: 'Слева оригинал без фильтров. Справа все выбранные эффекты.',
      showLine: 'Показать линию', hideLine: 'Скрыть линию',
      position: 'Положение линии', before: 'Оригинал', after: 'С фильтрами',
      center: 'По центру', compareUnavailable: 'Включите фильтр и хотя бы один блок, чтобы увидеть сравнение.',
      compareOff: 'Без линии фильтры применяются ко всему кадру.',
      presets: 'Пресеты', presetPanel: 'Управление пресетами',
      presetPlaceholder: 'Имя своего пресета...', presetName: 'Имя нового пресета',
      save: '+ Сохранить', saveTitle: 'Сохранить текущие настройки как свой пресет',
      export: 'Экспорт .json', exportTitle: 'Скачать текущие настройки и свои пресеты в .json',
      import: 'Загрузить .json', importTitle: 'Загрузить пресеты из файла .json',
      userPreset: 'Пользовательский пресет', defaultPresetName: 'Пресет {count}',
      loaded: 'Загружен пресет «{name}»', saved: 'Сохранён пресет «{name}»',
      updated: 'Обновлён пресет «{name}»', deleted: 'Пресет «{name}» удалён',
      deleteTitle: 'Удалить пресет «{name}»', exported: 'Файл video-filter-presets.json сохранён',
      imported: 'Импортировано пресетов: {count}', applied: 'Настройки из файла применены',
      importError: 'Ошибка: некорректный файл пресетов JSON', importedPreset: 'Импортированный пресет',
      importName: 'Импорт', reset: 'Сброс', resetTitle: 'Сброс к «Оригинал»',
      resetDone: 'Восстановлены настройки по умолчанию',
      enableSite: 'Включить на этом сайте ({host})', disableSite: 'Отключить на этом сайте ({host})',
      unavailableSite: 'Недоступно на этой странице', shortcut: 'вкл/выкл',
      console: 'Консоль', consoleTitle: 'Пульт фильтра', consoleAccent: 'сравнивайте результат',
      consoleLead: 'Включите линию сравнения, двигайте её по горизонтали и оценивайте эффекты на одном кадре. Слева оригинал, справа обработка. Язык меню переключается без сброса настроек.',
      filterOn: 'Фильтр включён', filterOff: 'Фильтр выключен',
      global: 'Глобально', state: 'Состояние тракта',
      presetHeading: 'Встроенные и свои пресеты',
      manual: 'Ручная настройка. Сохраните её как свой пресет.',
      storageNote: 'В расширении настройки применяются сразу и сохраняются между открытиями меню. Пресеты не меняют язык и режим сравнения.',
      filterStatusOn: 'ФИЛЬТР ВКЛ', filterStatusOff: 'ФИЛЬТР ВЫКЛ'
    },
    en: {
      subtitle: 'SVG filters for video', language: 'Menu language',
      master: 'Enable or disable the filter', on: 'ON', off: 'OFF',
      compareTitle: 'Before / after', compareNote: 'Unfiltered original on the left. All selected effects on the right.',
      showLine: 'Show divider', hideLine: 'Hide divider',
      position: 'Divider position', before: 'Original', after: 'Filtered',
      center: 'Center', compareUnavailable: 'Enable the filter and at least one module to see the comparison.',
      compareOff: 'Without the divider, filters apply to the entire frame.',
      presets: 'Presets', presetPanel: 'Preset management',
      presetPlaceholder: 'Your preset name...', presetName: 'New preset name',
      save: '+ Save', saveTitle: 'Save the current settings as a custom preset',
      export: 'Export .json', exportTitle: 'Download current settings and custom presets as .json',
      import: 'Import .json', importTitle: 'Load presets from a .json file',
      userPreset: 'Custom preset', defaultPresetName: 'Preset {count}',
      loaded: 'Loaded preset "{name}"', saved: 'Saved preset "{name}"',
      updated: 'Updated preset "{name}"', deleted: 'Deleted preset "{name}"',
      deleteTitle: 'Delete preset "{name}"', exported: 'Saved video-filter-presets.json',
      imported: 'Imported presets: {count}', applied: 'Settings from the file applied',
      importError: 'Error: invalid preset JSON file', importedPreset: 'Imported preset',
      importName: 'Import', reset: 'Reset', resetTitle: 'Reset to Original',
      resetDone: 'Default filter settings restored',
      enableSite: 'Enable on this site ({host})', disableSite: 'Disable on this site ({host})',
      unavailableSite: 'Unavailable on this page', shortcut: 'toggle filter',
      console: 'Console', consoleTitle: 'Filter controls', consoleAccent: 'compare the result',
      consoleLead: 'Enable the comparison divider, move it horizontally and inspect the effects on a single frame. Original on the left, processed on the right. Switch menu language without resetting settings.',
      filterOn: 'Filter enabled', filterOff: 'Filter disabled',
      global: 'Global', state: 'Signal state', presetHeading: 'Built-in and custom presets',
      manual: 'Custom settings. Save them as your own preset.',
      storageNote: 'In the extension, settings apply immediately and persist between menu openings. Presets do not change your language or comparison mode.',
      filterStatusOn: 'FILTER ON', filterStatusOff: 'FILTER OFF'
    }
  };

  var GROUPS = {
    master: ['-', 'Global', 'Settings applied to the complete filter chain.'],
    ae: ['Part 0', 'Adaptive night brightness', 'Auto-exposure: a blurred scene luminance map becomes a shadow-boost mask.'],
    hdr: ['Part 1', 'FakeHDR', 'Local detail contrast, a tone curve and saturation.'],
    sh: ['Part 2', 'LumaSharpen', 'Luminance sharpening using positive and negative differences from the blurred original.'],
    fxaa: ['Part 3', 'FXAA', 'SVG edge-aware smoothing. An approximation, not the original directional FXAA shader.']
  };

  var PARAMS = {
    enabled: ['Filter enabled', 'master'], mix: ['Mix with original', 'k2 / k3'],
    colorSpace: ['Color space', 'color-interpolation-filters'],
    aeOn: ['Module enabled', 'part 0'], aeBlur: ['Scene blur', 'feGaussianBlur stdDeviation'],
    aeK1: ['Boost', 'feComposite k1'], aeK2: ['Base', 'feComposite k2'],
    aeBoost: ['Brightness mask', 'feFuncR/G/B table[0]'],
    hdrOn: ['Module enabled', 'part 1'], hdrBlur: ['Detail radius', 'feGaussianBlur stdDeviation'],
    hdrDetail: ['Detail amount', 'k2 = 1 + x, k3 = -x'], hdrCurve: ['Contrast curve', 'feFuncR/G/B table (9 values)'],
    hdrSat: ['Saturation', 'feColorMatrix saturate'], hdrK4: ['Brightness offset', 'feComposite k4'],
    shOn: ['Module enabled', 'part 2'], shBlur: ['Sharpening radius', 'feGaussianBlur stdDeviation'],
    shPos: ['Positive difference', 'ls_pos k2 / k3'], shNeg: ['Negative difference', 'ls_neg k2 / k3'],
    shMix: ['Sharpening contribution', 'final feComposite k3'],
    fxaaOn: ['Module enabled', 'part 3'], fxaaSpan: ['Smoothing radius', 'feGaussianBlur stdDeviation'],
    fxaaEdge: ['Edge sensitivity', 'feComposite k2 / -k3'],
    fxaaThreshold: ['Contrast threshold', 'feComposite -k4 (noise rejection)'],
    fxaaSubpix: ['Subpixel smoothing', 'feColorMatrix alpha offset'], fxaaMix: ['FXAA strength', 'feColorMatrix alpha gain']
  };

  var PRESETS = {
    original: ['Original', 'Default settings'], night: ['Night', 'Maximum shadow boost'],
    cinema: ['Cinema', 'Contrast, density, soft sharpening and FXAA'],
    sharp: ['Sharp + FXAA', 'Crisp details with smoother diagonal edges'],
    flat: ['Flat', 'A softer picture for reading subtitles']
  };

  function t(language, key, values) {
    var text = (TEXT[language] || TEXT.ru)[key] || TEXT.en[key] || key;
    return text.replace(/\{(\w+)\}/g, function (match, name) {
      return values && values[name] != null ? String(values[name]) : match;
    });
  }

  function schema(language, source) {
    if (language !== 'en') return source;
    return source.map(function (group) {
      var translated = GROUPS[group.id];
      return Object.assign({}, group, {
        part: translated ? translated[0] : group.part,
        title: translated ? translated[1] : group.title,
        note: translated ? translated[2] : group.note,
        params: group.params.map(function (p) {
          var labels = PARAMS[p.key];
          return Object.assign({}, p, labels ? { label: labels[0], hint: labels[1] } : {});
        })
      });
    });
  }

  function preset(language, source) {
    var translated = language === 'en' && PRESETS[source.id];
    return translated ? Object.assign({}, source, { name: translated[0], desc: translated[1] }) : source;
  }

  global.VF_I18N = { t: t, schema: schema, preset: preset };
})(typeof globalThis !== 'undefined' ? globalThis : this);