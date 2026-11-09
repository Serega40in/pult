// PULT Browser Agent - Manifest V3 service worker

let bridgeSocket = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let intentionallyClosed = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "EXECUTE_PLAN") {
    executePlan(message.plan)
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.type === "PULT_RECONNECT") {
    connectBridge(true);
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "PULT_STATUS") {
    chrome.storage.local.get(["bridgeConnected", "bridgeError"], (state) => {
      sendResponse({
        connected: Boolean(state.bridgeConnected),
        error: state.bridgeError || null
      });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => connectBridge(true));
chrome.runtime.onStartup.addListener(() => connectBridge(true));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.bridgeToken || changes.bridgeUrl)) {
    connectBridge(true);
  }
});

connectBridge();

// Chrome MV3 service workers may be suspended when idle. Periodic WebSocket
// traffic keeps an established local bridge connection alive.
setInterval(() => {
  if (bridgeSocket?.readyState === WebSocket.OPEN) {
    bridgeSocket.send(JSON.stringify({ type: "ping" }));
  }
}, 20000);

async function setConnectionState(connected, error = null) {
  await chrome.storage.local.set({
    bridgeConnected: connected,
    bridgeError: error
  });
}

async function connectBridge(force = false) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (bridgeSocket && (bridgeSocket.readyState === WebSocket.OPEN ||
      bridgeSocket.readyState === WebSocket.CONNECTING)) {
    if (!force) return;
    intentionallyClosed = true;
    bridgeSocket.close();
    bridgeSocket = null;
  }

  const settings = await chrome.storage.local.get(["bridgeUrl", "bridgeToken"]);
  const token = settings.bridgeToken;
  const url = settings.bridgeUrl || "ws://127.0.0.1:8765/v1/browser/ws";

  if (!token) {
    await setConnectionState(false, "Открой настройки PULT и укажи токен расширения.");
    return;
  }

  intentionallyClosed = false;
  try {
    const socket = new WebSocket(url);
    bridgeSocket = socket;

    socket.addEventListener("open", () => {
      reconnectDelay = 1000;
      socket.send(JSON.stringify({ type: "auth", token }));
    });

    socket.addEventListener("message", async (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === "ready") {
        await setConnectionState(true, null);
      } else if (message.type === "pong") {
        // Keepalive acknowledgement.
      } else if (message.type === "execute") {
        const response = await handleBridgeCommand(message);
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: "result",
            id: message.id,
            ok: response.ok,
            results: response.results || [],
            error: response.error || null
          }));
        }
      } else if (message.type === "error") {
        await setConnectionState(false, message.error || "Ошибка PULT Bridge");
      }
    });

    socket.addEventListener("close", async () => {
      if (bridgeSocket === socket) bridgeSocket = null;
      await setConnectionState(false, "Соединение с PULT Bridge закрыто.");
      if (!intentionallyClosed) scheduleReconnect();
    });

    socket.addEventListener("error", async () => {
      await setConnectionState(false, "Не удалось подключиться к локальному PULT Bridge.");
    });
  } catch (error) {
    await setConnectionState(false, error.message);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectBridge();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

async function handleBridgeCommand(message) {
  try {
    const result = await executePlan({ steps: message.steps });
    const failed = result.find((item) => item && item.error);
    return { ok: !failed, results: result, error: failed?.error || null };
  } catch (error) {
    return { ok: false, results: [], error: error.message };
  }
}

async function executePlan(plan) {
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > 20) {
    throw new Error("План должен содержать от 1 до 20 шагов.");
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("Нет активной вкладки.");

  const results = [];
  for (const step of plan.steps) {
    const result = await executeStep(tab.id, step);
    results.push(result);
    if (result?.error) break;
  }
  return results;
}

async function executeStep(tabId, step) {
  switch (step.action) {
    case "navigate": {
      const loaded = waitForLoad(tabId);
      await chrome.tabs.update(tabId, { url: step.url });
      await loaded;
      return { action: "navigate", url: step.url, ok: true };
    }

    case "click":
      return await chrome.scripting.executeScript({
        target: { tabId },
        func: (selector) => {
          const el = document.querySelector(selector);
          if (!el) return { error: `Element not found: ${selector}` };
          if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") {
            return { error: "Element is disabled" };
          }
          el.click();
          return { ok: true, selector };
        },
        args: [step.selector]
      }).then((items) => items[0]?.result);

    case "type":
      return await chrome.scripting.executeScript({
        target: { tabId },
        func: (selector, text) => {
          const el = document.querySelector(selector);
          if (!el) return { error: `Element not found: ${selector}` };
          if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) {
            return { error: "Target must be an input, textarea, or contenteditable element" };
          }
          if (el instanceof HTMLInputElement && ["password", "hidden"].includes(el.type)) {
            return { error: "PULT will not type into password or hidden fields" };
          }
          el.focus();
          if (el instanceof HTMLTextAreaElement) {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
            if (setter) setter.call(el, text);
            else el.value = text;
          } else if (el instanceof HTMLInputElement) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            if (setter) setter.call(el, text);
            else el.value = text;
          } else {
            el.textContent = text;
          }
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true, selector, textLength: text.length };
        },
        args: [step.selector, step.text]
      }).then((items) => items[0]?.result);

    case "scroll":
      return await chrome.scripting.executeScript({
        target: { tabId },
        func: (y) => {
          window.scrollBy(0, y);
          return { ok: true, scrolled: y };
        },
        args: [step.y]
      }).then((items) => items[0]?.result);

    case "read_page":
      return await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          ok: true,
          title: document.title,
          url: location.href,
          text: (document.body?.innerText || "").slice(0, 15000)
        })
      }).then((items) => items[0]?.result);

    case "wait":
      await new Promise((resolve) => setTimeout(resolve, step.ms));
      return { ok: true, waited: step.ms };

    default:
      return { error: `Unknown action: ${step.action}` };
  }
}

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeout);
      resolve();
    };
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === "complete") finish();
    };
    const timeout = setTimeout(finish, 15000);
    chrome.tabs.onUpdated.addListener(listener);
  });
}
