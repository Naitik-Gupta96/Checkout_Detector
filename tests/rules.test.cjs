const test = require("node:test");
const assert = require("node:assert/strict");
require("../rules.js");

const { checkoutStage, detect, rules } = globalThis.CheckoutRules;
const item = (text, properties) => ({ text, id: 1, ...properties });
const page = (properties = {}) => ({
  stage: "cart", hasTotal: true, lines: [], controls: [], dialogs: [], links: [], ...properties
});

const cases = {
  urgency: { lines: [item("Only 2 left")] },
  basket: { controls: [item("Order protection ₹19", { selected: true })] },
  shame: { controls: [item("No thanks, I'll pay full price")] },
  forced: { controls: [item("Subscribe to our newsletter", { required: true })] },
  trap: { lines: [item("Free trial requires a credit card")] },
  interference: { dialogs: [{
    accept: item("Accept offer", { font: 19 }),
    decline: item("No thanks", { font: 12, opacity: 1 })
  }] },
  switch: { lines: [item("Out of stock. Try this alternative instead for ₹349.")] },
  ad: { links: [item("Recommended item", { adSignal: true, disclosed: false })] },
  nag: { dialogs: [item("Enable notifications", { reappeared: true })] },
  trick: { controls: [item("Do not opt out of marketing emails")] },
  saas: { lines: [item("Your cloud storage plan automatically renews each month.")] },
  rogue: { lines: [item("Your computer is infected. Download the security tool.")] }
};

for (const [key, fixture] of Object.entries(cases)) {
  test(rules[key][0], () => {
    const result = detect(page(fixture), {});
    const match = result.find(item => item.key === key);
    assert.ok(match?.evidence && match?.advice && match?.target === 1);
  });
}

test("Drip pricing compares the cart with payment and ignores previously disclosed fees", () => {
  const memory = {};
  detect(page({ lines: [item("Delivery fee ₹20")] }), memory);
  const result = detect(page({
    stage: "payment",
    lines: [item("Delivery charge ₹20"), item("Handling₹35"), item("Packaging fee ₹0")]
  }), memory);
  assert.deepEqual(result.map(item => [item.key, item.evidence]), [["drip", "Handling₹35"]]);
  assert.equal(detect(page({ stage: "payment", lines: [item("Handling fee ₹35")] }), {}).length, 0);
});

test("Ordinary checkout controls and clearly disclosed billing stay unflagged", () => {
  const result = detect(page({
    controls: [
      item("Order protection ₹19"),
      item("Order protection ₹19", { selected: true, chosen: true }),
      item("Shipping address", { required: true }),
      item("No thanks")
    ],
    links: [item("Recommended item", { adSignal: true, disclosed: true })],
    lines: [item("Your cloud storage plan automatically renews for ₹99 per month.")]
  }), {});
  assert.deepEqual(result, []);
});

test("An observed countdown restart has different evidence from an unverified deadline", () => {
  const memory = {};
  detect(page({ lines: [item("Offer ends in 00:01")] }), memory);
  const result = detect(page({ lines: [item("Offer ends in 00:30")] }), memory);
  assert.match(result[0].signal, /jumped back up/);
});

test("A same-page cart drawer can have a plain-text heading and a prefixed payment button", () => {
  assert.equal(checkoutStage({
    headings: ["Shop groceries"], lines: [item("My Cart"), item("Bill Details")],
    controls: [item("₹120 Proceed To Pay")], route: "products", hasTotal: true
  }), "cart");
});

test("A global cart button does not make a storefront a checkout screen", () => {
  assert.equal(checkoutStage({
    headings: ["Shop groceries"], lines: [item("My Cart")],
    controls: [item("My Cart")], route: "products", hasTotal: false
  }), null);
});

test("Payment review takes precedence over the retained cart summary", () => {
  assert.equal(checkoutStage({
    headings: ["My Cart"], lines: [item("Select Payment Method"), item("Bill Details")],
    controls: [item("Pay Now")], route: "account", hasTotal: true
  }), "payment");
});

