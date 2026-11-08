const planEl = document.getElementById('plan');
const statusEl = document.getElementById('status');
const runBtn = document.getElementById('run');
const exampleBtn = document.getElementById('example');

exampleBtn.addEventListener('click', () => {
  planEl.value = JSON.stringify({
    steps: [
      { action: 'navigate', url: 'https://example.com' },
      { action: 'wait', ms: 1500 },
      { action: 'scroll', y: 400 }
    ]
  }, null, 2);
});

runBtn.addEventListener('click', async () => {
  statusEl.textContent = 'Выполняю...';
  statusEl.className = 'status';
  try {
    const plan = JSON.parse(planEl.value);
    const response = await chrome.runtime.sendMessage({ type: 'EXECUTE_PLAN', plan });
    if (response.success) {
      statusEl.textContent = 'Готово: ' + JSON.stringify(response.result);
    } else {
      statusEl.textContent = 'Ошибка: ' + response.error;
      statusEl.className = 'status error';
    }
  } catch (e) {
    statusEl.textContent = 'Ошибка: ' + e.message;
    statusEl.className = 'status error';
  }
});
