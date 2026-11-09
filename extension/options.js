const urlEl = document.getElementById("url");
const tokenEl = document.getElementById("token");
const statusEl = document.getElementById("status");

async function loadSettings() {
  const saved = await chrome.storage.local.get(["bridgeUrl", "bridgeToken"]);
  if (saved.bridgeUrl) urlEl.value = saved.bridgeUrl;
  if (saved.bridgeToken) tokenEl.value = saved.bridgeToken;
}

document.getElementById("save").addEventListener("click", async () => {
  const bridgeUrl = urlEl.value.trim();
  const bridgeToken = tokenEl.value.trim();

  if (bridgeUrl !== "ws://127.0.0.1:8765/v1/browser/ws") {
    statusEl.textContent = "В MVP разрешён только локальный адрес ws://127.0.0.1:8765/v1/browser/ws.";
    return;
  }
  if (!bridgeToken) {
    statusEl.textContent = "Введи токен расширения.";
    return;
  }

  await chrome.storage.local.set({ bridgeUrl, bridgeToken });
  statusEl.textContent = "Сохранено. Перезапускаю подключение…";
  chrome.runtime.sendMessage({ type: "PULT_RECONNECT" }).catch(() => {});
});

loadSettings().catch((error) => {
  statusEl.textContent = "Не удалось загрузить настройки: " + error.message;
});