test("A billed donation gives evidence without assuming who selected it", () => {
  const donation = item("Feeding India donation ₹1", { selected: true, billed: true });
  const result = detect(page({ controls: [donation] }), {});
  assert.equal(result[0].key, "basket");
  assert.match(result[0].signal, /included in the bill/);
  assert.deepEqual(detect(page({ controls: [{ ...donation, chosen: true }] }), {}), []);
});

test("The free-delivery offer compares extra basket spend with the fee waived", () => {
  const offer = "Free above ₹499 due to high demand (Unlock by adding ₹149 more)";
  const lines = [
    item(`Delivery Fee ₹30 ${offer} Grand total ₹380`),
    item(offer, { id: 2, nearby: [`Delivery Fee ₹30 ${offer}`] })
  ];
  const result = detect(page({ lines }), {});
  assert.deepEqual(result.map(({ key, evidence, signal }) => [key, evidence, signal]), [
    ["upsell", offer, "You’d spend ₹119 more to save ₹30 on delivery."]
  ]);
});

test("A smaller extra spend than the delivery fee produces the correct comparison", () => {
  const offer = "Free delivery above ₹499 (Unlock by adding ₹9.50 more)";
  const result = detect(page({
    lines: [item(offer, { nearby: [`Delivery fee ₹30 ${offer}`] })]
  }), {});
  assert.equal(result[0].signal, "You’d spend ₹20.5 less overall after saving ₹30 on delivery.");
});

test("Free-delivery copy without a nearby unambiguous positive fee has no numeric alert", () => {
  const offer = "Free above ₹499 (Unlock by adding ₹149 more)";
  for (const context of ["", "Delivery fee ₹0", "Delivery fee $30", "Delivery fee ₹60 ₹30", "Delivery fee ₹30 Delivery fee ₹60"]) {
    assert.deepEqual(detect(page({ lines: [item(offer, { nearby: [context] })] }), {}), []);
  }
});

test("Checkout total increase requires an unchanged explicitly labeled subtotal", () => {
  const memory = {};
  detect(page({ lines: [item("Item total ₹300"), item("Grand total ₹330")] }), memory);
  const payment = (subtotal, total) => page({
    stage: "payment", lines: [item(`Item total ₹${subtotal}`), item(`Grand total ₹${total}`), item("Total savings ₹25")]
  });
  const [change] = detect(payment(300, 350), memory);
  assert.equal(change.key, "total");
  assert.match(change.signal, /₹330 to ₹350/);
  assert.deepEqual(detect(payment(320, 350), memory), []);
  assert.deepEqual(detect(payment(300, 330), memory), []);
});

test("The additional checkout checks identify the specific evidence shown", () => {
  const lines = [
    item("Add ₹50 to reach the minimum order value."),
    item("Your coupon was removed."),
    item("Membership is free for 30 days, then ₹149/month."),
    item("Create an account to place your order."),
    item("Refunds are only issued as store credit.")
  ];
  const [minimum, coupon, trial, account, refund] = detect(page({ lines }), {});
  assert.deepEqual([minimum.key, coupon.key, trial.key, account.key, refund.key], ["minimum", "coupon", "renewal", "account", "credit"]);
  assert.match(trial.signal, /₹149 per month/);
  assert.ok([minimum, coupon, trial, account, refund].every(finding => finding.kind === "nudge"));
});

test("A selected marketing consent flag requires a toggle and a positive opt-in label", () => {
  const marketing = item("Receive marketing emails", { toggleable: true, selected: true });
  assert.equal(detect(page({ controls: [marketing] }), {})[0].key, "consent");
  const controls = [
    { ...marketing, chosen: true }, { ...marketing, selected: false },
    { ...marketing, toggleable: false }, { ...marketing, text: "Do not receive marketing emails" }
  ];
  assert.deepEqual(detect(page({ controls }), {}), []);
});

