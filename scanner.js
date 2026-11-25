(() => {
  if (globalThis.checkoutScannerRunning) return;
  globalThis.checkoutScannerRunning = true;

  const memory = { touched: new Set() };
  const prompts = new Map();
  const choices = new Set();
  let dismissed = new Set();
  let targets = new Map();
  let result = { active: true, loading: true };
  let scheduled;
  let outline;
  let lastUpdate;
  let stopped = false;
  let interval;
  let observer;
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
  const interactive = 'button,a[href],input[type="checkbox"],input[type="radio"],[role="button"],[role="checkbox"],[role="radio"],[role="switch"],[aria-pressed]';
  const modal = 'dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]';
  const currency = /₹|\bINR\s*\d|\bRs\.?\s*\d|[$€£]\s*\d/i;
  const lineSelector = "main *,[role=main] *,h1,h2,h3,h4,h5,h6,b,strong,p,li,td,dt,dd,label,span,div,section,article,aside";
  const onBlinkit = /(?:^|\.)blinkit\.com$/i.test(location.hostname);

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

  // Bill summaries and open dialogs are read first, so a cart drawer placed after a long product grid
  // is not cut off by the line limit.
  const billHeading = /^(?:bill (?:details|summary)|price details(?: \(\d+ items?\))?|order summary|payment (?:details|summary)|my cart|your cart)$/i;
  const totalWords = /\b(?:grand total|total amount|to pay|order total|total payable|amount payable|bill total|net payable)\b/i;
  function checkoutScopes(drawer) {
    const markers = [...document.querySelectorAll("h1,h2,h3,h4,b,strong,span,div,p")].filter(element =>
      element.childElementCount <= 1 && billHeading.test(normalize(element.textContent)) && available(element)).slice(0, 6);
    // The bill is the smallest block around a bill heading that also holds the total. Only its rows count as
    // charges, so an offer card that repeats "Donation ₹1" next to an unticked box is not mistaken for a bill line.
    const bills = [];
    for (const marker of markers) {
      if (/^(?:my|your) cart$/i.test(normalize(marker.textContent))) continue;
      for (let node = marker.parentElement, depth = 0; node && node !== document.body && depth < 8; node = node.parentElement, depth++) {
        const text = normalize(node.innerText);
        if (text.length > 2500) break;
        if (totalWords.test(text)) {
          if (!bills.some(bill => bill.contains(node) || node.contains(bill))) bills.push(node);
          break;
        }
      }
    }
    const scopes = [...bills, ...(drawer ? [drawer] : [])];
    for (const dialog of document.querySelectorAll(modal)) if (available(dialog)) scopes.push(dialog);
    for (const marker of markers) {
      // Widen to the largest ancestor that still reads like one panel rather than the whole page.
      let scope = marker;
      while (scope.parentElement && scope.parentElement !== document.body &&
        normalize(scope.parentElement.innerText).length < 4000) scope = scope.parentElement;
      if (!scopes.some(existing => existing.contains(scope))) scopes.push(scope);
    }
    return { scopes, bills };
  }

  // The state of a checkbox or switch sitting in the same small block as a priced line, if there is one.
  const toggleSelector = 'input[type="checkbox"],[role="checkbox"],[role="switch"],[aria-checked],[aria-pressed]';
  function nearbyToggle(element) {
    for (let node = element, depth = 0; node && node !== document.body && depth < 3; node = node.parentElement, depth++) {
      if (normalize(node.innerText).length > 200) break;
      const toggle = node.matches(toggleSelector) ? node : node.querySelector(toggleSelector);
      if (toggle) return selected(toggle);
    }
    return undefined;
  }

  function controlText(element) {
    const labels = Array.from(element.labels || [], item => item.innerText).join(" ");
    const direct = normalize(labels) || label(element);
    if (/^(?:₹|\$|€|£)\s*\d/.test(direct)) {
      const context = normalize(element.parentElement?.parentElement?.innerText);
      if (/\b(?:rider|driver|delivery (?:partner|executive|agent)|valet)\b/i.test(context) && /\b(?:tip|thank)\b/i.test(context)) return `Delivery tip ${direct}`;
      if (/\bdonat(?:e|ion)\b/i.test(context) && context.length < 400) return `Donation ${direct}`;
    }
    return direct;
  }

  function selected(element) {
    return element.checked === true ||
      ["aria-checked", "aria-pressed", "aria-selected"].some(name => element.getAttribute(name) === "true") ||
      (currency.test(label(element)) && element.classList.contains("chip") && element.classList.contains("on")) ||
      selectedClass(element);
  }

  // Custom chips and checkboxes often mark selection only with a class such as "chip-selected" or "isChecked".
  function selectedClass(element) {
    const classes = String(element.className?.baseVal ?? element.className ?? "").split(/\s+/);
    return classes.some(name => /(?:^|[-_])(?:is-?)?(?:selected|checked)$|^(?:is|has)?(?:Selected|Checked)$|[a-z](?:Selected|Checked)$/.test(name) &&
      !/(?:^|[-_])(?:not|un|de)-?(?:selected|checked)$|(?:Not|Un)(?:Selected|Checked)$|^un(?:selected|checked)$/i.test(name));
  }

  // Remembers what the shopper interacted with (donation, coupon, tip...) by reading the clicked area's short label.
  function recordTouch(target) {
    let node = target;
    for (let depth = 0; node && node !== document.body && depth < 6; depth++, node = node.parentElement) {
      const text = normalize(node.innerText);
      if (text.length > 600) break;
      if (text.length > 300) continue;
      for (const topic of CheckoutRules.topics(text)) if (memory.touched.size < 40) memory.touched.add(topic);
    }
  }

  function snapshot() {
    targets = new Map();
    const drawer = onBlinkit ? cartDrawer() : null;
    const { scopes, bills } = checkoutScopes(drawer);
    const prioritized = selector => new Set([
      ...scopes.flatMap(scope => [...scope.querySelectorAll(selector)]), ...document.querySelectorAll(selector)
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
      // The same words can appear in the bill and on an offer card, so the bill copy is kept separately.
      const inBill = bills.some(bill => bill.contains(element));
      const key = value => (inBill ? "bill:" : "") + value;
      if (!text || text.length > 260 || seen.has(key(text)) || !available(element)) continue;
      const visibleText = normalize(element.innerText);
      if (visibleText.length < 4 || visibleText.length > 260 || seen.has(key(visibleText))) continue;
      if (element.children.length > 4) continue;
      if ([...element.children].some(child => normalize(child.innerText) === visibleText)) continue;
      seen.add(key(visibleText));
      const line = entry(element, visibleText);
      line.inBill = inBill;
      if (visibleText.length <= 80 && currency.test(visibleText)) {
        const toggle = nearbyToggle(element);
        if (toggle !== undefined) line.toggle = toggle;
      }
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
    return { lines, controls, dialogs, links, headings, stage, hasTotal, hasBill: bills.length > 0, touched: [...memory.touched] };
  }

  function promptKey(element) {
    return (element.getAttribute("aria-label") || label(element.querySelector("h1,h2,h3,[role=heading]") || element))
      .slice(0, 120).toLowerCase();
  }

  function onClick(event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    recordTouch(event.target);
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

  function onChange(event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    recordTouch(event.target);
    queueScan();
  }

  const findingId = item => `${item.key}|${item.evidence.replace(/(?:₹|\bINR\s*|\bRs\.?\s*|[$€£])\s*\d[\d,]*(?:\.\d+)?/gi, "").replace(/\s+/g, " ").trim()}`;
  let lastPage;
  let lastScan = 0;

  function scan() {
    scheduled = undefined;
    if (stopped) return;
    lastScan = Date.now();
    const page = lastPage = snapshot();
    const findings = CheckoutRules.detect(page, memory).filter(item => !dismissed.has(findingId(item)));
    const baseline = memory.cart ? { labels: memory.cart.labels || [], total: memory.cart.total || null } : null;
    result = { active: true, stage: page.stage, findings, hasCart: Boolean(memory.cart), baseline, dismissed: dismissed.size };
    renderNotice(result);
    const update = JSON.stringify({
      cart: memory.cart, count: findings.length, dismissed: [...dismissed], touched: [...memory.touched], listed: memory.listed,
      choices: [...choices].slice(-200)
    });
    if (update !== lastUpdate) {
      lastUpdate = update;
      chrome.runtime.sendMessage({ type: "update", ...JSON.parse(update) }).then(response => {
        if (response?.active === false) dispose();
      }).catch(() => { lastUpdate = undefined; });
    }
  }

  function dismiss(item) {
    if (dismissed.size < 200) dismissed.add(findingId(item));
    scan();
  }

  // Dismissing is reversible: Undo brings back the most recently dismissed alert.
  function restore() {
    const last = [...dismissed].pop();
    if (last) dismissed.delete(last);
    scan();
  }

  function emptyMessage({ stage, hasCart, baseline }) {
    if (stage === "payment" && !hasCart) return "Open the cart first so fees added at payment can be compared.";
    if (stage === "payment") return "No new fees since the cart. Check the total and selected options before paying.";
    if (stage === "cart") {
      const fees = baseline?.labels.length ? ` Fees noted: ${baseline.labels.join(", ")}.` : "";
      return `Cart recorded.${fees} Nothing to flag yet.`;
    }
    return "Nothing to flag on this page.";
  }

  function renderNotice(status) {
    const { findings, stage } = status;
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
    if (box.dataset.open !== String(noticeOpen)) {
      box.dataset.open = String(noticeOpen);
      list.hidden = footer.hidden = !noticeOpen;
      toggle.replaceChildren(CheckoutUI.icon(noticeOpen ? "chevronDown" : "chevronUp"));
      toggle.setAttribute("aria-label", noticeOpen ? "Minimize checkout alerts" : "Expand checkout alerts");
      toggle.setAttribute("aria-expanded", noticeOpen);
    }
    const step = stage === "payment" ? " · Payment" : stage === "cart" ? " · Cart" : "";
    const summaryText = findings.length ? `${findings.length} to review${step}` : `Watching${step}`;
    if (summary.textContent !== summaryText) summary.textContent = summaryText;
    summary.dataset.alert = String(findings.length > 0);
    const key = JSON.stringify([findings.map(({ key, evidence, signal }) => [key, evidence, signal]), emptyMessage(status), status.dismissed]);
    if (key === noticeKey) return;
    noticeKey = key;
    const scroll = list.scrollTop;
    list.replaceChildren(...findings.map(item => CheckoutUI.finding(item, {
      reveal: finding => {
        const shown = revealFinding(finding);
        if (shown) {
          noticeOpen = false;
          renderNotice(result);
          toggle.focus({ preventScroll: true });
        }
        return shown;
      },
      dismiss
    })));
    if (!findings.length) list.append(CheckoutUI.element("p", emptyMessage(status), "empty"));
    if (status.dismissed) {
      const row = CheckoutUI.element("p", `${status.dismissed} dismissed`, "undo");
      const undo = CheckoutUI.element("button", "Undo", "link quiet");
      undo.type = "button";
      undo.addEventListener("click", restore);
      row.append(undo);
      list.append(row);
    }
    list.scrollTop = scroll;
  }

  function createNotice() {
    const { brand, element, style } = CheckoutUI;
    const host = element("div");
    host.dataset.checkoutDetector = "panel";
    host.style.cssText = "all:initial;position:fixed;bottom:16px;left:16px;max-width:calc(100vw - 32px);z-index:2147483646";
    const shadow = host.attachShadow({ mode: "closed" });
    const box = element("section", undefined, "dock");
    box.setAttribute("aria-label", "Checkout Detector alerts");
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
    const stop = element("button", "Stop watching", "button");
    stop.type = "button";
    stop.addEventListener("click", async () => {
      stop.disabled = true;
      const response = await chrome.runtime.sendMessage({ type: "stopFromPage" }).catch(() => null);
      if (!response?.ok && !stopped) {
        stop.textContent = "Retry stop";
        stop.disabled = false;
      }
    });
    footer.append(element("small", "Checks this tab on your device"), stop);
    box.append(header, list, footer);
    shadow.append(style(`
      .dock { width: min(280px, calc(100vw - 32px)); overflow: hidden; color: var(--ink);
        font: 13px/1.5 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
        border: 1px solid var(--line-strong); border-radius: 12px; background: var(--paper);
        box-shadow: 0 1px 2px rgb(21 36 59 / .08), 0 14px 36px rgb(21 36 59 / .2); }
      .dock[data-open="true"] { width: min(380px, calc(100vw - 32px)); }
      header { display: flex; justify-content: space-between; align-items: center; gap: 10px;
        padding: 9px 9px 9px 11px; background: var(--card); }
      .dock[data-open="true"] header { border-bottom: 1px solid var(--line); }
      .brand strong { font-size: 13px; line-height: 1.25; }
      .summary { color: var(--ink-2); font-size: 12px; line-height: 1.3; }
      .summary[data-alert="true"] { color: var(--amber); font-weight: 650; }
      .list { max-height: min(400px, max(120px, 100vh - 160px)); overflow: auto; overscroll-behavior: contain;
        display: grid; gap: 8px; padding: 10px; scrollbar-width: thin; }
      .list[hidden], footer[hidden] { display: none; }
      .empty { color: var(--ink-2); padding: 2px; }
      .undo { display: flex; justify-content: space-between; align-items: center; gap: 10px;
        color: var(--ink-3); font-size: 12px; padding: 0 2px; }
      footer { display: flex; justify-content: space-between; align-items: center; gap: 10px;
        padding: 8px 10px 8px 12px; border-top: 1px solid var(--line); background: var(--card); }
      footer small { color: var(--ink-3); font-size: 11.5px; }
      footer .button { min-height: 28px; font-size: 12px; }
      @media (max-width: 760px) {
        .dock[data-open="true"] { width: min(330px, calc(100vw - 32px)); }
        .list { max-height: min(320px, max(120px, 100vh - 160px)); }
      }
    `), box);
    document.body.append(host);
    return { host, box, summary, toggle, list, footer };
  }

  function revealFinding(item) {
    const current = result.findings?.find(match => match.key === item.key && match.evidence === item.evidence);
    return Boolean(current && show(current.target));
  }

  // Rescans are driven by page changes, throttled so busy pages (carousels, countdowns) cost at most ~1 scan a second.
  function queueScan() {
    scheduled ??= setTimeout(scan, Math.max(300, 900 - (Date.now() - lastScan)));
  }

  const ours = node => node.nodeType === Node.ELEMENT_NODE && node.hasAttribute("data-checkout-detector");
  function pageChanged(records) {
    return records.some(record => {
      if (record.target.nodeType === Node.ELEMENT_NODE && record.target.closest("[data-checkout-detector]")) return false;
      const nodes = [...record.addedNodes, ...record.removedNodes];
      return !nodes.length || !nodes.every(ours);
    });
  }

  function show(target) {
    const element = targets.get(target);
    if (!element?.isConnected) return false;
    outline?.remove();
    element.scrollIntoView({ block: "center", behavior: "instant" });
    const rect = element.getBoundingClientRect();
    outline = document.createElement("div");
    outline.dataset.checkoutDetector = "highlight";
    outline.style.cssText = `position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #c65b18;border-radius:6px;box-shadow:0 0 0 4px rgb(198 91 24 / .22);box-sizing:border-box;left:${rect.left - 4}px;top:${rect.top - 4}px;width:${rect.width + 8}px;height:${rect.height + 8}px`;
    document.body.append(outline);
    const marker = outline;
    setTimeout(() => marker.remove(), 2600);
    return true;
  }

  // A copyable summary of what the scanner read, for checking why a site is or isn't flagged.
  function diagnostics() {
    const page = lastPage || snapshot();
    return {
      extension: chrome.runtime.getManifest().version,
      page: location.hostname + location.pathname,
      stage: page.stage, hasTotal: page.hasTotal, cart: memory.cart || null,
      findings: result.findings?.map(({ key, evidence }) => [key, evidence]) || [],
      headings: page.headings,
      lines: page.lines.slice(0, 250).map(item => item.text),
      controls: page.controls.slice(0, 120).map(({ text, selected, chosen }) => ({ text, selected, chosen })),
      dialogs: page.dialogs.map(item => item.text)
    };
  }

  function dispose() {
    stopped = true;
    clearTimeout(scheduled);
    clearInterval(interval);
    observer?.disconnect();
    outline?.remove();
    notice?.host.remove();
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("change", onChange, true);
    chrome.runtime.onMessage.removeListener(onMessage);
    globalThis.checkoutScannerRunning = false;
  }

  function onMessage(message, sender, reply) {
    if (message.type === "status") reply(result);
    if (message.type === "show") {
      reply({ shown: revealFinding(message) });
    }
    if (message.type === "dismiss") {
      dismiss(message);
      reply({ ok: true });
    }
    if (message.type === "restore") {
      restore();
      reply({ ok: true });
    }
    if (message.type === "diagnostics") reply(diagnostics());
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
    dismissed = new Set(response.dismissed || []);
    memory.touched = new Set(response.touched || []);
    memory.listed = response.listed || {};
    for (const choice of response.choices || []) choices.add(choice);
    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    observer = new MutationObserver(records => { if (pageChanged(records)) queueScan(); });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    // Safety net for changes that produce no mutation, such as a layout-only visibility change.
    interval = setInterval(queueScan, 4000);
    scan();
  }).catch(dispose);
})();
