const planEl = document.getElementById("plan");
const statusEl = document.getElementById("status");
const bridgeStatusEl = document.getElementById("bridgeStatus");
const runBtn = document.getElementById("run");
const exampleBtn = document.getElementById("example");
let currentOrigin = null;

async function refreshBridgeStatus() {
  const state = await chrome.storage.local.get(["bridgeConnected", "bridgeError"]);
  bridgeStatusEl.textContent = state.bridgeConnected
    ? "● PULT Bridge подключён"
    : "○ PULT Bridge не подключён — " + (state.bridgeError || "проверь настройки");
  bridgeStatusEl.className = state.bridgeConnected ? "status" : "status error";
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.bridgeConnected || changes.bridgeError)) refreshBridgeStatus();
});

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  try {
    const parsed = new URL(tab.url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      currentOrigin = parsed.origin + "/*";
    }
  } catch {}
});

document.getElementById("settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("grantSite").addEventListener("click", async () => {
  if (!currentOrigin) {
    statusEl.textContent = "Для этой страницы нельзя запросить разрешение.";
    statusEl.className = "status error";
    return;
  }
  try {
    const granted = await chrome.permissions.request({ origins: [currentOrigin] });
    statusEl.textContent = granted ? "Доступ к сайту разрешён." : "Разрешение не предоставлено.";
    statusEl.className = granted ? "status" : "status error";
  } catch (error) {
    statusEl.textContent = "Ошибка разрешения: " + error.message;
    statusEl.className = "status error";
  }
});

exampleBtn.addEventListener("click", () => {
  planEl.value = JSON.stringify({
    steps: [
      { action: "navigate", url: "https://example.com" },
      { action: "wait", ms: 1500 },
      { action: "read_page" },
      { action: "scroll", y: 400 }
    ]
  }, null, 2);
});

runBtn.addEventListener("click", async () => {
  statusEl.textContent = "Выполняю...";
  statusEl.className = "status";
  try {
    const plan = JSON.parse(planEl.value);
    const response = await chrome.runtime.sendMessage({ type: "EXECUTE_PLAN", plan });
    if (response.success) {
      statusEl.textContent = "Готово: " + JSON.stringify(response.result).slice(0, 1200);
    } else {
      statusEl.textContent = "Ошибка: " + response.error;
      statusEl.className = "status error";
    }
  } catch (error) {
    statusEl.textContent = "Ошибка: " + error.message;
    statusEl.className = "status error";
  }
});

refreshBridgeStatus().catch(() => {
  bridgeStatusEl.textContent = "Не удалось проверить состояние Bridge.";
});
