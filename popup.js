const $ = selector => document.querySelector(selector);
const statusBox = $("#status");
const headline = $("#headline");
const detail = $("#detail");
const stateLabel = $("#state-label");
const steps = $("#steps");
const baseline = $("#baseline");
const toggle = $("#toggle");
const findings = $("#findings");
const count = $("#count");
const empty = $("#empty");
const alertTools = $("#alert-tools");
const copyStatus = $("#copy-status");
const diagnosticsButton = $("#diagnostics");
const diagnosticsStatus = $("#diagnostics-status");
let activeTab;
let watching = false;
let working = false;
let denied = false;
let lastView;
let currentSignals = [];

const { brand, element, finding, style } = CheckoutUI;
document.head.append(style());
$("#brand").append(brand());

for (const [title, , kind] of Object.values(CheckoutRules.rules)) {
  $(kind ? "#additional" : "#categories").append(element("li", title));
}

const tabs = [$("#alerts-tab"), $("#coverage-tab")];
function selectView(selected) {
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute("aria-selected", active);
    tab.tabIndex = active ? 0 : -1;
    $(`#${tab.getAttribute("aria-controls")}`).hidden = !active;
  }
}
for (const tab of tabs) {
  tab.addEventListener("click", () => selectView(tab));
  tab.addEventListener("keydown", event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const next = tabs[(tabs.indexOf(tab) + 1) % tabs.length];
    selectView(next);
    next.focus();
  });
}

async function copy(text, status) {
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "Copied";
  } catch {
    status.textContent = "Couldn’t copy";
  }
}

$("#copy").addEventListener("click", () => {
  const report = currentSignals.map(item => `${item.title}\n${item.signal}\nOn page: ${item.evidence}`).join("\n\n");
  copy(`Checkout Detector · ${new URL(activeTab.url).hostname}\n\n${report}`, copyStatus);
});

$("#undo").addEventListener("click", async () => {
  await chrome.tabs.sendMessage(activeTab.id, { type: "restore" }).catch(() => null);
  refresh();
});

diagnosticsButton.addEventListener("click", async () => {
  const report = await chrome.tabs.sendMessage(activeTab.id, { type: "diagnostics" }).catch(() => null);
  if (!report) {
    diagnosticsStatus.textContent = "Start watching this tab first";
    return;
  }
  copy(JSON.stringify(report, null, 2), diagnosticsStatus);
});

function setStep(item, state) {
  if (state) item.dataset.step = state;
  else delete item.dataset.step;
  item.querySelector(".marker").textContent = state === "done" ? "✓" : item.id === "step-cart" ? "1" : "2";
}

function describe(status, supported) {
  const signals = status?.findings || [];
  if (denied || !supported) {
    return ["idle", "Not available", "Can’t check this page", "Open a shopping site’s cart in a normal tab, then start watching."];
  }
  if (!watching) {
    return ["idle", "Not watching", "Check before you pay", "Open your cart, then start watching. Each checkout step is compared until payment."];
  }
  if (status.loading) return ["watching", "Watching this tab", "Reading this page…", "Looking for prices, fees, and selected options."];
  const onPayment = status.stage === "payment";
  if (signals.length) {
    const noun = signals.length === 1 ? "thing" : "things";
    return ["alert", "Watching this tab", `${signals.length} ${noun} to check before you pay`,
      onPayment ? "Compare these with your cart before paying." : "Review these before you continue."];
  }
  if (onPayment && !status.hasCart) {
    return ["watching", "Watching this tab", "Open the cart first", "The detector needs to see your cart to spot fees added at payment."];
  }
  if (onPayment) return ["watching", "Watching this tab", "No new fees since your cart", "Still check the total and any selected add-ons before paying."];
  if (status.stage === "cart") return ["watching", "Watching this tab", "Cart recorded", "Nothing to flag yet. Continue to payment and the fees will be compared."];
  return ["watching", "Watching this tab", "Waiting for your cart", "Open the cart to start the fee comparison. Page-wide checks are already running."];
}

async function refresh() {
  if (!activeTab || working) return;
  const status = await chrome.tabs.sendMessage(activeTab.id, { type: "status" }).catch(() => null);
  if (working) return;
  watching = Boolean(status?.active);
  const supported = /^https?:\/\//.test(activeTab.url || "");
  const [state, label, title, text] = describe(status, supported);
  statusBox.dataset.state = state;
  stateLabel.textContent = label;
  headline.textContent = title;
  detail.textContent = text;
  toggle.textContent = watching ? "Stop watching" : "Start watching";
  toggle.dataset.active = String(watching);
  toggle.disabled = !supported;
  diagnosticsButton.disabled = !watching;

  steps.hidden = !watching || status.loading;
  if (!steps.hidden) {
    setStep($("#step-cart"), status.hasCart ? "done" : status.stage === "cart" ? "current" : null);
    setStep($("#step-payment"), status.stage === "payment" ? "current" : null);
  }
  const recorded = watching && status.baseline;
  baseline.hidden = !recorded;
  if (recorded) {
    const { labels, total } = status.baseline;
    const parts = [labels.length ? labels.join(", ") : "no separate fees", total && `total ${total}`].filter(Boolean);
    baseline.replaceChildren(element("strong", "From your cart: "), parts.join(" · "));
  }

  const signals = status?.findings || [];
  currentSignals = signals;
  alertTools.hidden = !signals.length;
  count.textContent = String(signals.length);
  count.dataset.alert = String(signals.length > 0);
  empty.hidden = signals.length > 0;
  empty.textContent = !watching ? "Start watching to see alerts for this tab."
    : status.dismissed ? "No open alerts." : "No alerts on this screen.";
  $("#dismissed-tools").hidden = !watching || !status.dismissed;
  $("#dismissed-count").textContent = `${status?.dismissed || 0} dismissed`;

  const view = JSON.stringify(signals.map(({ key, evidence, signal }) => [key, evidence, signal]));
  if (view === lastView) return;
  lastView = view;
  copyStatus.textContent = "";
  findings.replaceChildren(...signals.map(item => finding(item, {
    reveal: async () => {
      const result = await chrome.tabs.sendMessage(activeTab.id, {
        type: "show", key: item.key, evidence: item.evidence
      }).catch(() => null);
      if (result?.shown) window.close();
      return Boolean(result?.shown);
    },
    dismiss: async () => {
      await chrome.tabs.sendMessage(activeTab.id, { type: "dismiss", key: item.key, evidence: item.evidence }).catch(() => null);
      refresh();
    }
  })));
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
  if (activeTab?.url) $("#site").textContent = new URL(activeTab.url).hostname;
  await refresh();
  setInterval(refresh, 850);
})();