test("A cookie dialog can flag a missing decline control and allow a visible reject option", () => {
  const cookieDialog = item("We use marketing cookies.", { accept: item("Accept all") });
  assert.equal(detect(page({ dialogs: [cookieDialog] }), {})[0].key, "interference");
  assert.deepEqual(detect(page({ dialogs: [{ ...cookieDialog, decline: item("Reject all") }] }), {}), []);
});

test("Coupon upsells compare the required spend with the advertised savings", () => {
  const offer = "Shop for ₹1149 more to apply";
  const result = detect(page({
    lines: [item(offer, { nearby: [`Save ₹50 with SAVEPRO50 ${offer}`] })]
  }), {});
  assert.equal(result[0].key, "couponUpsell");
  assert.equal(result[0].signal, "You’d spend ₹1,099 more overall if the ₹50 coupon applies.");
});

test("A bag page whose next button says Place order is still the cart", () => {
  const bag = { headings: [], lines: [item("PRICE DETAILS (2 Items)")], controls: [item("PLACE ORDER")], hasTotal: true };
  assert.equal(checkoutStage({ ...bag, route: " checkout cart" }), "cart");
  assert.equal(checkoutStage({ ...bag, route: " checkout" }), "cart");
  assert.equal(checkoutStage({ ...bag, route: " checkout payment" }), "payment");
  assert.equal(checkoutStage({ headings: [], lines: [], controls: [item("Place your order")], route: " checkout", hasTotal: true }), "payment");
  assert.equal(checkoutStage({ headings: [], lines: [], controls: [], route: " shop bags handbags", hasTotal: false }), null);
});

test("Fee rows are recognised by label, and a fee first shown at payment is drip pricing", () => {
  const memory = {};
  detect(page({ lines: [
    item("Total MRP ₹4,998"), item("Platform Fee Know More ₹20"), item("Shipping Fee Know More ₹79 FREE"), item("Total Amount ₹2,053")
  ] }), memory);
  assert.deepEqual(memory.cart.labels, ["Platform Fee", "Shipping Fee"]);
  assert.equal(memory.cart.total, "₹2,053");
  const result = detect(page({ stage: "payment", lines: [
    item("Total MRP ₹4,998"), item("Platform Fee ₹20"), item("Shipping Fee FREE"),
    item("Cash on Delivery Fee ₹10"), item("Delivery fee discount ₹30"), item("Total Amount ₹2,063")
  ] }), memory);
  assert.deepEqual(result.map(item => [item.key, item.evidence]), [
    ["drip", "Cash on Delivery Fee ₹10"], ["total", "Total Amount ₹2,063"]
  ]);
  assert.match(result[0].signal, /Cash on Delivery Fee/);
});

test("A pre-ticked gift packaging or express delivery option counts as basket sneaking", () => {
  for (const text of ["Gift packaging and personalised message, only for ₹35", "Express delivery ₹49"]) {
    assert.equal(detect(page({ controls: [item(text, { selected: true })] }), {})[0]?.key, "basket", text);
  }
});

test("Urgency copy and countdown formats used by retail sites are recognised", () => {
  for (const text of ["2 left", "Only a few left in stock", "Hurry, selling fast", "Deal ends in 02h 15m 30s"]) {
    assert.equal(detect(page({ lines: [item(text)] }), {})[0]?.key, "urgency", text);
  }
  assert.deepEqual(detect(page({ lines: [item("₹10 left to unlock rewards")] }), {}), []);
});

test("Findings are tagged as CCPA categories or additional checks", () => {
  const [drip] = detect(page({ lines: [item("Only 2 left")] }), {});
  assert.equal(drip.ccpa, true);
  const [consent] = detect(page({ controls: [item("Send me marketing emails", { selected: true, toggleable: true })] }), {});
  assert.equal(consent.ccpa, false);
});
