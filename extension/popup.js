const target = document.getElementById("target");
const refreshButton = document.getElementById("refresh");
const readButton = document.getElementById("read");
const copyButton = document.getElementById("copyPage");
const pageText = document.getElementById("pageText");
const planText = document.getElementById("plan");
const runButton = document.getElementById("run");
const resultBox = document.getElementById("result");
const selectedUrl = document.getElementById("selectedUrl");

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
refreshTabs();
