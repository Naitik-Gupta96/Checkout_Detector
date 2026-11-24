(() => {
  // Shared by the popup and the on-page panel (inside a closed shadow root), so it must not rely on page styles.
  const css = `
    :root, :host {
      --ink: #15243b;
      --ink-2: #4b5567;
      --ink-3: #727b8c;
      --paper: #fafaf7;
      --card: #ffffff;
      --line: #e6e5df;
      --line-strong: #d3d2ca;
      --violet: #6f45ed;
      --violet-ink: #5532c9;
      --violet-tint: #f0ebfe;
      --amber: #b4530f;
      --amber-tint: #fcefe5;
      --red: #b42318;
      --red-tint: #fdecea;
      --green: #23784a;
      --green-tint: #e5f3ea;
      color-scheme: light;
      font: 13px/1.5 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
      color: var(--ink);
    }
    *, *::before, *::after { box-sizing: border-box; }
    h1, h2, h3, p, ol, ul, blockquote { margin: 0; }
    button { font: inherit; color: inherit; cursor: pointer; }
    button:focus-visible { outline: 2px solid var(--violet); outline-offset: 2px; }
    button:disabled { cursor: default; opacity: .5; }
    svg { display: block; flex: none; }

    .brand { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .brand strong { font-size: 14px; font-weight: 650; letter-spacing: -.01em; white-space: nowrap; }

    .button {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      min-height: 32px; padding: 0 12px; border-radius: 7px; font-weight: 600;
      border: 1px solid var(--line-strong); background: var(--card);
    }
    .button:hover:not(:disabled) { background: var(--paper); border-color: var(--ink-3); }
    .button.primary { border-color: var(--violet); background: var(--violet); color: #fff; }
    .button.primary:hover:not(:disabled) { background: var(--violet-ink); border-color: var(--violet-ink); }
    .icon-button {
      display: grid; place-items: center; width: 28px; height: 28px; padding: 0;
      border: 0; border-radius: 6px; background: transparent; color: var(--ink-2);
    }
    .icon-button:hover { background: var(--paper); color: var(--ink); }
    .link {
      padding: 0; border: 0; background: none; font-weight: 600; font-size: 12px;
      color: var(--violet-ink); text-decoration: underline; text-underline-offset: 2px;
      text-decoration-color: color-mix(in srgb, currentColor 35%, transparent);
    }
    .link:hover { text-decoration-color: currentColor; }
    .link.quiet { color: var(--ink-2); }

    .finding {
      --tone: var(--amber); --tint: var(--amber-tint);
      display: grid; gap: 7px; min-width: 0; padding: 12px 13px;
      border: 1px solid var(--line); border-radius: 10px; background: var(--card);
      overflow-wrap: anywhere;
    }
    .finding[data-kind="nudge"] { --tone: var(--violet-ink); --tint: var(--violet-tint); }
    .finding[data-kind="security"] { --tone: var(--red); --tint: var(--red-tint); }
    .finding .tag {
      justify-self: start; display: inline-flex; gap: 6px; align-items: baseline;
      padding: 2px 8px; border-radius: 999px; background: var(--tint); color: var(--tone);
      font-size: 11px; font-weight: 650; letter-spacing: .01em;
    }
    .finding .tag span { font-weight: 500; opacity: .85; }
    .finding .signal { font-size: 13.5px; font-weight: 600; line-height: 1.4; }
    .finding blockquote {
      padding: 6px 9px; border-radius: 6px; background: var(--paper); color: var(--ink-2);
      font: 12px/1.45 ui-monospace, "Cascadia Mono", Consolas, monospace;
    }
    .finding .advice { color: var(--ink-2); font-size: 12px; }
    .finding .actions { display: flex; gap: 16px; align-items: center; margin-top: 1px; }
    .finding .note { color: var(--ink-3); font-size: 12px; }
  `;

  const icons = {
    logo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#15243b"/>
      <path d="M9.5 6.5h13v19l-2.17-1.6-2.16 1.6L16 23.9l-2.17 1.6-2.16-1.6-2.17 1.6z" fill="#fafaf7"/>
      <rect x="12.3" y="10.4" width="7.4" height="1.9" rx=".95" fill="#15243b" opacity=".32"/>
      <rect x="12.3" y="14.4" width="7.4" height="2.5" rx="1.25" fill="#c65b18"/>
      <rect x="12.3" y="19" width="4.6" height="1.9" rx=".95" fill="#15243b" opacity=".32"/></svg>`,
    chevronUp: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    chevronDown: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  };

  // Parsed as SVG rather than assigned through innerHTML, which some shopping sites restrict.
  function icon(name) {
    const parsed = new DOMParser().parseFromString(icons[name], "image/svg+xml").documentElement;
    return document.importNode(parsed, true);
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function style(extra = "") {
    return element("style", css + extra);
  }

  function brand() {
    const header = element("div", undefined, "brand");
    const title = element("div");
    title.append(element("strong", "Checkout Detector"));
    header.append(icon("logo"), title);
    return header;
  }

  function finding(item, { reveal, dismiss }) {
    const card = element("article", undefined, "finding");
    card.dataset.kind = item.kind;
    // CCPA categories carry the regulation's name; additional checks are labelled by title alone.
    const tag = element("p", undefined, "tag");
    if (item.ccpa) tag.append("CCPA ·", element("span", item.title));
    else tag.textContent = item.title;

    const evidence = element("blockquote", item.evidence);
    evidence.setAttribute("aria-label", "Text found on the page");
    const actions = element("div", undefined, "actions");
    const show = element("button", "Show on page", "link");
    show.type = "button";
    show.addEventListener("click", async () => {
      if (!await reveal(item)) show.replaceWith(element("span", "No longer on the page", "note"));
    });
    actions.append(show);
    if (dismiss) {
      const chosen = ["basket", "consent"].includes(item.key);
      const hide = element("button", chosen ? "I chose this" : "Dismiss", "link quiet");
      hide.type = "button";
      hide.title = chosen ? "Hide this alert. You selected this option on purpose." : "Hide this alert for this checkout.";
      hide.addEventListener("click", () => dismiss(item));
      actions.append(hide);
    }
    card.append(tag, element("p", item.signal, "signal"), evidence, element("p", item.advice, "advice"), actions);
    return card;
  }

  globalThis.CheckoutUI = { brand, element, finding, icon, style };
})();
