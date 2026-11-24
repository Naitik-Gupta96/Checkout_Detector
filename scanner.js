(() => {
  if (globalThis.checkoutScannerRunning) return;
  globalThis.checkoutScannerRunning = true;

  const memory = {};
  const prompts = new Map();
  const choices = new Set();
  let targets = new Map();
  let result = { active: true, loading: true };
  let scheduled;
  let outline;
  let lastUpdate;
  let stopped = false;
  let interval;
  let donationCard;
  let clickedUncheckedDonation = false;
  let donationIncluded = false;
  let notice;
  let noticeKey;
  let noticeOpen = false;
  let previousCount = 0;

  const normalize = value => value?.replace(/\s+/g, " ").trim() || "";
  const label = element => normalize(element.getAttribute("aria-label") || element.innerText);
  function available(element) {
    const hidden = element.closest('[aria-hidden="true"]');
    return element.getClientRects().length > 0 && getComputedStyle(element).visibility === "visible" &&
      !element.closest("[inert]") && (!hidden || (onBlinkit && hidden === document.body));
  }
  const interactive = 'button,a[href],input[type="checkbox"],input[type="radio"],[role="button"],[role="checkbox"],[role="radio"],[aria-pressed]';
  const modal = 'dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]';
  const currency = /₹|\bINR\s*\d|\bRs\.?\s*\d|[$€£]\s*\d/i;
  const lineSelector = "main *,[role=main] *,h1,h2,h3,p,li,td,dt,dd,label,span,div,section,article,aside";
  const onBlinkit = /(?:^|\.)blinkit\.com$/i.test(location.hostname);
  const donationChoice = "feeding india donation";

  function cartDrawer() {
    const headings = [...document.querySelectorAll("h1,h2,h3,div,span,p,[role=heading]")];
    const visibleLabel = text => headings.find(element => !element.childElementCount &&
      normalize(element.textContent).toLowerCase() === text && available(element));
    const cart = visibleLabel("my cart");
    const bill = visibleLabel("bill details");
    if (!cart || !bill) return null;
    let drawer = bill.parentElement;
    while (drawer && !drawer.contains(cart)) drawer = drawer.parentElement;
    return drawer && drawer !== document.body && drawer !== document.documentElement ? drawer : null;
  }

  function billedDonation(scope, lines, entry) {
    const name = /^feeding india donation(?=\s|₹|$)/i;
    const row = /^feeding india donation\s*(₹\s*\d+(?:\.\d{1,2})?)$/i;
    donationCard = undefined;
    if (!onBlinkit || !scope) return null;

    let charge;
    for (const line of lines) {
      const element = targets.get(line.id);
      if (!scope.contains(element) || !name.test(line.text)) continue;
      if (row.test(line.text)) charge ??= line;
      if (!donationCard && /working towards|read more/i.test(line.text) && currency.test(line.text)) {
        donationCard = element;
      }
    }
    donationIncluded = Boolean(charge);
    if (donationIncluded && clickedUncheckedDonation) {
      choices.add(donationChoice);
      clickedUncheckedDonation = false;
    }
    if (!charge) return null;
    const amount = charge.text.match(row)[1].replace(/\s+/g, "");
    return {
      ...entry(donationCard || targets.get(charge.id), `Feeding India donation ${amount}`),
      selected: true,
      chosen: choices.has(donationChoice),
      billed: true
    };
  }

  function controlText(element) {
    const labels = Array.from(element.labels || [], item => item.innerText).join(" ");
    const direct = normalize(labels) || label(element);
    if (/^(?:₹|\$|€|£)\s*\d/.test(direct)) {
      const context = normalize(element.parentElement?.parentElement?.innerText);
      if (/\b(?:rider|driver)\b/i.test(context) && /\b(?:tip|thank)\b/i.test(context)) return `Rider tip ${direct}`;
    }
    return direct;
  }

  function selected(element) {
    return element.checked === true ||
      ["aria-checked", "aria-pressed", "aria-selected"].some(name => element.getAttribute(name) === "true") ||
      (currency.test(label(element)) && element.classList.contains("chip") && element.classList.contains("on"));
  }

  function snapshot() {
    targets = new Map();
    const drawer = onBlinkit ? cartDrawer() : null;
    const prioritized = selector => new Set([
      ...(drawer?.querySelectorAll(selector) || []), ...document.querySelectorAll(selector)
    ]);
    const entry = (element, text) => {
      const id = targets.size;
      targets.set(id, element);
      return { id, text };
    };
    const controls = [...prioritized(interactive)].filter(available).slice(0, 600).flatMap(element => {
      const text = controlText(element);
      if (!text || text.length > 240) return [];
      const style = getComputedStyle(element);
      return [{
        ...entry(element, text),
        context: normalize(element.closest(modal + ",fieldset")?.innerText || element.parentElement?.innerText).slice(0, 320),
        selected: selected(element), chosen: choices.has(text.toLowerCase()),
        toggleable: element.matches('input[type="checkbox"],[role="checkbox"],[role="switch"],[aria-pressed]'),
        required: element.required || element.getAttribute("aria-required") === "true",
        font: parseFloat(style.fontSize), opacity: Number(style.opacity)
      }];
    });
    const lines = [];
    const seen = new Set();
    for (const element of prioritized(lineSelector)) {
      const text = normalize(element.textContent);
      if (!text || text.length > 260 || seen.has(text) || !available(element)) continue;
      const visibleText = normalize(element.innerText);
      if (visibleText.length < 4 || visibleText.length > 260 || seen.has(visibleText)) continue;
      if (element.children.length > 4) continue;
      if ([...element.children].some(child => normalize(child.innerText) === visibleText)) continue;
      seen.add(visibleText);
      const line = entry(element, visibleText);
      if (/\b(?:unlock by adding|add(?:ing)?|shop for)\s+(?:₹|INR|Rs\.?|\$|€|£)/i.test(visibleText)) {
        line.nearby = [];
        let parent = element.parentElement;
        for (let depth = 0; parent && parent !== document.body && depth < 3; depth++, parent = parent.parentElement) {
          const context = normalize(parent.innerText);
          if (context.length > 480) break;
          line.nearby.push(context);
        }
      }
      lines.push(line);
      if (lines.length === 900) break;
    }
    const dialogs = [...document.querySelectorAll(modal)].filter(available).slice(0, 20).map(element => {
      const text = normalize(element.innerText).slice(0, 240);
      const key = promptKey(element);
      const previous = prompts.get(key);
      const reappeared = Boolean(previous?.reappeared || (previous?.dismissed && !previous.visible));
      if (prompts.size < 100 || previous) {
        prompts.set(key, { visible: true, dismissed: Boolean(previous?.dismissed && !reappeared), reappeared });
      }
      const actions = controls.filter(item => element.contains(targets.get(item.id)));
      return {
        ...entry(element, text), key, reappeared,
        accept: actions.find(item => /^(?:yes|accept|allow|continue|start|apply|join|sign up|subscribe|enable|get|add|claim)\b/i.test(item.text)),
        decline: actions.find(item => /^(?:no\b|decline|reject|skip|dismiss|close|maybe later|not now)/i.test(item.text))
      };
    });
    const visiblePrompts = new Set(dialogs.map(item => item.key));
    for (const [key, item] of prompts) if (!visiblePrompts.has(key)) item.visible = false;

    const links = [...document.querySelectorAll("a[href]")].filter(available).slice(0, 500).flatMap(element => {
      const text = label(element).slice(0, 140);
      const card = element.closest("article,li,[role=listitem],section") || element.parentElement;
      const context = normalize(card?.innerText).slice(0, 500);
      if (!text || !/\b(?:recommended|top pick|you may (?:also )?like|related (?:items|products)|suggested|editor.s choice)\b/i.test(context)) return [];
      const url = URL.canParse(element.href, location.href) ? new URL(element.href, location.href) : null;
      if (!url || !/^https?:$/.test(url.protocol)) return [];
      const adSignal = /(?:^|\s)sponsored(?:\s|$)/i.test(element.rel) ||
        ["gclid", "ad_id", "adid", "adclick", "sponsored"].some(tag => url.searchParams.has(tag));
      return [{ ...entry(element, text), adSignal, disclosed: /\b(?:sponsored|advertisement|paid promotion|paid partnership|ad)\b/i.test(context) }];
    });
    const headings = [...document.querySelectorAll("h1,h2,h3,[role=heading]")].filter(available).map(label);
    const route = location.pathname.replace(/[-_/]/g, " ");
    const hasTotal = lines.some(item => /^(?:order total|grand total|bill total|total payable|to pay|amount payable|total)(?:\s|:|₹|\$|€|£)/i.test(item.text) && currency.test(item.text));
    const stage = CheckoutRules.checkoutStage({ headings, lines, controls, route, hasTotal }) || (drawer ? "cart" : null);
    const donation = billedDonation(drawer, lines, entry);
    if (donation) controls.unshift(donation);
    return { lines, controls, dialogs, links, stage, hasTotal };
  }

  function promptKey(element) {
    return (element.getAttribute("aria-label") || label(element.querySelector("h1,h2,h3,[role=heading]") || element))
      .slice(0, 120).toLowerCase();
  }

  function onClick(event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    if (donationCard?.contains(event.target)) {
      const bounds = donationCard.getBoundingClientRect();
      if (!donationIncluded && event.clientX >= bounds.left + bounds.width * 0.75) clickedUncheckedDonation = true;
    }
    const element = event.target.closest(interactive) ||
      event.target.closest("label")?.control;
    if (!element) return;
    const text = controlText(element);
    if (text && choices.size < 500) choices.add(text.toLowerCase());
    const dialog = element.closest(modal);
    if (dialog && /^(?:no\b|decline|reject|skip|dismiss|close|maybe later|not now|[×✕])/.test(text.toLowerCase())) {
      const key = promptKey(dialog);
      if (prompts.has(key)) {
        prompts.get(key).dismissed = true;
      }
    }
    queueScan();
  }

  function scan() {
    scheduled = undefined;
    if (stopped) return;
    const page = snapshot();
    const findings = CheckoutRules.detect(page, memory);
    result = { active: true, stage: page.stage, findings, hasCart: Boolean(memory.cart) };
    renderNotice(result);
    const update = JSON.stringify({ cart: memory.cart, count: findings.length });
    if (update !== lastUpdate) {
      lastUpdate = update;
      chrome.runtime.sendMessage({ type: "update", ...JSON.parse(update) }).then(response => {
        if (response?.active === false) dispose();
      }).catch(() => { lastUpdate = undefined; });
    }
  }

  function renderNotice(status) {
    const { findings, stage, hasCart } = status;
    if (findings.length && !previousCount) noticeOpen = true;
    previousCount = findings.length;
    if (!noticeOpen && !findings.length && !stage) {
      notice?.host.remove();
      notice = undefined;
      return;
    }
    if (!notice?.host.isConnected) {
      notice = createNotice();
      noticeKey = undefined;
    }
    const { box, summary, toggle, list, footer } = notice;
    box.dataset.open = String(noticeOpen);
    list.hidden = footer.hidden = !noticeOpen;
    toggle.textContent = noticeOpen ? "−" : "+";
    toggle.setAttribute("aria-label", noticeOpen ? "Minimize checkout alerts" : "Expand checkout alerts");
    toggle.setAttribute("aria-expanded", noticeOpen);
    const phase = stage === "payment" ? "Payment" : stage === "cart" ? "Cart" : "Page";
    const summaryText = findings.length ? `${findings.length} to review · ${phase}` : `Watching · ${phase}`;
    if (summary.textContent !== summaryText) summary.textContent = summaryText;
    summary.dataset.alert = String(findings.length > 0);
    const key = JSON.stringify([findings.map(({ key, evidence, signal }) => [key, evidence, signal]), stage, hasCart]);
    if (key === noticeKey) return;
    noticeKey = key;
    const scroll = list.scrollTop;
    list.replaceChildren(...findings.map(item => CheckoutUI.finding(item, finding => {
      const shown = revealFinding(finding);
      if (shown) {
        noticeOpen = false;
        renderNotice(result);
        toggle.focus({ preventScroll: true });
      }
      return shown;
    })));
    if (!findings.length) {
      const message = stage === "payment" && !hasCart ? "Open the cart first to compare fees." : "No supported signals on this screen.";
      list.append(CheckoutUI.element("p", message, "empty"));
    }
    list.scrollTop = scroll;
  }

  function createNotice() {
    const { brand, element, style } = CheckoutUI;
    const host = element("div");
    host.style.cssText = "all:initial;position:fixed;bottom:16px;left:16px;max-width:calc(100vw - 32px);z-index:2147483646";
    const shadow = host.attachShadow({ mode: "closed" });
    const box = element("section", undefined, "dock");
    box.setAttribute("aria-label", "Checkout Detector on-page alerts");
    const header = element("header");
    const heading = brand();
    const summary = element("p", undefined, "summary");
    summary.setAttribute("role", "status");
    heading.lastElementChild.append(summary);
    const toggle = element("button", undefined, "icon-button");
    toggle.type = "button";
    toggle.addEventListener("click", () => {
      noticeOpen = !noticeOpen;
      renderNotice(result);
    });
    box.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !noticeOpen) return;
      event.stopPropagation();
      noticeOpen = false;
      renderNotice(result);
      toggle.focus();
    });
    header.append(heading, toggle);

    const list = element("div", undefined, "list");
    list.id = "checkout-detector-findings";
    toggle.setAttribute("aria-controls", list.id);
    const footer = element("footer");
    const stop = element("button", "Stop watching", "action");
    stop.type = "button";
    stop.addEventListener("click", async () => {
      stop.disabled = true;
      const response = await chrome.runtime.sendMessage({ type: "stopFromPage" }).catch(() => null);
      if (!response?.ok && !stopped) {
        stop.textContent = "Retry stop";
        stop.disabled = false;
      }
    });
    footer.append(stop);
    box.append(header, list, footer);
    shadow.append(style(`
      .dock { width: min(264px, calc(100vw - 32px)); overflow: hidden; color: var(--ink);
        color-scheme: dark; font: 13px/1.5 system-ui, "Segoe UI", sans-serif;
        border: 1px solid #416052; border-radius: 13px; background: var(--base);
        box-shadow: 0 10px 30px #0009; }
      .dock[data-open="true"] { width: min(384px, calc(100vw - 32px)); }
      header { padding: 10px 12px; display: flex; justify-content: space-between; align-items: center;
        gap: 10px; background: linear-gradient(120deg, #1b302c, #152431 72%); }
      .summary { color: var(--lime); font-size: 11px; font-weight: 600; }
      .summary[data-alert="true"] { color: var(--amber); }
      .list { max-height: min(380px, max(100px, 100vh - 145px)); overflow: auto; overscroll-behavior: contain;
        display: grid; gap: 8px; padding: 10px; scrollbar-color: #506778 var(--base); scrollbar-width: thin; }
      .list[hidden], footer[hidden] { display: none; }
      .empty { color: var(--muted); padding: 4px; }
      footer { padding: 7px 10px; border-top: 1px solid var(--stroke); }
      footer button { font-size: 12px; }
      @media (max-width: 760px) {
        .dock[data-open="true"] { width: min(324px, calc(100vw - 32px)); }
        .list { max-height: min(310px, max(100px, 100vh - 145px)); }
      }
    `), box);
    document.body.append(host);
    return { host, box, summary, toggle, list, footer };
  }

  function revealFinding(item) {
    const current = result.findings?.find(match => match.key === item.key && match.evidence === item.evidence);
    return Boolean(current && show(current.target));
  }

  function queueScan() {
    scheduled ??= setTimeout(scan, 250);
  }

  function show(target) {
    const element = targets.get(target);
    if (!element?.isConnected) return false;
    outline?.remove();
    element.scrollIntoView({ block: "center", behavior: "instant" });
    const rect = element.getBoundingClientRect();
    outline = document.createElement("div");
    outline.style.cssText = `position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #ef831e;border-radius:6px;box-sizing:border-box;left:${rect.left - 3}px;top:${rect.top - 3}px;width:${rect.width + 6}px;height:${rect.height + 6}px`;
    document.body.append(outline);
    const marker = outline;
    setTimeout(() => marker.remove(), 2400);
    return true;
  }

  function dispose() {
    stopped = true;
    clearTimeout(scheduled);
    clearInterval(interval);
    outline?.remove();
    notice?.host.remove();
    document.removeEventListener("click", onClick, true);
    chrome.runtime.onMessage.removeListener(onMessage);
    globalThis.checkoutScannerRunning = false;
  }

  function onMessage(message, sender, reply) {
    if (message.type === "status") reply(result);
    if (message.type === "show") {
      reply({ shown: revealFinding(message) });
    }
    if (message.type === "dispose") {
      dispose();
      reply({ ok: true });
    }
  }

  chrome.runtime.onMessage.addListener(onMessage);
  chrome.runtime.sendMessage({ type: "load" }).then(response => {
    if (stopped) return;
    if (!response?.active) return dispose();
    memory.cart = response.cart;
    document.addEventListener("click", onClick, true);
    interval = setInterval(queueScan, 1000);
    scan();
  }).catch(dispose);
})();
