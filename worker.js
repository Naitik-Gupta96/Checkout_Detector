const keyFor = tabId => `watch-${tabId}`;
const badge = (tabId, text) => chrome.action.setBadgeText({ tabId, text });
const pending = new Map();

function inTab(tabId, work) {
  const result = (pending.get(tabId) || Promise.resolve()).catch(() => {}).then(work);
  pending.set(tabId, result);
  const release = () => { if (pending.get(tabId) === result) pending.delete(tabId); };
  result.then(release, release);
  return result;
}

async function watch(tabId, url) {
  const origin = new URL(url).origin;
  if (!/^https?:/.test(origin)) throw new Error("Page unavailable");
  const key = keyFor(tabId);
  const existing = (await chrome.storage.session.get(key))[key];
  if (existing?.origin !== origin) await chrome.storage.session.set({ [key]: { origin } });
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["rules.js", "ui.js", "scanner.js"] });
  } catch (error) {
    await stop(tabId);
    throw error;
  }
}

async function stop(tabId) {
  await chrome.storage.session.remove(keyFor(tabId));
  await Promise.allSettled([chrome.tabs.sendMessage(tabId, { type: "dispose" }), badge(tabId, "")]);
}

chrome.tabs.onRemoved.addListener(tabId => {
  inTab(tabId, () => chrome.storage.session.remove(keyFor(tabId))).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== "complete") return;
  inTab(tabId, async () => {
    const key = keyFor(tabId);
    const session = (await chrome.storage.session.get(key))[key];
    if (!session) return;
    if (!tab.url || new URL(tab.url).origin !== session.origin) await stop(tabId);
    else await watch(tabId, tab.url);
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const fromPopup = sender.url === chrome.runtime.getURL("popup.html");
  async function handle() {
    if (message.type === "start" && fromPopup) {
      const tab = await chrome.tabs.get(message.tabId);
      await watch(tab.id, tab.url);
      return { ok: true };
    }
    if (message.type === "stop" && fromPopup) {
      await stop(message.tabId);
      return { ok: true };
    }
    if (!sender.tab || sender.frameId !== 0) return {};
    const key = keyFor(sender.tab.id);
    const session = (await chrome.storage.session.get(key))[key];
    if (!session || sender.origin !== session.origin) return { active: false };
    if (message.type === "stopFromPage") {
      await stop(sender.tab.id);
      return { ok: true };
    }
    if (message.type === "load") return { active: true, cart: session.cart, dismissed: session.dismissed, touched: session.touched };
    if (message.type === "update") {
      const dismissed = Array.isArray(message.dismissed) ? message.dismissed.slice(0, 200) : session.dismissed;
      const touched = Array.isArray(message.touched) ? message.touched.slice(0, 40) : session.touched;
      await chrome.storage.session.set({ [key]: { ...session, cart: message.cart || session.cart, dismissed, touched } });
      await chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: message.count ? "#b4530f" : "#6f45ed" });
      await chrome.action.setBadgeTextColor?.({ tabId: sender.tab.id, color: "#ffffff" });
      await badge(sender.tab.id, message.count > 99 ? "99+" : message.count ? String(message.count) : "•");
      return { active: true };
    }
    return {};
  }
  const tabId = fromPopup ? message.tabId : sender.tab?.id;
  inTab(tabId, handle).then(reply, () => reply({ ok: false }));
  return true;
});
