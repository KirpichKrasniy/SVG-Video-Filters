/**
 * VIDEO FILTER 1.0.5 — логика панели управления.
 *
 * Ключевые особенности:
 *   1. Контролы (ползунки, тумблеры, переключатели) создаются в DOM ОДИН РАЗ
 *      при открытии окна и обновляются на месте (in-place). Благодаря этому
 *      ползунки никогда не теряют захват курсора при перетаскивании.
 *   2. Изменения мгновенно отправляются напрямую в активную вкладку через
 *      chrome.tabs.sendMessage, сразу пишутся в chrome.storage.local (без
 *      лимита квоты) и с дебаунсом 250 мс — в chrome.storage.sync.
 *   3. Поддерживаются собственные именованные пресеты (сохранение, загрузка,
 *      удаление), а также экспорт и импорт пресетов в формате .json.
 */
(function () {
  'use strict';

  var VF = globalThis.VF;
  var I18N = globalThis.VF_I18N;
  if (!VF || !I18N) return;

  var state = VF.mergeState(null);
  var preferences = VF.mergePreferences(null);
  var hosts = [];            // сайты, на которых фильтр выключен вручную
  var userPresets = [];      // пользовательские пресеты [{ id, name, desc, patch }]
  var currentHost = '';
  var activePreset = 'original';
  var draggingKey = null;    // ключ ползунка, который сейчас тянет пользователь
  var controlRefs = {};      // ссылки на DOM-узлы контролов по ключу параметра
  var syncTimer = null;
  var preferenceTimer = null;
  var rafPending = false;
  var statusTimer = null;

  var $ = function (sel) { return document.querySelector(sel); };

  function t(key, values) {
    return I18N.t(preferences.language, key, values);
  }

  /* --------------------------- утилиты --------------------------- */

  function fmt(p, v) {
    if (p.type !== 'range') return String(v);
    var x = Number(v);
    if (!isFinite(x)) x = Number(p.def) || 0;
    var text = (p.step >= 1) ? String(Math.round(x)) : x.toFixed(2);
    return text + (p.unit || '');
  }

  function fill(p, v) {
    var min = Number(p.min);
    var max = Number(p.max);
    var val = Math.max(min, Math.min(max, Number(v)));
    var pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    return pct.toFixed(1) + '%';
  }

  function showStatus(msg) {
    var box = $('#presetStatus');
    if (!box) return;
    box.textContent = msg || '';
    if (statusTimer) clearTimeout(statusTimer);
    if (msg) {
      statusTimer = setTimeout(function () {
        box.textContent = '';
      }, 2800);
    }
  }

  function updateBadge() {
    var blocked = currentHost && hosts.indexOf(currentHost) !== -1;
    var anyMod = Boolean(state.aeOn || state.hdrOn || state.shOn || state.fxaaOn);
    var on = Boolean(state.enabled) && anyMod && !blocked;
    try {
      if (chrome.action && chrome.action.setBadgeText) {
        chrome.action.setBadgeText({ text: on ? 'ON' : 'OFF' });
        chrome.action.setBadgeBackgroundColor({ color: on ? '#38E08C' : '#FF9E2C' });
      }
    } catch (e) {}
  }

  /** Отправляет текущее состояние напрямую в content script активной вкладки. */
  function sendToTabsImmediate() {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        void chrome.runtime.lastError;
        var tab = tabs && tabs[0];
        if (!tab || tab.id == null) return;
        chrome.tabs.sendMessage(
          tab.id,
          { type: 'VF_SET', state: state, disabledHosts: hosts, preferences: preferences },
          function () { void chrome.runtime.lastError; }
        );
      });
    } catch (e) {}
  }

  function sendToTabsThrottled() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      sendToTabsImmediate();
    });
  }

  function persistState(immediateSync) {
    try {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ vfState: state }, function () { void chrome.runtime.lastError; });
      }
      if (chrome.storage && chrome.storage.sync) {
        if (syncTimer) clearTimeout(syncTimer);
        if (immediateSync) {
          chrome.storage.sync.set({ vfState: state }, function () { void chrome.runtime.lastError; });
        } else {
          syncTimer = setTimeout(function () {
            chrome.storage.sync.set({ vfState: state }, function () { void chrome.runtime.lastError; });
          }, 250);
        }
      }
    } catch (e) {}
  }

  function persistUserPresets() {
    try {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ vfUserPresets: userPresets }, function () { void chrome.runtime.lastError; });
      }
      if (chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.set({ vfUserPresets: userPresets }, function () { void chrome.runtime.lastError; });
      }
    } catch (e) {}
  }

  function persistPreferences(flush) {
    chrome.storage.local.set({ vfPreferences: preferences }, function () { void chrome.runtime.lastError; });
    if (preferenceTimer) clearTimeout(preferenceTimer);
    function sync() {
      chrome.storage.sync.set({ vfPreferences: preferences }, function () { void chrome.runtime.lastError; });
    }
    if (flush) sync();
    else preferenceTimer = setTimeout(sync, 400);
  }

  function localizeMenu() {
    document.documentElement.lang = preferences.language;
    [
      ['data-i18n', 'textContent'], ['data-i18n-title', 'title'],
      ['data-i18n-placeholder', 'placeholder'], ['data-i18n-aria', 'aria-label']
    ].forEach(function (pair) {
      document.querySelectorAll('[' + pair[0] + ']').forEach(function (node) {
        var translated = t(node.getAttribute(pair[0]));
        if (pair[1] === 'aria-label') node.setAttribute(pair[1], translated);
        else node[pair[1]] = translated;
      });
    });
    document.querySelectorAll('[data-language]').forEach(function (button) {
      var active = button.dataset.language === preferences.language;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('on', active);
    });
    I18N.schema(preferences.language, VF.SCHEMA).forEach(function (group) {
      var mod = document.querySelector('[data-module="' + group.id + '"]');
      if (!mod) return;
      mod.querySelector('.mod-part').textContent = group.part;
      mod.querySelector('h2').textContent = group.title;
      mod.querySelector('.note').textContent = group.note;
      group.params.forEach(function (p) {
        var ref = controlRefs[p.key];
        if (!ref) return;
        ref.label.textContent = p.label;
        ref.hint.textContent = p.hint || '';
        if (ref.input) ref.input.setAttribute('aria-label', p.label);
        if (ref.btn) ref.btn.setAttribute('aria-label', p.label);
      });
    });
  }

  function syncComparison() {
    var toggle = $('#compareToggle');
    toggle.setAttribute('aria-pressed', String(preferences.compareEnabled));
    toggle.textContent = t(preferences.compareEnabled ? 'hideLine' : 'showLine');
    var input = $('#comparePosition');
    if (draggingKey !== 'comparePosition') input.value = String(preferences.comparePosition);
    input.style.setProperty('--fill', preferences.comparePosition + '%');
    input.disabled = !preferences.compareEnabled;
    $('#compareValue').textContent = Math.round(preferences.comparePosition) + '%';
    $('#compareCenter').disabled = !preferences.compareEnabled;
    var active = state.enabled && (state.aeOn || state.hdrOn || state.shOn || state.fxaaOn) &&
      hosts.indexOf(currentHost) === -1;
    $('#compareHelp').textContent = !active ? t('compareUnavailable') :
      preferences.compareEnabled ? '' : t('compareOff');
  }

  document.querySelectorAll('[data-language]').forEach(function (button) {
    button.addEventListener('click', function () {
      preferences.language = button.dataset.language === 'en' ? 'en' : 'ru';
      showStatus('');
      syncUI(draggingKey);
      persistPreferences(true);
      sendToTabsImmediate();
    });
  });

  $('#compareToggle').addEventListener('click', function () {
    preferences.compareEnabled = !preferences.compareEnabled;
    syncComparison();
    sendToTabsImmediate();
    persistPreferences(true);
  });

  $('#comparePosition').addEventListener('pointerdown', function () { draggingKey = 'comparePosition'; });
  $('#comparePosition').addEventListener('input', function (event) {
    draggingKey = 'comparePosition';
    preferences.comparePosition = Number(event.target.value);
    syncComparison();
    sendToTabsThrottled();
    persistPreferences(false);
  });
  function finishComparisonDrag() {
    if (draggingKey !== 'comparePosition') return;
    draggingKey = null;
    persistPreferences(true);
    sendToTabsImmediate();
  }
  ['change', 'pointerup', 'pointercancel', 'blur'].forEach(function (type) {
    $('#comparePosition').addEventListener(type, finishComparisonDrag);
  });
  $('#compareCenter').addEventListener('click', function () {
    preferences.comparePosition = 50;
    syncComparison();
    sendToTabsImmediate();
    persistPreferences(true);
  });

  function commit(patch, keepPreset) {
    state = VF.mergeState(Object.assign({}, state, patch));
    if (!keepPreset) activePreset = '';
    syncUI(draggingKey);
    updateBadge();
    sendToTabsImmediate();
    persistState(true);
  }

  /* --------------------------- мастер-тумблер --------------------------- */

  function renderMaster() {
    var b = $('#master');
    if (!b) return;
    b.setAttribute('aria-checked', state.enabled ? 'true' : 'false');
    b.querySelector('.state').textContent = state.enabled ? 'ON' : 'OFF';
  }

  $('#master').addEventListener('click', function () {
    commit({ enabled: !state.enabled }, true);
  });

  /* --------------------------- пресеты (встроенные + свои) --------------------------- */

  function renderPresets() {
    var box = $('#presets');
    if (!box) return;
    box.innerHTML = '';

    // Встроенные пресеты
    VF.PRESETS.forEach(function (source) {
      var pr = I18N.preset(preferences.language, source);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (activePreset === pr.id ? ' on' : '');
      b.textContent = pr.name;
      b.title = pr.desc || pr.name;
      b.addEventListener('click', function () {
        activePreset = pr.id;
        state = VF.mergeState(null);
        commit(Object.assign({ enabled: true }, pr.patch), true);
      });
      box.appendChild(b);
    });

    // Пользовательские пресеты
    userPresets.forEach(function (pr) {
      var grp = document.createElement('span');
      grp.className = 'chip-group';

      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip user' + (activePreset === pr.id ? ' on' : '');
      b.textContent = pr.name;
      b.title = t('userPreset') + ': ' + pr.name;
      b.addEventListener('click', function () {
        activePreset = pr.id;
        commit(Object.assign({ enabled: true }, pr.patch), true);
        showStatus(t('loaded', { name: pr.name }));
      });

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'chip-del';
      del.textContent = 'x';
      del.title = t('deleteTitle', { name: pr.name });
      del.setAttribute('aria-label', del.title);
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        userPresets = userPresets.filter(function (x) { return x.id !== pr.id; });
        if (activePreset === pr.id) activePreset = '';
        persistUserPresets();
        renderPresets();
        showStatus(t('deleted', { name: pr.name }));
      });

      grp.appendChild(b);
      grp.appendChild(del);
      box.appendChild(grp);
    });
  }

  function saveCustomPreset() {
    var input = $('#presetName');
    var rawName = input ? input.value.trim() : '';
    var name = rawName || t('defaultPresetName', { count: userPresets.length + 1 });
    var patch = VF.extractPresetPatch(state);

    var existing = null;
    for (var i = 0; i < userPresets.length; i++) {
      if (userPresets[i].name.toLowerCase() === name.toLowerCase()) {
        existing = userPresets[i];
        break;
      }
    }

    if (existing) {
      existing.name = name;
      existing.patch = patch;
      activePreset = existing.id;
      showStatus(t('updated', { name: name }));
    } else {
      var newPreset = {
        id: 'user_' + Date.now(),
        name: name,
        desc: t('userPreset'),
        patch: patch
      };
      userPresets.push(newPreset);
      activePreset = newPreset.id;
      showStatus(t('saved', { name: name }));
    }

    if (input) input.value = '';
    persistUserPresets();
    renderPresets();
  }

  function exportPresetsJson() {
    var payload = {
      app: 'VIDEO FILTER',
      version: '1.0.5',
      exportedAt: new Date().toISOString(),
      state: VF.mergeState(state),
      userPresets: userPresets
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'video-filter-presets.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 500);
    showStatus(t('exported'));
  }

  function importPresetsJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result || '{}'));
        var importedCount = 0;

        if (Array.isArray(data.userPresets)) {
          data.userPresets.forEach(function (pr) {
            if (!pr || !pr.name || !pr.patch) return;
            var cleanPatch = VF.extractPresetPatch(pr.patch);
            var exists = userPresets.find(function (u) {
              return u.name.toLowerCase() === String(pr.name).toLowerCase();
            });
            if (exists) {
              exists.patch = cleanPatch;
            } else {
              userPresets.push({
                id: pr.id || ('user_' + Date.now() + '_' + importedCount),
                name: String(pr.name).slice(0, 28),
                desc: t('importedPreset'),
                patch: cleanPatch
              });
            }
            importedCount++;
          });
          persistUserPresets();
        }

        if (data.state && typeof data.state === 'object') {
          commit(data.state, false);
        } else if (data.patch && typeof data.patch === 'object') {
          var pName = data.name ? String(data.name).slice(0, 28) : t('importName');
          var id = 'user_' + Date.now();
          userPresets.push({
            id: id,
            name: pName,
            desc: t('importedPreset'),
            patch: VF.extractPresetPatch(data.patch)
          });
          persistUserPresets();
          activePreset = id;
          commit(Object.assign({ enabled: true }, data.patch), true);
          importedCount++;
        } else if (typeof data.aeBlur === 'number' || typeof data.hdrDetail === 'number') {
          commit(data, false);
        }

        renderPresets();
        showStatus(
          importedCount > 0
            ? t('imported', { count: importedCount })
            : t('applied')
        );
      } catch (err) {
        showStatus(t('importError'));
      }
    };
    reader.readAsText(file);
  }

  $('#savePresetBtn').addEventListener('click', saveCustomPreset);
  $('#presetName').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveCustomPreset();
    }
  });
  $('#exportPresetBtn').addEventListener('click', exportPresetsJson);
  $('#importPresetBtn').addEventListener('click', function () {
    var f = $('#importPresetFile');
    if (f) {
      f.value = '';
      f.click();
    }
  });
  $('#importPresetFile').addEventListener('change', function (e) {
    var file = e.target && e.target.files && e.target.files[0];
    if (file) importPresetsJson(file);
  });

  /* --------------------------- модули параметров (СОЗДАЮТСЯ ОДИН РАЗ) --------------------------- */

  function buildToggle(p) {
    var wrap = document.createElement('div');
    wrap.className = 'row';
    var label = document.createElement('div');
    label.className = 'row-label';
    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.label;
    var hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = p.hint || '';
    label.appendChild(name);
    label.appendChild(hint);

    var t = document.createElement('button');
    t.type = 'button';
    t.className = 'tgl';
    t.setAttribute('role', 'switch');
    var dot = document.createElement('span');
    dot.className = 'dot';
    var txt = document.createElement('span');
    t.appendChild(dot);
    t.appendChild(txt);

    t.addEventListener('click', function () {
      var patch = {};
      patch[p.key] = !state[p.key];
      commit(patch, false);
    });

    controlRefs[p.key] = { type: 'toggle', btn: t, txt: txt, param: p, label: name, hint: hint };

    wrap.appendChild(label);
    wrap.appendChild(t);
    return wrap;
  }

  function buildRange(p) {
    var wrap = document.createElement('div');
    wrap.className = 'row';

    var label = document.createElement('div');
    label.className = 'row-label';
    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.label;
    var hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = p.hint || '';
    label.appendChild(name);
    label.appendChild(hint);

    var foot = document.createElement('div');
    foot.className = 'row-foot';

    var input = document.createElement('input');
    input.type = 'range';
    input.min = String(p.min);
    input.max = String(p.max);
    input.step = String(p.step);
    input.value = String(state[p.key]);
    input.style.setProperty('--fill', fill(p, state[p.key]));

    var out = document.createElement('output');
    out.className = 'val';
    out.textContent = fmt(p, state[p.key]);

    function startDrag() {
      draggingKey = p.key;
    }
    function endDrag() {
      if (draggingKey === p.key) {
        draggingKey = null;
        persistState(true);
        sendToTabsImmediate();
      }
    }

    input.addEventListener('pointerdown', startDrag);
    input.addEventListener('mousedown', startDrag);
    input.addEventListener('touchstart', startDrag, { passive: true });

    input.addEventListener('pointerup', endDrag);
    input.addEventListener('mouseup', endDrag);
    input.addEventListener('touchend', endDrag);
    input.addEventListener('blur', endDrag);

    input.addEventListener('input', function () {
      draggingKey = p.key;
      var v = parseFloat(input.value);
      if (!isFinite(v)) return;
      state[p.key] = v;
      input.style.setProperty('--fill', fill(p, v));
      out.textContent = fmt(p, v);
      if (activePreset) {
        activePreset = '';
        renderPresets();
      }
      sendToTabsThrottled();
      persistState(false);
    });

    input.addEventListener('change', function () {
      var v = parseFloat(input.value);
      if (isFinite(v)) state[p.key] = v;
      draggingKey = null;
      sendToTabsImmediate();
      persistState(true);
    });

    controlRefs[p.key] = { type: 'range', input: input, out: out, param: p, label: name, hint: hint };

    foot.appendChild(input);
    foot.appendChild(out);
    wrap.appendChild(label);
    wrap.appendChild(foot);
    return wrap;
  }

  function buildEnum(p) {
    var wrap = document.createElement('div');
    wrap.className = 'row';
    var label = document.createElement('div');
    label.className = 'row-label';
    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.label;
    var hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = p.hint || '';
    label.appendChild(name);
    label.appendChild(hint);

    var seg = document.createElement('div');
    seg.className = 'seg';
    var buttons = [];

    p.options.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = o.l;
      b.dataset.val = o.v;
      b.addEventListener('click', function () {
        var patch = {};
        patch[p.key] = o.v;
        commit(patch, false);
      });
      buttons.push(b);
      seg.appendChild(b);
    });

    controlRefs[p.key] = { type: 'enum', buttons: buttons, param: p, label: name, hint: hint };

    wrap.appendChild(label);
    wrap.appendChild(seg);
    return wrap;
  }

  function buildSectionsOnce() {
    var root = $('#sections');
    if (!root) return;
    root.innerHTML = '';
    controlRefs = {};

    VF.SCHEMA.forEach(function (group) {
      var mod = document.createElement('section');
      mod.className = 'mod';
      mod.dataset.module = group.id;

      var head = document.createElement('div');
      head.className = 'mod-head';
      var part = document.createElement('span');
      part.className = 'mod-part';
      part.textContent = group.part;
      var h2 = document.createElement('h2');
      h2.textContent = group.title;
      head.appendChild(part);
      head.appendChild(h2);

      var note = document.createElement('p');
      note.className = 'note';
      note.textContent = group.note;

      mod.appendChild(head);
      mod.appendChild(note);

      group.params.forEach(function (p) {
        if (p.key === 'enabled') return; // вынесен в шапку
        if (p.type === 'toggle') mod.appendChild(buildToggle(p));
        else if (p.type === 'range') mod.appendChild(buildRange(p));
        else mod.appendChild(buildEnum(p));
      });

      root.appendChild(mod);
    });
  }

  /** Обновляет значения контролов на месте без пересоздания DOM-элементов. */
  function syncControls(skipKey) {
    Object.keys(controlRefs).forEach(function (key) {
      var ref = controlRefs[key];
      var val = state[key];

      if (ref.type === 'toggle') {
        var on = Boolean(val);
        ref.btn.setAttribute('aria-checked', on ? 'true' : 'false');
        ref.txt.textContent = t(on ? 'on' : 'off');
      } else if (ref.type === 'range') {
        if (key === skipKey) return; // не трогаем ползунок, который сейчас тянет мышь
        ref.input.value = String(val);
        ref.input.style.setProperty('--fill', fill(ref.param, val));
        ref.out.textContent = fmt(ref.param, val);
      } else if (ref.type === 'enum') {
        ref.buttons.forEach(function (b) {
          b.className = b.dataset.val === String(val) ? 'on' : '';
        });
      }
    });
  }

  /* --------------------------- сайт --------------------------- */

  function renderSite() {
    var btn = $('#siteBtn');
    if (!btn) return;
    var blocked = currentHost && hosts.indexOf(currentHost) !== -1;
    btn.textContent = currentHost ? t(blocked ? 'enableSite' : 'disableSite', { host: currentHost }) : t('unavailableSite');
    btn.disabled = !currentHost;
    btn.classList.toggle('active', !!blocked);
  }

  $('#siteBtn').addEventListener('click', function () {
    if (!currentHost) return;
    var i = hosts.indexOf(currentHost);
    if (i === -1) hosts.push(currentHost); else hosts.splice(i, 1);

    try {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ vfDisabled: hosts }, function () { void chrome.runtime.lastError; });
      }
      if (chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.set({ vfDisabled: hosts }, function () { void chrome.runtime.lastError; });
      }
    } catch (e) {}

    renderSite();
    syncComparison();
    updateBadge();
    sendToTabsImmediate();
  });

  $('#resetBtn').addEventListener('click', function () {
    activePreset = 'original';
    commit(VF.DEFAULTS, true);
    showStatus(t('resetDone'));
  });

  /* --------------------------- старт --------------------------- */

  function syncUI(skipKey) {
    localizeMenu();
    renderMaster();
    renderPresets();
    syncControls(skipKey);
    renderSite();
    syncComparison();
  }

  buildSectionsOnce();
  syncUI(null);

  // Загружаем сохранённое состояние (приоритет у local, резерв — sync)
  chrome.storage.local.get({ vfState: null, vfDisabled: null, vfUserPresets: null, vfPreferences: null }, function (loc) {
    void chrome.runtime.lastError;
    chrome.storage.sync.get({ vfState: null, vfDisabled: [], vfUserPresets: [], vfPreferences: null }, function (syn) {
      void chrome.runtime.lastError;

      var rawState = (loc && loc.vfState) || (syn && syn.vfState) || null;
      var rawHosts = (loc && Array.isArray(loc.vfDisabled)) ? loc.vfDisabled : ((syn && syn.vfDisabled) || []);
      var rawPresets = (loc && Array.isArray(loc.vfUserPresets)) ? loc.vfUserPresets : ((syn && syn.vfUserPresets) || []);

      if (rawState) state = VF.mergeState(rawState);
      preferences = VF.mergePreferences((loc && loc.vfPreferences) || (syn && syn.vfPreferences));
      if (Array.isArray(rawHosts)) hosts = rawHosts;
      if (Array.isArray(rawPresets)) userPresets = rawPresets;

      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        void chrome.runtime.lastError;
        var url = tabs && tabs[0] && tabs[0].url;
        try { currentHost = url ? new URL(url).hostname : ''; } catch (e) { currentHost = ''; }
        syncUI(draggingKey);
        updateBadge();
      });

      syncUI(draggingKey);
    });
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' && area !== 'sync') return;
    // Пока пользователь тянет ползунок — игнорируем внешние эхо-события storage
    if (draggingKey) return;

    if (changes.vfState && changes.vfState.newValue) {
      state = VF.mergeState(changes.vfState.newValue);
      syncUI(null);
      updateBadge();
    }
    if (changes.vfDisabled) {
      hosts = changes.vfDisabled.newValue || [];
      renderSite();
      updateBadge();
    }
    if (changes.vfUserPresets) {
      userPresets = changes.vfUserPresets.newValue || [];
      renderPresets();
    }
    if (changes.vfPreferences) {
      preferences = VF.mergePreferences(changes.vfPreferences.newValue);
      syncUI(null);
    }
  });
})();
