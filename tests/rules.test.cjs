const test = require("node:test");
const assert = require("node:assert/strict");
require("../rules.js");

const { checkoutStage, detect, rules } = globalThis.CheckoutRules;
const item = (text, properties) => ({ text, id: 1, ...properties });
const page = (properties = {}) => ({
  stage: "cart", hasTotal: true, lines: [], controls: [], dialogs: [], links: [], ...properties
});

// The fee summary appears whenever a bill lists charges; tests about other checks set it aside.
const withoutFees = findings => findings.filter(item => item.key !== "fees");

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
  assert.deepEqual(withoutFees(result).map(item => [item.key, item.evidence]), [["drip", "Handling₹35"]]);
  assert.equal(withoutFees(detect(page({ stage: "payment", lines: [item("Handling fee ₹35")] }), {})).length, 0);
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

test("A donation follows its checkbox and the bill, not the offer card's text", () => {
  const card = ticked => item("Feeding India donation ₹1", { toggle: ticked });
  const billRow = item("Feeding India donation ₹1", { inBill: true });
  const keys = (lines, touched = []) => withoutFees(detect(page({ hasBill: true, lines, touched }), {})).map(item => item.key);
  // Unticked: the card still shows the amount, but nothing is billed.
  assert.deepEqual(keys([card(false)]), []);
  // Ticked by the site: the bill has the row.
  assert.deepEqual(keys([card(true), billRow]), ["basket"]);
  // Ticked by the shopper during the watch.
  assert.deepEqual(keys([card(true), billRow], ["donat"]), []);
  // A line outside the bill never counts as a charge when the page has a bill.
  assert.deepEqual(keys([item("Feeding India donation ₹1")]), []);
  // Pages without a recognisable bill fall back to every line.
  assert.deepEqual(withoutFees(detect(page({ lines: [item("Feeding India donation ₹1")] }), {})).map(item => item.key), ["basket"]);
});

