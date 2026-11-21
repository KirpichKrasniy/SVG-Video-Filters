/**
 * VIDEO FILTER 1.0 — фоновый сервис-воркер (MV3).
 *
 * Отвечает за:
 *   - хоткей Alt+Shift+F (переключение фильтра на активной вкладке);
 *   - бейдж ON/OFF на иконке;
 *   - значения по умолчанию при первой установке.
 */

chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.get({ vfState: null, vfDisabled: null, vfUserPresets: null }, function (res) {
    void chrome.runtime.lastError;
    var patch = {};
    if (!res || !res.vfState) patch.vfState = {};
    if (!res || !Array.isArray(res.vfDisabled)) patch.vfDisabled = [];
    if (!res || !Array.isArray(res.vfUserPresets)) patch.vfUserPresets = [];
    if (Object.keys(patch).length) {
      chrome.storage.local.set(patch, function () { void chrome.runtime.lastError; });
    }
  });

  chrome.storage.sync.get({ vfState: null, vfDisabled: null, vfUserPresets: null }, function (res) {
    void chrome.runtime.lastError;
    var patch = {};
    if (!res || !res.vfState) patch.vfState = {};
    if (!res || !Array.isArray(res.vfDisabled)) patch.vfDisabled = [];
    if (!res || !Array.isArray(res.vfUserPresets)) patch.vfUserPresets = [];
    if (Object.keys(patch).length) {
      chrome.storage.sync.set(patch, function () { void chrome.runtime.lastError; });
    }
  });

  chrome.action.setBadgeBackgroundColor({ color: '#38E08C' });
  chrome.action.setBadgeText({ text: 'ON' });
});

// Горячая клавиша: переключаем фильтр в активной вкладке.
chrome.commands.onCommand.addListener(function (command) {
  if (command !== 'toggle-filter') return;
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    if (!tab || tab.id == null) return;
    chrome.tabs.sendMessage(tab.id, { type: 'VF_TOGGLE' }, function () {
      void chrome.runtime.lastError;
    });
  });
});

// Бейдж приходит от content script'а верхнего фрейма.
chrome.runtime.onMessage.addListener(function (msg) {
  if (!msg || msg.type !== 'VF_STATUS') return;
  chrome.action.setBadgeText({ text: msg.enabled ? 'ON' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: msg.enabled ? '#38E08C' : '#FF9E2C' });
});
