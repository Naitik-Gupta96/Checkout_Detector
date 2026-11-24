(() => {
  const css = `
    :root, :host {
      color-scheme: dark;
      --ink: #edf5fa;
      --muted: #aabac8;
      --base: #0a1118;
      --surface: #101b25;
      --raised: #152330;
      --stroke: #2a3d4d;
      --lime: #b9ef91;
      --amber: #ffc180;
      --blue: #a0d7ff;
      font: 13px/1.5 system-ui, "Segoe UI", sans-serif;
      color: var(--ink);
    }
    *, *::before, *::after { box-sizing: border-box; }
    h1, h2, h3, p { margin: 0; }
    button { font: inherit; cursor: pointer; }
    button:focus-visible, summary:focus-visible { outline: 2px solid var(--lime); outline-offset: 3px; }
    button:disabled { cursor: default; opacity: .55; }
    .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .brand strong { display: block; color: var(--ink); font-size: 15px; letter-spacing: -.02em; }
    .mark {
      display: grid; align-items: center; justify-items: center; flex: 0 0 33px; height: 33px;
      border: 1px solid #648865; border-radius: 10px; background: #1d352c; color: var(--lime);
      font-size: 20px; line-height: 1;
    }
    .icon-button, .action {
      border: 1px solid var(--stroke); border-radius: 8px; color: var(--ink); background: var(--raised);
      padding: 6px 10px; font-weight: 650;
    }
    .icon-button { color: var(--muted); min-width: 34px; padding: 5px; font-size: 16px; }
    .icon-button:hover, .action:hover { background: #233645; color: #fff; }
    .finding {
      --accent: var(--amber);
      min-width: 0; padding: 12px; border: 1px solid var(--stroke);
      border-left: 3px solid var(--accent); border-radius: 11px; background: var(--surface);
      overflow-wrap: anywhere;
    }
    .finding[data-kind="nudge"] { --accent: var(--blue); }
    .finding[data-kind="security"] { --accent: #ff999d; }
    .finding h3 { color: var(--accent); font-size: 14px; line-height: 1.35; }
    .finding .signal { color: var(--ink); margin-top: 5px; font-weight: 600; }
    .finding blockquote {
      margin: 8px 0; padding: 6px 8px; border-radius: 5px; background: var(--base);
      color: var(--muted); font-size: 12px; border: 1px solid var(--stroke);
    }
    .finding .advice { margin-bottom: 8px; color: var(--muted); font-size: 12px; }
    .finding .action { font-size: 12px; }
  `;

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
    const logo = element("span", "◈", "mark");
    logo.setAttribute("aria-hidden", "true");
    const header = element("div", undefined, "brand");
    const title = element("div");
    title.append(element("strong", "Checkout Detector"));
    header.append(logo, title);
    return header;
  }

  function finding(item, revealEvidence) {
    const card = element("article", undefined, "finding");
    card.dataset.kind = item.kind;
    const reveal = element("button", "Show on page ↗", "action");
    reveal.type = "button";
    reveal.addEventListener("click", async () => {
      if (!await revealEvidence(item)) reveal.textContent = "Evidence changed";
    });
    card.append(element("h3", item.title), element("p", item.signal, "signal"),
      element("blockquote", item.evidence), element("p", item.advice, "advice"), reveal);
    return card;
  }

  globalThis.CheckoutUI = { brand, element, finding, style };
})();
