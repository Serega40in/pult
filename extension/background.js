const CHAT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
let lastBrowserTabId = null;

function isChatUrl(url) {
  try { return CHAT_HOSTS.has(new URL(url || "").hostname); }
  catch { return false; }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url && !isChatUrl(tab.url)) lastBrowserTabId = tabId;
  } catch {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab && tab.url && !isChatUrl(tab.url)) lastBrowserTabId = tabId;
});

async function listBrowserTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.filter(tab => tab.id != null && /^https?:/.test(tab.url || "") && !isChatUrl(tab.url))
    .map(tab => ({
      id: tab.id,
      title: (tab.title || "Без названия").slice(0, 120),
      url: tab.url || "",
      active: Boolean(tab.active)
    }));
}

async function resolveTargetTab() {
  const stored = await chrome.storage.local.get("targetTabId");
  if (Number.isInteger(stored.targetTabId)) {
    try {
      const tab = await chrome.tabs.get(stored.targetTabId);
      if (tab && tab.id != null && /^https?:/.test(tab.url || "") && !isChatUrl(tab.url)) return tab;
    } catch {}
  }
  if (lastBrowserTabId != null) {
    try {
      const tab = await chrome.tabs.get(lastBrowserTabId);
      if (tab && tab.id != null && /^https?:/.test(tab.url || "") && !isChatUrl(tab.url)) return tab;
    } catch { lastBrowserTabId = null; }
  }
  const tabs = await listBrowserTabs();
  if (!tabs.length) throw new Error("Не найдена обычная вкладка. Открой сайт и выбери его в PULT.");
  const selected = tabs.find(tab => tab.active) || tabs[0];
  await chrome.storage.local.set({ targetTabId: selected.id });
  return chrome.tabs.get(selected.id);
}

async function readPage(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      title: document.title || "",
      url: location.href,
      text: (document.body && document.body.innerText || "").slice(0, 16000)
    })
  });
  if (!results[0] || !results[0].result) throw new Error("Не удалось прочитать страницу.");
  return results[0].result;
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.steps)) throw new Error("План должен содержать массив steps.");
  if (plan.steps.length < 1 || plan.steps.length > 8) throw new Error("В одном плане должно быть от 1 до 8 шагов.");
  plan.steps.forEach((step, index) => {
    if (!step || typeof step !== "object" || typeof step.action !== "string") throw new Error("Шаг " + (index + 1) + ": некорректная команда.");
    switch (step.action) {
      case "navigate": {
        if (typeof step.url !== "string" || step.url.length > 2048) throw new Error("Шаг " + (index + 1) + ": неверный URL.");
        let parsed;
        try { parsed = new URL(step.url); } catch { throw new Error("Шаг " + (index + 1) + ": неверный URL."); }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("PULT открывает только HTTP/HTTPS-сайты.");
        break;
      }
      case "read_page":
        break;
      case "click":
        if (typeof step.selector !== "string" || !step.selector.trim() || step.selector.length > 500) throw new Error("Шаг " + (index + 1) + ": нужен CSS-селектор не длиннее 500 символов.");
        break;
      case "type":
        if (typeof step.selector !== "string" || !step.selector.trim() || step.selector.length > 500 || typeof step.text !== "string" || step.text.length > 2000) throw new Error("Шаг " + (index + 1) + ": некорректное поле или текст (максимум 2000 символов).");
        break;
      case "scroll":
        if (!Number.isInteger(step.y) || Math.abs(step.y) > 2000) throw new Error("Шаг " + (index + 1) + ": прокрутка должна быть от -2000 до 2000 px.");
        break;
      case "wait":
        if (!Number.isInteger(step.ms) || step.ms < 0 || step.ms > 3000) throw new Error("Шаг " + (index + 1) + ": ожидание должно быть от 0 до 3000 мс.");
        break;
      default:
        throw new Error("Шаг " + (index + 1) + ": команда «" + step.action + "» не поддерживается.");
    }
  });
}

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise(resolve => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    const timer = setTimeout(finish, timeoutMs || 12000);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function executeStep(tabId, step) {
  if (step.action === "navigate") {
    const loaded = waitForTabLoad(tabId, 12000);
    await chrome.tabs.update(tabId, { url: step.url });
    await loaded;
    const tab = await chrome.tabs.get(tabId);
    return { action: step.action, ok: true, title: tab.title || "", url: tab.url || step.url };
  }
  if (step.action === "wait") {
    await new Promise(resolve => setTimeout(resolve, step.ms));
    return { action: step.action, ok: true, waited_ms: step.ms };
  }
  if (step.action === "read_page") return Object.assign({ action: step.action, ok: true }, await readPage(tabId));

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    args: [step],
    func: command => {
      const sensitive = el => {
        const type = (el.getAttribute("type") || "").toLowerCase();
        const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
        return type === "password" || type === "hidden" || type === "file" ||
          /password|cc-|credit-card|one-time-code|token|webauthn/.test(autocomplete);
      };
      if (command.action === "scroll") {
        window.scrollBy({ top: command.y, behavior: "instant" });
        return { action: "scroll", ok: true, scrolled_px: command.y };
      }
      let element;
      try { element = document.querySelector(command.selector); }
      catch { return { error: "Некорректный CSS-селектор." }; }
      if (!element) return { error: "Элемент не найден: " + command.selector };
      if (sensitive(element)) return { error: "PULT не взаимодействует с паролями, скрытыми и платёжными полями." };
      if (command.action === "click") {
        const tag = element.tagName.toLowerCase();
        const type = (element.getAttribute("type") || "").toLowerCase();
        if (tag === "form" || type === "submit" || (tag === "button" && !type && element.closest("form"))) {
          return { error: "Отправка формы заблокирована. Нажми кнопку отправки самостоятельно." };
        }
        element.click();
        return { action: "click", ok: true, element: tag, text: (element.innerText || element.getAttribute("aria-label") || "").trim().slice(0, 100) };
      }
      if (command.action === "type") {
        const tag = element.tagName.toLowerCase();
        if (tag !== "input" && tag !== "textarea" && !element.isContentEditable) return { error: "Можно вводить текст только в поле ввода или редактируемый элемент." };
        if (tag === "input" && ["button", "submit", "reset", "checkbox", "radio", "image"].includes((element.type || "").toLowerCase())) return { error: "Этот тип поля не предназначен для ввода текста." };
        element.focus();
        if (element.isContentEditable) element.textContent = command.text;
        else {
          const prototype = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, "value") && Object.getOwnPropertyDescriptor(prototype, "value").set;
          if (setter) setter.call(element, command.text);
          else element.value = command.text;
        }
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: command.text }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return { action: "type", ok: true, characters: command.text.length };
      }
      return { error: "Неизвестная команда." };
    }
  });
  if (!results[0] || !results[0].result) throw new Error("Страница не вернула результат команды.");
  return results[0].result;
}