test("Charges outside the bill are not summarised when the page has a bill", () => {
  const lines = [item("Delivery charge ₹25"), item("Handling charge ₹11", { inBill: true })];
  const [fees] = detect(page({ hasBill: true, lines }), {});
  assert.equal(fees.evidence, "Handling charge ₹11");
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
  assert.deepEqual(withoutFees(result).map(item => [item.key, item.evidence]), [
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

test("A paid extra or coupon already in the bill is flagged unless the shopper touched it", () => {
  const lines = [item("Donation ₹10"), item("Coupon Discount -₹200"), item("Coupon Discount Apply Coupon"), item("Membership is free for 30 days, then ₹149/month.")];
  assert.deepEqual(detect(page({ lines }), {}).map(item => [item.key, item.evidence]), [
    ["basket", "Donation ₹10"], ["autoCoupon", "Coupon Discount -₹200"], ["renewal", "Membership is free for 30 days, then ₹149/month."]
  ]);
  assert.deepEqual(detect(page({ lines, touched: ["donat", "coupon"] }), {}).map(item => item.key), ["renewal"]);
  assert.deepEqual(detect(page({ lines: [item("Coupon wasn't applied")], touched: [] }), {}).filter(item => item.key === "autoCoupon"), []);
});

test("Charges in the bill are summarised against the items total", () => {
  const [fees] = detect(page({ lines: [
    item("Items total ₹80"), item("Delivery charge ⓘ ₹30₹25"), item("Handling charge ⓘ ₹11"),
    item("Small cart charge ⓘ ₹20"), item("Late night fee FREE"), item("Grand total ₹136")
  ] }), {});
  assert.equal(fees.key, "fees");
  assert.equal(fees.evidence, "Delivery charge ₹25 · Handling charge ₹11 · Small cart charge ₹20");
  assert.match(fees.signal, /3 charges add ₹56 .* 70% on top of your ₹80 items total\. The small-cart charge/);
  assert.deepEqual(detect(page({ stage: null, lines: [item("Handling charge ₹11")] }), {}), []);
});

test("A logged-out quick-commerce cart is recognised from its bill and Login to Proceed button", () => {
  assert.equal(checkoutStage({
    headings: [], lines: [item("Bill details"), item("Grand total ₹157")],
    controls: [item("Login to Proceed")], route: " s ", hasTotal: true
  }), "cart");
});

test("A tip row worded 'Tip for delivery partner' counts as a billed extra", () => {
  assert.equal(detect(page({ lines: [item("Tip for delivery partner ₹20")] }), {})[0].key, "basket");
  assert.deepEqual(detect(page({ lines: [item("Tip for delivery partner ₹20")], touched: ["tip"] }), {}), []);
});

const keysOf = findings => withoutFees(findings).map(item => item.key);

test("Popularity and demand claims count as false urgency", () => {
  for (const text of ["1.2K+ bought in past month", "500 people ordered this in the last hour", "In 23 carts", "High demand in your area", "Order within 2 hrs for delivery today", "Slots filling fast"]) {
    assert.deepEqual(keysOf(detect(page({ lines: [item(text)] }), {})), ["urgency"], text);
  }
  for (const text of ["You bought this on 3 March", "4.3 ★ (1,234 ratings)", "Bought together often"]) {
    assert.deepEqual(keysOf(detect(page({ lines: [item(text)] }), {})), [], text);
  }
});

test("Loss-framed decline buttons and exit dialogs count as confirm shaming", () => {
  for (const text of ["Continue without savings", "No, I don't want free delivery", "Skip and lose my discount"]) {
    assert.deepEqual(keysOf(detect(page({ controls: [item(text)] }), {})), ["shame"], text);
  }
  assert.deepEqual(keysOf(detect(page({ dialogs: [item("Are you sure? You'll lose ₹120 savings on this order.")] }), {})), ["shame"]);
  assert.deepEqual(keysOf(detect(page({ controls: [item("Continue"), item("Remove")] }), {})), []);
});

test("Pre-selected auto-renewal and pay-later options are flagged until chosen", () => {
  const renew = item("Auto-renew my membership", { selected: true });
  const later = item("Simpl - Pay later in 15 days", { selected: true });
  assert.deepEqual(keysOf(detect(page({ controls: [renew, later] }), {})), ["trap", "payLater"]);
  assert.deepEqual(keysOf(detect(page({ controls: [{ ...renew, chosen: true }, { ...later, selected: false }] }), {})), []);
});

test("Trial fine print with a renewal price is surfaced even without the plan's name", () => {
  const [renewal] = detect(page({ lines: [item("Free for 30 days, then ₹149/month. Auto-renews until cancelled in Account.")] }), {});
  assert.equal(renewal.key, "renewal");
  assert.match(renewal.signal, /₹149 per month/);
  assert.deepEqual(keysOf(detect(page({ lines: [item("Free for 30 days, then ₹149/month.")] }), {})), []);
});

test("A checkout membership offer is compared with what it saves on this order", () => {
  const [offer] = detect(page({ lines: [item("Join Pass for ₹99 and save ₹45 on this order")] }), {});
  assert.equal(offer.key, "membershipUpsell");
  assert.match(offer.signal, /costs ₹99 but saves ₹45 .* does not cover it/);
  assert.deepEqual(keysOf(detect(page({ lines: [item("Buy 1 get 1 free on chips ₹30")] }), {})), []);
});

test("Cashback paid as app credit and no-cost EMI with fees are surfaced", () => {
  const [cashback] = detect(page({ lines: [item("Get ₹50 cashback as SuperCash, expires in 7 days")] }), {});
  assert.equal(cashback.key, "cashback");
  assert.match(cashback.signal, /expires/);
  assert.deepEqual(keysOf(detect(page({ lines: [item("10% instant cashback with HDFC cards ₹150")] }), {})), []);
  const emi = keysOf(detect(page({ lines: [item("No Cost EMI available"), item("Processing fee ₹199")] }), {}));
  assert.ok(emi.includes("emiFee"));
});

test("A free-delivery claim with a delivery charge in the bill is flagged", () => {
  const lines = [item("Yay! You got FREE delivery"), item("Delivery charge ₹25"), item("Grand total ₹105")];
  assert.ok(keysOf(detect(page({ lines }), {})).includes("freeDelivery"));
  const free = [item("Yay! You got FREE delivery"), item("Delivery charge ₹25 FREE")];
  assert.ok(!keysOf(detect(page({ lines: free }), {})).includes("freeDelivery"));
});

test("Pre-ticked carry bags and WhatsApp offers are flagged", () => {
  assert.deepEqual(keysOf(detect(page({ controls: [item("Paper bag ₹5", { selected: true })] }), {})), ["basket"]);
  const whatsapp = item("Get offers on WhatsApp", { selected: true, toggleable: true });
  assert.deepEqual(keysOf(detect(page({ controls: [whatsapp] }), {})), ["consent"]);
});

test("An item that costs more in the cart than on its product card is flagged", () => {
  const memory = {};
  detect(page({ stage: null, lines: [item("12% OFF 16 MINS Amul Masti Pouch Curd 1 kg ₹80 ₹90 ADD")] }), memory);
  const result = detect(page({ lines: [item("Amul Masti Pouch Curd 1 kg ₹85")] }), memory);
  assert.deepEqual(keysOf(result), ["drip"]);
  assert.match(result[0].signal, /listed at ₹80 .* costs ₹85/);
  assert.deepEqual(keysOf(detect(page({ lines: [item("Amul Masti Pouch Curd 1 kg ₹160")] }), memory)), [], "two units");
  assert.deepEqual(keysOf(detect(page({ lines: [item("Amul Masti Pouch Curd 1 kg ₹80")] }), memory)), []);
});

test("Fee summary ignores charges described in sentences rather than bill rows", () => {
  const result = detect(page({ lines: [item("Cancellation charges ₹50 apply after packing")] }), {});
  assert.deepEqual(result.filter(item => item.key === "fees"), []);
});

test("Evidence quotes the specific line rather than the block that contains it", () => {
  const block = item("Yay! You got FREE delivery Join Pass for ₹99 and save ₹15 on this order Get ₹10 cashback");
  const line = item("Join Pass for ₹99 and save ₹15 on this order");
  const [offer] = detect(page({ lines: [block, line] }), {}).filter(item => item.key === "membershipUpsell");
  assert.equal(offer.evidence, line.text);
});

test("A higher payment total caused by an extra the shopper picked is not reported", () => {
  const cart = [item("Items total ₹80"), item("Grand total ₹136")];
  const payment = [item("Items total ₹80"), item("Tip for delivery partner ₹30"), item("Grand total ₹166")];
  const memory = {};
  detect(page({ lines: cart }), memory);
  assert.deepEqual(detect(page({ stage: "payment", lines: payment, touched: ["tip"] }), memory).filter(item => item.key === "total"), []);
  const unexplained = detect(page({ stage: "payment", lines: payment }), memory).map(item => item.key);
  assert.ok(unexplained.includes("total") && unexplained.includes("basket"));
});

test("A pre-selected extra the shopper touched on an earlier page is not flagged again", () => {
  const protection = item("Order protection ₹19", { selected: true });
  assert.deepEqual(keysOf(detect(page({ controls: [protection] }), {})), ["basket"]);
  assert.deepEqual(keysOf(detect(page({ controls: [protection], touched: ["protect"] }), {})), []);
});
