// PULT Browser Agent - Background service worker

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXECUTE_PLAN') {
    executePlan(message.plan)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // async
  }
});

async function executePlan(plan) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab');

  const results = [];
  for (const step of plan.steps || []) {
    const result = await executeStep(tab.id, step);
    results.push(result);
    if (result.error) break;
  }
  return results;
}

async function executeStep(tabId, step) {
  switch (step.action) {
    case 'navigate':
      await chrome.tabs.update(tabId, { url: step.url });
      await waitForLoad(tabId);
      return { action: 'navigate', url: step.url, ok: true };

    case 'click':
      return await chrome.scripting.executeScript({
        target: { tabId },
        func: (selector) => {
          const el = document.querySelector(selector);
          if (!el) return { error: `Element not found: ${selector}` };
          el.click();
          return { ok: true, selector };
        },
        args: [step.selector]
      }).then(r => r[0].result);

    case 'type':
      return await chrome.scripting.executeScript({
        target: { tabId },
        func: (selector, text) => {
          const el = document.querySelector(selector);
          if (!el) return { error: `Element not found: ${selector}` };
          el.focus();
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, selector, textLength: text.length };
        },
        args: [step.selector, step.text]
      }).then(r => r[0].result);

    case 'scroll':
      return await chrome.scripting.executeScript({
        target: { tabId },
        func: (y) => {
          window.scrollBy(0, y || 500);
          return { ok: true, scrolled: y || 500 };
        },
        args: [step.y]
      }).then(r => r[0].result);

    case 'wait':
      await new Promise(r => setTimeout(r, step.ms || 1000));
      return { ok: true, waited: step.ms || 1000 };

    default:
      return { error: `Unknown action: ${step.action}` };
  }
}

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // timeout
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 10000);
  });
}
