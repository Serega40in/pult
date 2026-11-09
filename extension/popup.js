const target = document.getElementById("target");
const refreshButton = document.getElementById("refresh");
const readButton = document.getElementById("read");
const copyButton = document.getElementById("copyPage");
const pageText = document.getElementById("pageText");
const planText = document.getElementById("plan");
const runButton = document.getElementById("run");
const resultBox = document.getElementById("result");
const selectedUrl = document.getElementById("selectedUrl");

const apiUrl = document.getElementById("apiUrl");
const deviceName = document.getElementById("deviceName");
const pairingSecret = document.getElementById("pairingSecret");
const apiConnect = document.getElementById("apiConnect");
const apiDisconnect = document.getElementById("apiDisconnect");
const apiStatus = document.getElementById("apiStatus");


function showResult(value) {
  resultBox.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || !response.ok) throw new Error(response && response.error || "Ошибка связи с PULT.");
  return response;
}
async function refreshTabs() {
  target.innerHTML = "";
  try {
    const response = await send({ type: "PULT_LIST_TABS" });
    if (!response.tabs.length) {
      target.add(new Option("Открой сайт в другой вкладке", ""));
      selectedUrl.textContent = "PULT управляет обычными HTTP/HTTPS-вкладками.";
      return;
    }
    response.tabs.forEach(tab => target.add(new Option(tab.title + " — " + tab.url, String(tab.id))));
    const selected = response.tabs.find(tab => tab.id === response.targetTabId) || response.tabs.find(tab => tab.active) || response.tabs[0];
    target.value = String(selected.id);
    selectedUrl.textContent = selected.url;
    await send({ type: "PULT_SET_TARGET", tabId: selected.id });
  } catch (error) { showResult(error.message); }
}
target.addEventListener("change", async () => {
  if (!target.value) return;
  try {
    const response = await send({ type: "PULT_SET_TARGET", tabId: Number(target.value) });
    selectedUrl.textContent = response.title || "Вкладка выбрана";
    showResult("Вкладка выбрана.");
  } catch (error) { showResult(error.message); }
});
refreshButton.addEventListener("click", refreshTabs);
readButton.addEventListener("click", async () => {
  readButton.disabled = true;
  readButton.textContent = "Читаю…";
  try {
    const response = await send({ type: "PULT_READ_PAGE" });
    pageText.value = "Страница: " + response.page.title + "\nURL: " + response.page.url + "\n\n" + response.page.text;
    copyButton.disabled = false;
    showResult("Страница прочитана. Скопируй её и вставь в чат, чтобы я мог продолжить работу с её содержимым.");
  } catch (error) { showResult(error.message); }
  finally { readButton.disabled = false; readButton.textContent = "Прочитать страницу"; }
});
copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(pageText.value);
    showResult("Текст страницы скопирован. Вставь его в чат.");
  } catch { showResult("Не удалось скопировать. Выдели текст в поле и нажми Ctrl+C."); }
});
runButton.addEventListener("click", async () => {
  let plan;
  try { plan = JSON.parse(planText.value); }
  catch { showResult("Ошибка JSON. Проверь скобки и кавычки."); return; }
  runButton.disabled = true;
  runButton.textContent = "Выполняю…";
  try {
    const response = await send({ type: "PULT_EXECUTE_PLAN", plan: plan });
    showResult(response.result);
  } catch (error) { showResult(error.message); }
  finally { runButton.disabled = false; runButton.textContent = "Проверить и выполнить"; }
});

async function refreshApiStatus() {
  try {
    const state = await send({ type: "PULT_API_STATUS" });
    if (state.baseUrl) apiUrl.value = state.baseUrl;
    if (state.deviceName) deviceName.value = state.deviceName;
    apiDisconnect.disabled = !state.connected;
    apiConnect.textContent = state.connected ? "Переподключить" : "Подключить API";
    pairingSecret.disabled = false;
    apiStatus.textContent = state.connected
      ? "✓ Подключено: " + (state.deviceName || "PULT Chrome") + " · " + state.baseUrl
      : "Локальный режим. API пока не подключён.";
  } catch (error) {
    apiStatus.textContent = "Не удалось проверить API: " + error.message;
  }
}

apiConnect.addEventListener("click", async () => {
  apiConnect.disabled = true;
  apiConnect.textContent = "Подключаю…";
  try {
    const result = await send({
      type: "PULT_API_PAIR",
      baseUrl: apiUrl.value,
      deviceName: deviceName.value,
      pairingSecret: pairingSecret.value
    });
    pairingSecret.value = "";
    await refreshApiStatus();
    showResult("PULT API подключён. Устройство зарегистрировано: " + result.device.deviceName);
  } catch (error) {
    showResult("Не удалось подключить PULT API: " + error.message);
    apiStatus.textContent = error.message;
  } finally {
    apiConnect.disabled = false;
    if (apiConnect.textContent === "Подключаю…") apiConnect.textContent = "Подключить API";
  }
});

apiDisconnect.addEventListener("click", async () => {
  apiDisconnect.disabled = true;
  try {
    await send({ type: "PULT_API_DISCONNECT" });
    await refreshApiStatus();
    showResult("PULT API отключён на этом устройстве. Локальный режим продолжает работать.");
  } catch (error) {
    showResult(error.message);
    apiDisconnect.disabled = false;
  }
});

refreshTabs();
refreshApiStatus();