async function executePlanLocally(plan) {
  validatePlan(plan);
  const tab = await resolveTargetTab();
  const results = [];
  for (const step of plan.steps) {
    const result = await executeStep(tab.id, step);
    results.push(result);
    if (result.error) break;
  }
  const summary = {
    ok: results.every(item => item.ok),
    tab: { title: tab.title || "", url: tab.url || "" },
    results,
    completed_at: new Date().toISOString()
  };
  await chrome.storage.local.set({ lastResult: summary });
  return summary;
}


function normalizeApiBaseUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || "").trim()); }
  catch { throw new Error("Укажи корректный HTTPS-адрес QUN Agent Core."); }
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localHost)) {
    throw new Error("API должен использовать HTTPS. HTTP разрешён только для localhost при разработке.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Адрес API не должен содержать логин, пароль, параметры или фрагмент.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

async function apiRequest(settings, path, options = {}) {
  const headers = { "Content-Type": "application/json", "Accept": "application/json" };
  if (settings.token) headers.Authorization = "Bearer " + settings.token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(settings.baseUrl + path, {
      method: options.method || "POST",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal
    });
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error("QUN Agent Core вернул не JSON. Проверь адрес API."); }
    if (!response.ok || !payload || payload.ok !== true) {
      throw new Error((payload && payload.error) || ("Ошибка QUN Agent Core: HTTP " + response.status));
    }
    return payload;
  } catch (error) {
    if (error && error.name === "AbortError") throw new Error("QUN Agent Core не ответил за 15 секунд.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getApiSettings() {
  const stored = await chrome.storage.local.get(["apiBaseUrl", "apiDeviceToken", "apiDeviceId", "apiDeviceName"]);
  return {
    baseUrl: stored.apiBaseUrl || "",
    token: stored.apiDeviceToken || "",
    deviceId: stored.apiDeviceId || "",
    deviceName: stored.apiDeviceName || ""
  };
}

async function connectAgentDevice(message) {
  const baseUrl = normalizeApiBaseUrl(message.baseUrl);
  const pairingCode = String(message.pairingCode || "").trim().toLowerCase();
  const deviceId = String(message.deviceId || "pult-chrome-main").trim().toLowerCase();
  const name = String(message.deviceName || "PULT Chrome").trim().slice(0, 100) || "PULT Chrome";
  if (!/^[a-f0-9]{64}$/.test(pairingCode)) {
    throw new Error("Код подключения должен быть одноразовым кодом из 64 шестнадцатеричных символов.");
  }
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(deviceId)) {
    throw new Error("ID устройства: латиница в нижнем регистре, цифры и дефисы; 3–64 символа.");
  }

  const response = await apiRequest({ baseUrl, token: "" }, "/pult/pair", {
    body: { pairingCode, deviceId, name, version: "0.3.0" }
  });
  if (!response.deviceToken || !response.device || response.device.device_id !== deviceId) {
    throw new Error("Сервер не вернул корректные данные подключённого устройства.");
  }
  await chrome.storage.local.set({
    apiBaseUrl: baseUrl,
    apiDeviceToken: response.deviceToken,
    apiDeviceId: deviceId,
    apiDeviceName: response.device.name || name
  });
  await startAgentAlarm();
  await checkAgentQueue();
  return { connected: true, deviceId, deviceName: response.device.name || name };
}

async function agentHeartbeat(settings) {
  return apiRequest(settings, "/pult/heartbeat", {
    body: { deviceId: settings.deviceId }
  });
}

async function peekAgentCommand(settings) {
  await agentHeartbeat(settings);
  return apiRequest(settings, "/pult/peek", {
    body: { deviceId: settings.deviceId }
  });
}

async function checkAgentQueue() {
  const settings = await getApiSettings();
  if (!settings.baseUrl || !settings.token || !settings.deviceId) {
    try { await chrome.action.setBadgeText({ text: "" }); } catch {}
    return { connected: false, command: null };
  }
  try {
    const data = await peekAgentCommand(settings);
    if (data.command && data.command.command_id) {
      await chrome.action.setBadgeBackgroundColor({ color: "#16835d" });
      await chrome.action.setBadgeText({ text: "1" });
      await chrome.action.setTitle({ title: "PULT: ожидает подтверждения задания" });
      await chrome.storage.local.set({ pultPendingCommandId: data.command.command_id });
    } else {
      await chrome.action.setBadgeText({ text: "" });
      await chrome.action.setTitle({ title: "PULT Lite — браузерный агент подключён" });
      await chrome.storage.local.remove("pultPendingCommandId");
    }
    return { connected: true, command: data.command || null, validationError: data.validationError || null };
  } catch (error) {
    await chrome.action.setTitle({ title: "PULT API: " + (error.message || String(error)).slice(0, 100) });
    return { connected: true, error: error.message || String(error), command: null };
  }
}

async function executeAgentCommand(command) {
  const args = command.args && typeof command.args === "object" ? command.args : {};
  switch (command.action) {
    case "browser.execute_plan":
      return executePlanLocally({ steps: args.steps });
    case "browser.open_url":
      if (typeof args.url !== "string") throw new Error("В команде browser.open_url отсутствует URL.");
      return executePlanLocally({ steps: [{ action: "navigate", url: args.url }] });
    case "browser.read_active_page":
      return executePlanLocally({ steps: [{ action: "read_page" }] });
    case "browser.list_tabs":
      return {
        ok: true,
        tabs: (await listBrowserTabs()).slice(0, 40),
        completed_at: new Date().toISOString()
      };
    default:
      throw new Error("PULT не поддерживает действие «" + String(command.action) + "».");
  }
}

async function executeQueuedAgentCommand(commandId) {
  const settings = await getApiSettings();
  if (!settings.baseUrl || !settings.token || !settings.deviceId) {
    throw new Error("Сначала подключи PULT к QUN Agent Core.");
  }
  const claim = await apiRequest(settings, "/pult/claim", {
    body: { deviceId: settings.deviceId, commandId }
  });
  const command = claim.command;
  if (!command) throw new Error("Сервер не передал задание на выполнение.");

  let result;
  try {
    result = await executeAgentCommand(command);
  } catch (error) {
    result = {
      ok: false,
      tab: {},
      results: [{ action: command.action, ok: false, error: error.message || String(error) }],
      completed_at: new Date().toISOString()
    };
  }

  let syncError = null;
  try {
    await apiRequest(settings, "/pult/result", {
      body: {
        deviceId: settings.deviceId,
        commandId: command.command_id,
        status: result.ok ? "succeeded" : "failed",
        result,
        error: result.ok ? undefined : (result.results || []).map(item => item.error || item.action).filter(Boolean).join("; ").slice(0, 2000)
      }
    });
  } catch (error) {
    syncError = error.message || String(error);
  }

  const finalResult = {
    ...result,
    pultCommandId: command.command_id,
    pultAction: command.action,
    api: syncError ? { synced: false, error: syncError } : { synced: true, status: result.ok ? "succeeded" : "failed" }
  };
  await chrome.storage.local.set({ lastResult: finalResult });
  await checkAgentQueue();
  return { ok: true, result: finalResult, commandId: command.command_id };
}

async function rejectQueuedAgentCommand(commandId) {
  const settings = await getApiSettings();
  if (!settings.baseUrl || !settings.token || !settings.deviceId) {
    throw new Error("Сначала подключи PULT к QUN Agent Core.");
  }
  const result = await apiRequest(settings, "/pult/reject", {
    body: { deviceId: settings.deviceId, commandId }
  });
  await checkAgentQueue();
  return result;
}

const AGENT_ALARM = "pult-agent-queue-check";
async function startAgentAlarm() {
  try {
    await chrome.alarms.create(AGENT_ALARM, { periodInMinutes: 0.5 });
  } catch {}
}
chrome.runtime.onInstalled.addListener(() => { startAgentAlarm(); });
chrome.runtime.onStartup.addListener(() => { startAgentAlarm(); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm && alarm.name === AGENT_ALARM) checkAgentQueue();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message && message.type === "PULT_LIST_TABS") {
      const tabs = await listBrowserTabs();
      const stored = await chrome.storage.local.get("targetTabId");
      return { ok: true, tabs, targetTabId: Number.isInteger(stored.targetTabId) ? stored.targetTabId : null };
    }
    if (message && message.type === "PULT_SET_TARGET") {
      const tab = await chrome.tabs.get(message.tabId);
      if (!tab || !tab.url || !/^https?:/.test(tab.url) || isChatUrl(tab.url)) throw new Error("Выбери обычную вкладку с сайтом.");
      await chrome.storage.local.set({ targetTabId: tab.id });
      return { ok: true, tabId: tab.id, title: tab.title || "" };
    }
    if (message && message.type === "PULT_READ_PAGE") {
      const tab = await resolveTargetTab();
      return { ok: true, tab: { id: tab.id, title: tab.title || "", url: tab.url || "" }, page: await readPage(tab.id) };
    }
    if (message && message.type === "PULT_API_STATUS") {
      const settings = await getApiSettings();
      return { ok: true, connected: Boolean(settings.baseUrl && settings.token), baseUrl: settings.baseUrl, deviceId: settings.deviceId, deviceName: settings.deviceName };
    }
    if (message && message.type === "PULT_API_PAIR") {
      return { ok: true, device: await connectAgentDevice(message) };
    }
    if (message && message.type === "PULT_API_DISCONNECT") {
      const settings = await getApiSettings();
      if (settings.baseUrl && settings.token && settings.deviceId) {
        await apiRequest(settings, "/pult/disconnect", { body: { deviceId: settings.deviceId } });
      }
      await chrome.storage.local.remove(["apiBaseUrl", "apiDeviceToken", "apiDeviceId", "apiDeviceName", "pultPendingCommandId"]);
      await chrome.action.setBadgeText({ text: "" });
      return { ok: true, disconnected: true };
    }
    if (message && message.type === "PULT_AGENT_PEEK") {
      return { ok: true, ...(await checkAgentQueue()) };
    }
    if (message && message.type === "PULT_AGENT_EXECUTE_PENDING") {
      if (typeof message.commandId !== "string") throw new Error("Не передан ID задания.");
      return await executeQueuedAgentCommand(message.commandId);
    }
    if (message && message.type === "PULT_AGENT_REJECT") {
      if (typeof message.commandId !== "string") throw new Error("Не передан ID задания.");
      return { ok: true, result: await rejectQueuedAgentCommand(message.commandId) };
    }
    if (message && message.type === "PULT_EXECUTE_PLAN") return { ok: true, result: await executePlan(message.plan) };
    if (message && message.type === "PULT_GET_LAST_RESULT") {
      const stored = await chrome.storage.local.get("lastResult");
      return { ok: true, result: stored.lastResult || null };
    }
    throw new Error("Неизвестная команда PULT.");
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});
