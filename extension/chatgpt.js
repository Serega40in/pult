(() => {
  const INSTALLED = "data-pult-button-installed";
  const RESULT_CLASS = "pult-execution-result";

  function isPultCode(code) {
    return code.classList.contains("language-pult") ||
      (code.getAttribute("data-language") || "").toLowerCase() === "pult";
  }

  function addExecutionButton(pre, code) {
    if (pre.hasAttribute(INSTALLED) || !isPultCode(code)) return;
    pre.setAttribute(INSTALLED, "true");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "▶ Выполнить в PULT";
    button.style.cssText = "display:block;margin-top:8px;padding:8px 12px;border:0;border-radius:9px;background:#16835d;color:#fff;font:600 13px system-ui;cursor:pointer";
    const status = document.createElement("div");
    status.style.cssText = "margin-top:6px;font:12px system-ui;color:var(--text-secondary,#777);white-space:pre-wrap";

    button.addEventListener("click", async () => {
      let plan;
      try { plan = JSON.parse(code.textContent.trim()); }
      catch { status.textContent = "Не удалось прочитать JSON в блоке pult."; return; }
      if (!Array.isArray(plan && plan.steps)) { status.textContent = "В плане должен быть массив steps."; return; }
      button.disabled = true;
      button.textContent = "Выполняю…";
      status.textContent = "Команда передана выбранной вкладке. Не закрывай её до завершения.";
      try {
        const response = await chrome.runtime.sendMessage({ type: "PULT_EXECUTE_PLAN", plan: plan });
        if (!response || !response.ok) throw new Error(response && response.error || "Неизвестная ошибка PULT.");
        const result = response.result;
        button.textContent = result.ok ? "✓ Выполнено" : "⚠ Остановлено";
        status.textContent = result.results.map((item, i) => (i + 1) + ". " + item.action + ": " + (item.ok ? "OK" : item.error)).join("\n");
        addResultActions(pre, result);
      } catch (error) {
        button.disabled = false;
        button.textContent = "▶ Повторить в PULT";
        status.textContent = "Ошибка: " + error.message;
      }
    });
    pre.insertAdjacentElement("afterend", button);
    button.insertAdjacentElement("afterend", status);
  }

  function addResultActions(anchor, result) {
    const old = anchor.parentElement && anchor.parentElement.querySelector("." + RESULT_CLASS);
    if (old) old.remove();
    const wrapper = document.createElement("div");
    wrapper.className = RESULT_CLASS;
    wrapper.style.cssText = "margin:8px 0 16px;padding:10px;border:1px solid var(--border-light,#aaa);border-radius:10px;font:12px system-ui";
    const title = document.createElement("div");
    title.textContent = result.ok ? "Результат PULT готов" : "PULT остановил выполнение";
    title.style.cssText = "font-weight:700;margin-bottom:6px";
    wrapper.appendChild(title);
    const details = document.createElement("pre");
    details.textContent = JSON.stringify(result, null, 2);
    details.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;margin:0 0 8px";
    wrapper.appendChild(details);
    const insert = document.createElement("button");
    insert.type = "button";
    insert.textContent = "Добавить результат в чат";
    insert.style.cssText = "padding:7px 10px;border:0;border-radius:8px;background:var(--main-surface-primary,#ddd);cursor:pointer";
    insert.addEventListener("click", () => {
      const text = "Результат выполнения PULT:\n" + JSON.stringify(result, null, 2) + "\n\nПродолжи задачу с учётом фактического результата.";
      const inserted = insertIntoComposer(text);
      insert.textContent = inserted ? "Результат добавлен в поле сообщения" : "Не найдено поле сообщения — скопируй результат из блока выше";
    });
    wrapper.appendChild(insert);

    // A second, explicit user click can submit the verified result back to ChatGPT.
    // It never sends anything automatically after a browser plan finishes.
    const sendBack = document.createElement("button");
    sendBack.type = "button";
    sendBack.textContent = "↩ Добавить и отправить результат";
    sendBack.style.cssText = "margin-left:6px;padding:7px 10px;border:0;border-radius:8px;background:#16835d;color:#fff;cursor:pointer";
    sendBack.addEventListener("click", async () => {
      sendBack.disabled = true;
      const text = "Результат выполнения PULT:\\n" + JSON.stringify(result, null, 2) + "\\n\\nПродолжи задачу с учётом фактического результата.";
      const inserted = insertIntoComposer(text);
      if (!inserted) {
        sendBack.disabled = false;
        sendBack.textContent = "Не удалось вставить — скопируй результат выше";
        return;
      }
      sendBack.textContent = "Текст добавлен…";
      await new Promise(resolve => setTimeout(resolve, 250));
      const submit = document.querySelector('button[data-testid="send-button"]') ||
        document.querySelector('button[aria-label="Send prompt"]') ||
        document.querySelector('button[aria-label="Отправить сообщение"]');
      if (submit && !submit.disabled) {
        submit.click();
        sendBack.textContent = "✓ Результат отправлен в чат";
      } else {
        sendBack.disabled = false;
        sendBack.textContent = "Текст вставлен — нажми «Отправить»";
      }
    });
    wrapper.appendChild(sendBack);
    anchor.insertAdjacentElement("afterend", wrapper);
  }

  function insertIntoComposer(text) {
    const editor = document.querySelector("#prompt-textarea") ||
      document.querySelector('[contenteditable="true"][data-testid="prompt-textarea"]') ||
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      document.querySelector('textarea[data-testid="prompt-textarea"]');
    if (!editor) return false;
    editor.focus();
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), "value");
      if (descriptor && descriptor.set) descriptor.set.call(editor, text);
      else editor.value = text;
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return true;
    }
    try {
      document.execCommand("insertText", false, text);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return true;
    } catch { return false; }
  }

  function scan() {
    document.querySelectorAll("pre").forEach(pre => {
      const code = pre.querySelector("code");
      if (code) addExecutionButton(pre, code);
    });
  }

  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
