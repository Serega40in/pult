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
const deviceId = document.getElementById("deviceId");
const deviceName = document.getElementById("deviceName");
const pairingSecret = document.getElementById("pairingSecret");
const apiConnect = document.getElementById("apiConnect");
const apiDisconnect = document.getElementById("apiDisconnect");
const apiStatus = document.getElementById("apiStatus");

const queueRefreshButton = document.getElementById("queueRefresh");
const queueStatus = document.getElementById("queueStatus");
const queuePreview = document.getElementById("queuePreview");
const queueExecute = document.getElementById("queueExecute");
const queueReject = document.getElementById("queueReject");
let pendingCommand = null;
let pendingValidationError = null;

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
    showResult("Страница прочитана. Скопируй её и вставь в чат.");
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
    const response = await send({ type: "PULT_EXECUTE_PLAN", plan });
    showResult(response.result);
  } catch (error) { showResult(error.message); }
  finally { runButton.disabled = false; runButton.textContent = "Проверить и выполнить"; }
});

async function refreshApiStatus() {
  try {
    const state = await send({ type: "PULT_API_STATUS" });
    if (state.baseUrl) apiUrl.value = state.baseUrl;
    if (state.deviceId) deviceId.value = state.deviceId;
    if (state.deviceName) deviceName.value = state.deviceName;
    apiDisconnect.disabled = !state.connected;
    apiConnect.textContent = state.connected ? "Переподключить" : "Подключить Supabase";
    apiStatus.textContent = state.connected
      ? "✓ Подключено к QUN Agent Core: " + (state.deviceName || state.deviceId) + " · " + state.baseUrl
      : "Локальный режим. Подключение к Supabase не настроено.";
  } catch (error) {
    apiStatus.textContent = "Не удалось проверить подключение: " + error.message;
  }
}

function renderPendingCommand(command, validationError) {
  pendingCommand = command || null;
  pendingValidationError = validationError || null;
  if (!pendingCommand) {
    queueStatus.textContent = "Очередь пуста. Новые задания появятся здесь.";
    queuePreview.textContent = "Нет ожидающих заданий.";
    queueExecute.disabled = true;
    queueReject.disabled = true;
    return;
  }
  queueStatus.textContent = "Задание " + pendingCommand.command_id + " · " + pendingCommand.action + ". Проверь план перед выполнением.";
  queuePreview.textContent = JSON.stringify({
    command_id: pendingCommand.command_id,
    action: pendingCommand.action,
    args: pendingCommand.args,
    created_at: pendingCommand.created_at,
    validation_error: pendingValidationError
  }, null, 2);
  queueExecute.disabled = Boolean(pendingValidationError);
  queueReject.disabled = false;
}

async function refreshAgentQueue() {
  queueRefreshButton.disabled = true;
  queueRefreshButton.textContent = "Проверяю…";
  try {
    const response = await send({ type: "PULT_AGENT_PEEK" });
    if (!response.connected) {
      renderPendingCommand(null, null);
      queueStatus.textContent = "Сначала подключи PULT к Supabase.";
      return;
    }
    if (response.error) {
      renderPendingCommand(null, null);
      queueStatus.textContent = "Ошибка очереди: " + response.error;
      return;
    }
    renderPendingCommand(response.command, response.validationError);
  } catch (error) {
    renderPendingCommand(null, null);
    queueStatus.textContent = "Не удалось проверить очередь: " + error.message;
  } finally {
    queueRefreshButton.disabled = false;
    queueRefreshButton.textContent = "Проверить очередь";
  }
}

apiConnect.addEventListener("click", async () => {
  apiConnect.disabled = true;
  apiConnect.textContent = "Подключаю…";
  try {
    const result = await send({
      type: "PULT_API_PAIR",
      baseUrl: apiUrl.value,
      deviceId: deviceId.value,
      deviceName: deviceName.value,
      pairingCode: pairingSecret.value
    });
    pairingSecret.value = "";
    await refreshApiStatus();
    showResult("PULT подключён к Supabase. Устройство: " + result.device.deviceName);
    await refreshAgentQueue();
  } catch (error) {
    showResult("Не удалось подключить PULT: " + error.message);
    apiStatus.textContent = error.message;
  } finally {
    apiConnect.disabled = false;
    if (apiConnect.textContent === "Подключаю…") apiConnect.textContent = "Подключить Supabase";
  }
});

apiDisconnect.addEventListener("click", async () => {
  apiDisconnect.disabled = true;
  try {
    await send({ type: "PULT_API_DISCONNECT" });
    await refreshApiStatus();
    renderPendingCommand(null, null);
    showResult("PULT отключён. Локальное выполнение команд продолжает работать.");
  } catch (error) {
    showResult("Не удалось отозвать подключение: " + error.message);
    apiDisconnect.disabled = false;
  }
});

queueRefreshButton.addEventListener("click", refreshAgentQueue);

queueExecute.addEventListener("click", async () => {
  if (!pendingCommand || pendingValidationError) return;
  const command = pendingCommand;
  queueExecute.disabled = true;
  queueReject.disabled = true;
  queueExecute.textContent = "Выполняю…";
  try {
    const response = await send({
      type: "PULT_AGENT_EXECUTE_PENDING",
      commandId: command.command_id
    });
    showResult(response.result);
    renderPendingCommand(null, null);
    await refreshAgentQueue();
  } catch (error) {
    showResult("Не удалось выполнить задание: " + error.message);
    await refreshAgentQueue();
  } finally {
    queueExecute.textContent = "Подтвердить и выполнить";
  }
});

queueReject.addEventListener("click", async () => {
  if (!pendingCommand) return;
  queueReject.disabled = true;
  queueExecute.disabled = true;
  try {
    await send({ type: "PULT_AGENT_REJECT", commandId: pendingCommand.command_id });
    showResult("Задание отклонено.");
    renderPendingCommand(null, null);
    await refreshAgentQueue();
  } catch (error) {
    showResult("Не удалось отклонить задание: " + error.message);
    await refreshAgentQueue();
  }
});

refreshTabs();
refreshApiStatus();
refreshAgentQueue();
