const headline = document.querySelector("#headline");
const detail = document.querySelector("#detail");
const progress = document.querySelector("#progress");
const toggle = document.querySelector("#toggle");
const findings = document.querySelector("#findings");
const scanState = document.querySelector("#state");
const stateLabel = document.querySelector("#state-label");
const count = document.querySelector("#count");
const empty = document.querySelector("#empty");
const alertTools = document.querySelector("#alert-tools");
const copyStatus = document.querySelector("#copy-status");
let activeTab;
let watching = false;
let working = false;
let denied = false;
let lastView;
let currentSignals = [];

const { brand, element, finding, style } = CheckoutUI;
document.head.append(style());
document.querySelector("#brand").append(brand());

for (const [title, , kind] of Object.values(CheckoutRules.rules)) {
  document.querySelector(kind ? "#additional" : "#categories").append(element("li", title));
}

const alertsTab = document.querySelector("#alerts-tab");
const coverageTab = document.querySelector("#coverage-tab");
function selectView(showAlerts) {
  alertsTab.setAttribute("aria-pressed", showAlerts);
  coverageTab.setAttribute("aria-pressed", !showAlerts);
  document.querySelector("#alerts-view").hidden = !showAlerts;
  document.querySelector("#coverage-view").hidden = showAlerts;
}
alertsTab.addEventListener("click", () => selectView(true));
coverageTab.addEventListener("click", () => selectView(false));
document.querySelector("#copy").addEventListener("click", async () => {
  try {
    const report = currentSignals.map(item => `${item.title}\n${item.signal}`).join("\n\n");
    await navigator.clipboard.writeText(report);
    copyStatus.textContent = "Copied";
  } catch {
    copyStatus.textContent = "Couldn’t copy";
  }
});

async function refresh() {
  if (!activeTab || working) return;
  const status = await chrome.tabs.sendMessage(activeTab.id, { type: "status" }).catch(() => null);
  if (working) return;
  watching = Boolean(status?.active);
  scanState.dataset.active = toggle.dataset.active = String(watching);
  stateLabel.textContent = watching ? "Watching this tab" : "Standby";
  progress.hidden = !watching || status.loading;
  if (!progress.hidden) {
    if (status.stage === "cart") {
      progress.textContent = status.hasCart ? "Cart recognized. Fee baseline saved." : "Cart recognized. Expand the bill details if available.";
    } else if (status.stage === "payment") {
      progress.textContent = status.hasCart ? "Payment screen recognized. Comparing with your cart." : "Payment screen recognized. Open the cart to capture fees first.";
    } else {
      progress.textContent = "Scanner active. No cart or payment screen recognized.";
    }
  }
  toggle.textContent = watching ? "Stop watching" : "Start watching";
  const supported = /^https?:\/\//.test(activeTab.url || "");
  toggle.disabled = !supported;
  const signals = status?.findings || [];
  currentSignals = signals;
  alertTools.hidden = !signals.length;
  count.textContent = String(signals.length);
  empty.hidden = signals.length > 0;
  empty.textContent = watching ? "No alerts on this screen." : "Start watching to see alerts for this tab.";
  if (denied || !supported) {
    headline.textContent = "Couldn’t check this page";
    detail.textContent = "Open a regular website and start watching from the cart.";
  } else if (!watching) {
    headline.textContent = "Check this checkout";
    detail.textContent = "Start from the cart. The toolbar badge counts findings as you shop.";
  } else if (status.loading) {
    headline.textContent = "Checking this page…";
    detail.textContent = "Looking for visible checkout and page signals.";
  } else if (signals.length) {
    headline.textContent = `${signals.length} ${signals.length === 1 ? "signal" : "signals"} to review`;
    detail.textContent = "Review the evidence below before paying.";
  } else if (status.stage) {
    headline.textContent = "No supported signals found";
    detail.textContent = status.stage === "payment" && !status.hasCart
      ? "Start from the cart to compare fees across steps."
      : "Review the total and selected options before paying.";
  } else {
    headline.textContent = "Watching for checkout signals";
    detail.textContent = "Open your cart to enable checkout checks. Some page-level checks run here.";
  }

  const view = JSON.stringify(signals.map(({ key, evidence, signal }) => [key, evidence, signal]));
  if (view === lastView) return;
  lastView = view;
  copyStatus.textContent = "";
  findings.replaceChildren();
  for (const item of signals) {
    findings.append(finding(item, async () => {
      const result = await chrome.tabs.sendMessage(activeTab.id, {
        type: "show", key: item.key, evidence: item.evidence
      }).catch(() => null);
      if (result?.shown) window.close();
      return Boolean(result?.shown);
    }));
  }
}

toggle.addEventListener("click", async () => {
  working = true;
  toggle.disabled = true;
  const response = await chrome.runtime.sendMessage({
    type: watching ? "stop" : "start", tabId: activeTab.id
  }).catch(() => null);
  denied = !response?.ok;
  working = false;
  await refresh();
});

(async () => {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.url) document.querySelector("#site").textContent = new URL(activeTab.url).hostname;
  await refresh();
  setInterval(refresh, 850);
})();
