/**
 * VIDEO FILTER 1.0 — content script.
 *
 * 1. Вставляет в документ скрытый <svg> с одним <filter>, разметку которого
 *    строит filter.js (VF.buildFilterMarkup);
 * 2. Находит все <video> (включая динамически созданные и внутри открытых
 *    Shadow DOM) и вешает на них CSS-правило filter: url(#video-filter-svg),
 *    корректно снимая фильтр при выключении (с учётом нормализации кавычек
 *    url("#video-filter-svg") в Chrome CSSOM);
 * 3. Слушает прямые сообщения от popup.js и изменения chrome.storage.local /
 *    chrome.storage.sync — все вкладки обновляются мгновенно.
 */
(function () {
  'use strict';

  var VF = globalThis.VF;
  if (!VF) return;

  var FILTER_ID = VF.FILTER_ID;

  var state = VF.mergeState(null);
  var preferences = VF.mergePreferences(null);
  var disabledHosts = [];
  var svgEl = null;
  var filterEl = null;
  var renderedFilterMarkup = null;
  var originals = typeof WeakMap === 'function' ? new WeakMap() : null;
  var originalsFallback = [];
  var originalPriorities = new WeakMap();
  var comparisonFilters = new Map();
  var nextComparisonId = 0;
  var resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(function (entries) {
    entries.forEach(function (entry) {
      if (comparisonFilters.has(entry.target)) updateComparison(entry.target);
    });
  }) : null;
  var scanScheduled = false;
  var updateScheduled = false;
  var isTopFrame = window === window.top;

  /* ------------------------------------------------------------------ */
  /*  SVG-контейнер                                                      */
  /* ------------------------------------------------------------------ */

  function ensureSvg() {
    if (svgEl && document.documentElement && document.documentElement.contains(svgEl)) {
      return svgEl;
    }

    var existing = document.getElementById(FILTER_ID + '-root');
    if (existing) {
      svgEl = existing;
      filterEl = existing.querySelector('filter');
      renderedFilterMarkup = null;
      if (filterEl) return svgEl;
    }

    var host = document.documentElement || document.body;
    if (!host) return null;

    var ns = 'http://www.w3.org/2000/svg';
    svgEl = document.createElementNS(ns, 'svg');
    svgEl.setAttribute('id', FILTER_ID + '-root');
    svgEl.setAttribute('aria-hidden', 'true');
    svgEl.setAttribute('focusable', 'false');
    svgEl.setAttribute('width', '0');
    svgEl.setAttribute('height', '0');
    svgEl.style.cssText =
      'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;' +
      'left:-9999px;top:-9999px;opacity:0;';

    var defs = document.createElementNS(ns, 'defs');
    filterEl = document.createElementNS(ns, 'filter');
    renderedFilterMarkup = null;
    defs.appendChild(filterEl);
    svgEl.appendChild(defs);

    host.appendChild(svgEl);
    renderFilter();
    return svgEl;
  }

  function renderFilter() {
    if (!ensureSvg() || !filterEl) return;
    filterEl.setAttribute('id', FILTER_ID);
    filterEl.setAttribute('x', '-15%');
    filterEl.setAttribute('y', '-15%');
    filterEl.setAttribute('width', '130%');
    filterEl.setAttribute('height', '130%');
    filterEl.setAttribute('filterUnits', 'objectBoundingBox');
    filterEl.setAttribute('primitiveUnits', 'userSpaceOnUse');
    filterEl.setAttribute('color-interpolation-filters', state.colorSpace || 'sRGB');

    var markup = shouldApply() ? VF.buildFilterMarkup(state) :
      '<feMerge><feMergeNode in="SourceGraphic"/></feMerge>';
    if (renderedFilterMarkup !== markup) {
      filterEl.innerHTML = markup;
      renderedFilterMarkup = markup;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Применение и снятие фильтра с <video>                              */
  /* ------------------------------------------------------------------ */

  function siteBlocked() {
    var h = location.hostname;
    if (!h) return false;
    for (var i = 0; i < disabledHosts.length; i++) {
      if (disabledHosts[i] === h) return true;
    }
    return false;
  }

  function anyModuleOn() {
    return Boolean(state.aeOn || state.hdrOn || state.shOn || state.fxaaOn);
  }

  function shouldApply() {
    return Boolean(state.enabled) && anyModuleOn() && !siteBlocked();
  }

  /**
   * В Chrome при присваивании v.style.filter = 'url(#video-filter-svg)'
   * браузер сериализует значение с кавычками: 'url("#video-filter-svg")'.
   * Поэтому проверяем вхождение идентификатора фильтра.
   */
  function isOurFilter(val) {
    return typeof val === 'string' && val.indexOf(FILTER_ID) !== -1;
  }

  function getOriginal(v) {
    if (originals) return originals.get(v);
    for (var i = 0; i < originalsFallback.length; i++) {
      if (originalsFallback[i].v === v) return originalsFallback[i].value;
    }
    return undefined;
  }

  function setOriginal(v, value) {
    if (originals) {
      if (value === undefined) originals.delete(v);
      else originals.set(v, value);
    } else {
      for (var i = 0; i < originalsFallback.length; i++) {
        if (originalsFallback[i].v === v) {
          if (value === undefined) originalsFallback.splice(i, 1);
          else originalsFallback[i].value = value;
          return;
        }
      }
      if (value !== undefined) originalsFallback.push({ v: v, value: value });
    }
  }

  function removeComparison(video) {
    var entry = comparisonFilters.get(video);
    if (!entry) return;
    if (resizeObserver) resizeObserver.unobserve(video);
    entry.filter.remove();
    if (entry.shadowSvg) entry.shadowSvg.remove();
    comparisonFilters.delete(video);
  }

  function updateComparison(video) {
    var entry = comparisonFilters.get(video);
    if (!entry) return;
    var width = video.clientWidth || video.getBoundingClientRect().width || 1;
    var height = video.clientHeight || video.getBoundingClientRect().height || 1;
    var markup = VF.buildFilterMarkup(state, preferences, { width: width, height: height });
    entry.filter.setAttribute('color-interpolation-filters', state.colorSpace || 'sRGB');
    if (entry.markup !== markup) {
      entry.filter.innerHTML = markup;
      entry.markup = markup;
    }
  }

  function comparisonId(video) {
    var entry = comparisonFilters.get(video);
    if (entry && !entry.filter.isConnected) {
      removeComparison(video);
      entry = null;
    }
    if (!entry) {
      var ns = 'http://www.w3.org/2000/svg';
      var filter = document.createElementNS(ns, 'filter');
      var id = FILTER_ID + '-compare-' + (++nextComparisonId);
      filter.setAttribute('id', id);
      filter.setAttribute('x', '-15%');
      filter.setAttribute('y', '-15%');
      filter.setAttribute('width', '130%');
      filter.setAttribute('height', '130%');
      filter.setAttribute('filterUnits', 'objectBoundingBox');
      filter.setAttribute('primitiveUnits', 'userSpaceOnUse');

      var root = video.getRootNode();
      var shadowSvg = null;
      if (root !== document) {
        shadowSvg = document.createElementNS(ns, 'svg');
        shadowSvg.setAttribute('aria-hidden', 'true');
        shadowSvg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;';
        var defs = document.createElementNS(ns, 'defs');
        defs.appendChild(filter);
        shadowSvg.appendChild(defs);
        root.appendChild(shadowSvg);
      } else {
        ensureSvg().querySelector('defs').appendChild(filter);
      }
      entry = { id: id, filter: filter, shadowSvg: shadowSvg, markup: '' };
      comparisonFilters.set(video, entry);
      if (resizeObserver) resizeObserver.observe(video);
    }
    updateComparison(video);
    return entry.id;
  }

  function applyOne(v) {
    if (!v || v.nodeType !== 1) return;
    var active = shouldApply();
    var currentFilter = v.style.filter || '';

    if (active) {
      var id = preferences.compareEnabled ? comparisonId(v) : FILTER_ID;
      var wanted = 'url("#' + id + '")';
      if (!preferences.compareEnabled) removeComparison(v);
      if (getOriginal(v) === undefined) {
        setOriginal(v, isOurFilter(currentFilter) ? '' : currentFilter);
        originalPriorities.set(v, v.style.getPropertyPriority('filter'));
      }
      if (currentFilter !== wanted) v.style.setProperty('filter', wanted, 'important');
      if (v.getAttribute('data-vf-active') !== '1') v.setAttribute('data-vf-active', '1');
    } else {
      var orig = getOriginal(v);
      if (isOurFilter(currentFilter)) {
        if (orig && !isOurFilter(orig)) {
          v.style.setProperty('filter', orig, originalPriorities.get(v) || '');
        } else {
          v.style.removeProperty('filter');
        }
      }
      v.removeAttribute('data-vf-active');
      setOriginal(v, undefined);
      originalPriorities.delete(v);
      removeComparison(v);
    }
  }

  function collectVideos(root, out) {
    if (!root || !root.querySelectorAll) return;
    var vids = root.querySelectorAll('video');
    for (var i = 0; i < vids.length; i++) out.push(vids[i]);
    var all = root.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
      if (all[j].shadowRoot) collectVideos(all[j].shadowRoot, out);
    }
  }

  function scan() {
    ensureSvg();
    var list = [];
    collectVideos(document, list);
    for (var i = 0; i < list.length; i++) applyOne(list[i]);
    comparisonFilters.forEach(function (entry, video) {
      if (!video.isConnected) removeComparison(video);
    });
    reportStatus();
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(function () {
      scanScheduled = false;
      scan();
    }, 60);
  }

  function scheduleUpdate() {
    if (updateScheduled) return;
    updateScheduled = true;
    setTimeout(function () {
      updateScheduled = false;
      renderFilter();
      scan();
    }, 25);
  }

  /* ------------------------------------------------------------------ */
  /*  Статус -> бейдж на иконке                                          */
  /* ------------------------------------------------------------------ */

  var lastStatus = null;

  function reportStatus() {
    if (!isTopFrame) return;
    var on = shouldApply();
    if (on === lastStatus) return;
    lastStatus = on;
    try {
      chrome.runtime.sendMessage({ type: 'VF_STATUS', enabled: on }, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) { /* сервис-воркер недоступен — не критично */ }
  }

  /* ------------------------------------------------------------------ */
  /*  Хранилище и сообщения                                              */
  /* ------------------------------------------------------------------ */

  function persistState() {
    try {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ vfState: state }, function () { void chrome.runtime.lastError; });
      }
      if (chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.set({ vfState: state }, function () { void chrome.runtime.lastError; });
      }
    } catch (e) {}
  }

  function applyIncomingState(nextState, nextDisabled, nextPreferences) {
    if (nextState) {
      state = VF.mergeState(Object.assign({}, state, nextState));
    }
    if (Array.isArray(nextDisabled)) {
      disabledHosts = nextDisabled;
    }
    if (nextPreferences) preferences = VF.mergePreferences(nextPreferences);
    renderFilter();
    scan();
  }

  function loadInitialState() {
    // Сначала читаем быстрый local, при отсутствии — sync
    chrome.storage.local.get({ vfState: null, vfDisabled: null, vfPreferences: null }, function (loc) {
      void chrome.runtime.lastError;
      if (loc && loc.vfState) state = VF.mergeState(loc.vfState);
      if (loc && Array.isArray(loc.vfDisabled)) disabledHosts = loc.vfDisabled;
      if (loc && loc.vfPreferences) preferences = VF.mergePreferences(loc.vfPreferences);

      chrome.storage.sync.get({ vfState: null, vfDisabled: [], vfPreferences: null }, function (syn) {
        void chrome.runtime.lastError;
        if ((!loc || !loc.vfState) && syn && syn.vfState) {
          state = VF.mergeState(syn.vfState);
        }
        if ((!loc || !Array.isArray(loc.vfDisabled)) && syn && Array.isArray(syn.vfDisabled)) {
          disabledHosts = syn.vfDisabled;
        }
        if ((!loc || !loc.vfPreferences) && syn && syn.vfPreferences) {
          preferences = VF.mergePreferences(syn.vfPreferences);
        }
        renderFilter();
        scan();
      });
    });
  }

  loadInitialState();

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' && area !== 'sync') return;
    if (changes.vfState && changes.vfState.newValue) {
      state = VF.mergeState(changes.vfState.newValue);
      scheduleUpdate();
    }
    if (changes.vfDisabled) {
      disabledHosts = changes.vfDisabled.newValue || [];
      scheduleUpdate();
    }
    if (changes.vfPreferences) {
      preferences = VF.mergePreferences(changes.vfPreferences.newValue);
      scheduleUpdate();
    }
  });

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;

    if (msg.type === 'VF_TOGGLE') {
      applyIncomingState({ enabled: !state.enabled });
      persistState();
      sendResponse({ ok: true, state: state });
      return true;
    }

    if (msg.type === 'VF_SET') {
      var patch = msg.state || msg.patch || {};
      applyIncomingState(patch, msg.disabledHosts, msg.preferences);
      if (msg.persist) persistState();
      sendResponse({ ok: true, state: state, blocked: siteBlocked() });
      return true;
    }

    if (msg.type === 'VF_RESET') {
      state = VF.mergeState(null);
      renderFilter();
      scan();
      persistState();
      sendResponse({ ok: true, state: state });
      return true;
    }

    if (msg.type === 'VF_PRESET') {
      var preset = null;
      for (var i = 0; i < VF.PRESETS.length; i++) {
        if (VF.PRESETS[i].id === msg.id) preset = VF.PRESETS[i];
      }
      if (preset) {
        state = VF.mergeState(Object.assign({ enabled: true }, preset.patch));
        renderFilter();
        scan();
        persistState();
      }
      sendResponse({ ok: !!preset, state: state });
      return true;
    }

    if (msg.type === 'VF_GET') {
      sendResponse({ ok: true, state: state, preferences: preferences, blocked: siteBlocked(), host: location.hostname });
      return true;
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Наблюдение за DOM                                                  */
  /* ------------------------------------------------------------------ */

  if (typeof MutationObserver === 'function' && document.documentElement) {
    var mo = new MutationObserver(function () { scheduleScan(); });
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });
  }

  // Страховка: сайты могут пересоздавать <video> без мутаций (например, при смене качества/ролика)
  setInterval(scan, 1500);

  document.addEventListener('play', function (e) {
    if (e.target && e.target.tagName === 'VIDEO') applyOne(e.target);
  }, true);

  document.addEventListener('loadeddata', function (e) {
    if (e.target && e.target.tagName === 'VIDEO') applyOne(e.target);
  }, true);

  window.addEventListener('load', scheduleScan);

  ensureSvg();
})();
