(() => {
  const rules = {
    urgency: ["False urgency", "Check the offer terms and stock. Take the time you need before ordering."],
    basket: ["Basket sneaking", "Review the selected extra and remove it if you do not want it."],
    shame: ["Confirm shaming", "Read what each option does. Choose based on whether you want the offer."],
    forced: ["Forced action", "Look for guest checkout or an option to skip. Pause before sharing unrelated details."],
    trap: ["Subscription trap", "Find the cancellation steps before you subscribe. Review any payment or mandate request."],
    interference: ["Interface interference", "Look for the smaller decline or cancel control and read it before accepting."],
    switch: ["Bait and switch", "Go back to the original offer and compare the product and total before choosing a replacement."],
    drip: ["Drip pricing", "Compare the cart and payment breakdowns, including changes to delivery, address, or discounts."],
    ad: ["Disguised advertisement", "Check the seller and destination before opening or purchasing through the recommendation."],
    nag: ["Nagging", "Dismiss the prompt or use site settings to disable that request if available."],
    trick: ["Trick question", "Read the statement with the box both selected and unselected. Check which outcome you actually want."],
    saas: ["SaaS billing", "Check the renewal amount, billing date, and reminders. Review the billing settings if you subscribed."],
    rogue: ["Rogue malwares", "Close the tab. Avoid the page’s download or payment prompt. Check security through your device’s trusted settings."],
    upsell: ["Free-delivery upsell", "Compare what you would pay with your current basket. Add items if you want them.", "nudge"],
    minimum: ["Minimum-order prompt", "Check the minimum and your current total. Add items only if they are worth the extra spend.", "nudge"],
    total: ["Checkout total increased", "Compare the fee and discount lines, and check whether delivery or payment choices changed.", "nudge"],
    consent: ["Preselected marketing consent", "Review the switch or checkbox and turn it off if you prefer to skip marketing or personalization.", "review"],
    coupon: ["Lost discount", "Review the coupon terms and check the new amount payable before continuing.", "nudge"],
    renewal: ["Trial renewal", "Check when the first charge starts and how to cancel the trial in time.", "nudge"],
    account: ["Required account", "Look for guest checkout and review what information the site requires.", "nudge"],
    credit: ["Store-credit refund", "Review the refund terms before you pay, especially if you need the money returned to your original payment method.", "nudge"],
    couponUpsell: ["Coupon spend threshold", "Check the coupon conditions and decide whether you want the extra items.", "nudge"],
    fees: ["Extra charges", "Check what each charge is for. Some, such as small-cart or late-night fees, depend on the order and can change.", "nudge"],
    autoCoupon: ["Auto-applied coupon", "Check the coupon’s conditions, such as a minimum spend or eligible items. Removing items or changing the payment method can remove it.", "nudge"],
    membershipUpsell: ["Membership upsell", "Compare the membership fee with what it saves on orders you actually place, and check whether it renews automatically.", "nudge"],
    cashback: ["Cashback as app credit", "Cashback is not money off this order. Check where it is credited, when it expires, and what it can be spent on.", "nudge"],
    freeDelivery: ["Free delivery not applied", "Check the delivery line in the bill and the conditions attached to the free-delivery offer.", "nudge"],
    payLater: ["Pre-selected pay later", "Choose the payment method yourself. Pay-later and EMI options are credit and can add fees or interest.", "nudge"],
    emiFee: ["No-cost EMI with fees", "Check the processing fee and the total you repay before choosing EMI.", "nudge"]
  };

  // A bill row is a fee when its label (the text before the amount) is short and names a fee, charge, or tax.
  const namedFee = /^(?:(?:delivery|handling|packaging)\s*[:·–—₹$€£-]|(?:tax(?:es)?|gst)\b)/i;
  const feeWord = /\b(?:fees?|charges?|surcharges?|tax(?:es)?|gst|cess)\b/i;
  const notFee = /\b(?:discount|saving|savings|off|waiver|cashback|refund|no|without|zero)\b/i;
  const extra = /\b(?:tip|donat(?:e|ion)|insurance|protection|warranty|membership|add[- ]on|gift (?:wrap(?:ping)?|packag(?:e|ing))|subscription|free trial|(?:express|priority) (?:delivery|shipping)|(?:carry|paper|cloth) bags?|eco[- ]friendly (?:packaging|bags?)|secured? (?:delivery|packaging))\b/i;
  const membership = /\b(?:subscription|membership|cancel(?:lation)? (?:your )?plan|free trial)\b/i;
  const billingContext = /\b(?:software|saas|cloud storage|productivity|workspace|streaming|subscription plan)\b/i;
  const discount = /(?:free|waived|included)\s*$/i;
  const feeLabel = text => text.split(/\s*[:·–—-]?\s*(?:₹|\bINR\b|\bRs\.?\s|\$|€|£|\bfree\b|\bwaived\b|\bincluded\b)/i)[0]
    .replace(/\b(?:know more|learn more|details|info)\b|[?ⓘ()]/gi, " ").replace(/\s+/g, " ").trim();
  const isFee = text => {
    const label = feeLabel(text);
    return label.length >= 3 && label.length <= 48 && !notFee.test(label) && (namedFee.test(text) || feeWord.test(label));
  };
  const feeName = text => feeLabel(text).toLowerCase().replace(/\s+(?:fees?|charges?)$/, "");

  // Topics link a bill row to the controls the shopper clicked, so an extra they chose is not reported.
  const topicPattern = /\b(donat|tip|insur|protect|warrant|gift|member|subscri|express|priority|carry|paper|eco|secure|coupon|promo|voucher)/gi;
  const topics = text => [...new Set(Array.from(text.matchAll(topicPattern), match => {
    const word = match[1].toLowerCase();
    return word === "promo" || word === "voucher" ? "coupon" : word;
  }))];
  const extraRow = /^(?:[\w&'’ ]{0,24}\s)?(?:donation|tip|insurance|protection|warranty|gift (?:wrap(?:ping)?|packag(?:e|ing))|membership|subscription|(?:express|priority) (?:delivery|shipping)|(?:carry|paper|cloth) bags?|eco[- ]friendly (?:packaging|bags?)|secured? (?:delivery|packaging))(?:\s[\w&'’ ]{0,24})?$/i;
  const offerWording = /\b(?:add|get|buy|only|join|upgrade|save|with|unlock|want)\b/i;
  // A bill row reads "<label> <amount>" with nothing after the amount.
  function billedExtra(text) {
    const amounts = prices(text);
    if (amounts.length !== 1 || amounts[0].amount <= 0) return null;
    const start = text.indexOf(amounts[0].label);
    if (text.slice(start + amounts[0].label.length).trim()) return null;
    const label = feeLabel(text.slice(0, start));
    if (!extraRow.test(label) || offerWording.test(label)) return null;
    return { label, amount: amounts[0].label.replace(/\s+/g, ""), topics: topics(label) };
  }
  const couponNotice = /\b(?:coupons?|promo(?: code)?|vouchers?)\b.{0,40}\b(?:auto[- ]?)?applied\b|\bauto[- ]?applied\b/i;
  const couponRow = /^(?:coupon|promo|voucher)\s+(?:discount|savings?|applied)\b/i;
  const appliedCoupon = text => !/\b(?:not|no|couldn.t|can.t|cannot|wasn.t)\b.{0,12}applied/i.test(text) &&
    (couponNotice.test(text) || (couponRow.test(text) && prices(text).some(price => price.amount > 0)));

  const cartLabel = /^(?:my |your |shopping )?(?:cart|bag|basket)(?:\s*\(\d+\))?$/i;
  const cartRoute = /(?:^|\s)(?:view|my|shopping)?\s?(?:cart|bag|basket)(?:\s|\.|$)/i;
  const paymentRoute = /(?:^|\s)(?:payments?|pay)(?:\s|\.|$)/i;
  const paymentLabel = /^(?:(?:select|choose)(?: your)? )?payment(?: (?:method|methods|mode|modes|details|options))?$|^review (?:your )?order$/i;
  const paymentChoice = /^(?:select|choose)(?: (?:a|your))? payment (?:method|mode|option)s?$/i;
  const payAction = /^(?:pay (?:now|securely|online)|confirm (?:and pay|order))\b|^pay\s+(?:₹|\$|€|£|inr|rs\b)/i;
  // "Place order" ends checkout on some sites but only leaves the bag on others, so it is a weak payment cue.
  const placeOrder = /^place (?:my |your )?order\b/i;
  const advanceAction = /\b(?:(?:continue|proceed)\s+to\s+(?:checkout|pay(?:ment)?|select (?:an? )?address)|select delivery options|log ?in to (?:proceed|continue|checkout))\b/i;
  const money = String.raw`(?:₹|INR\s*|Rs\.?\s*|\$|€|£)\s*\d[\d,]*(?:\.\d{1,2})?`;
  const amountToAdd = new RegExp(String.raw`\b(?:unlock by adding|add(?:ing)?)\s+(${money})\s+more\b`, "i");
  const deliveryFee = new RegExp(String.raw`\bdelivery\s+(?:fees?|charges?)\s*[:·–—-]?\s*(${money})(?![\d.,])`, "gi");
  const anotherPrice = new RegExp(String.raw`^\s*${money}`, "i");
  const couponThreshold = new RegExp(String.raw`\bshop for\s+(${money})\s+more to apply\b`, "i");
  const couponSaving = new RegExp(String.raw`\bsave\s+(${money})\s+with\s+[A-Z0-9_-]+\b`, "gi");
  const totalRow = /^(?:order total|grand total|bill total|total (?:amount )?payable|total amount|net payable|amount (?:payable|to pay)|to pay|you pay|total)\s*[:·–—-]?\s*$/i;
  const subtotalRow = /^(?:sub\s?total|items? total|merchandise total|total mrp|(?:bag|cart|basket) total)\s*[:·–—-]?\s*$/i;
  // What the items cost after discounts; MRP totals are list prices and would understate the fee share.
  const itemsRow = /^(?:sub\s?total|items? total|(?:bag|cart|basket) total)\s*[:·–—-]?\s*$/i;
  // Popularity claims count as false urgency: the CCPA definition includes "showing false popularity".
  const popularity = /(?:\b\d[\d,.]*\s?[kKlL]?\+?\s+(?:people\s+|customers\s+|shoppers\s+|users\s+|others\s+)?(?:bought|ordered|purchased|booked)\b|\bin\s+\d[\d,]*\+?\s+(?:carts|bags)\b|\b\d[\d,]*\+?\s+(?:people|others|shoppers)\s+(?:have|added)\s+(?:this|it)\b|(?<!due to )\bhigh demand\b|\btrending (?:now|in your (?:area|city))\b)/i;
  const declineStart = /^(?:no(?:,| thanks)?|i (?:prefer|will|don.t|do not|am ok|.m ok|.ll)|skip|continue without|proceed without|maybe later|not now|remove|cancel|give up)\b/i;
  const shameWords = /\b(?:hate saving|don.t care|prefer to pay more|want to pay more|stay (?:uninsured|unprotected|unsecured)|don.t like saving|risk (?:my|losing)|don.t want to (?:help|thank)|rather pay more|miss out on savings|pay (?:full price|more)|(?:don.t|do not) (?:want|like|need) (?:to )?(?:save|savings|saving money|discounts?|offers?|free \w+|deals?|rewards?|benefits?|protection)|without (?:saving|savings|discounts?|protection|insurance|benefits?|rewards?|offers?)|lose (?:my |the |all |these )?(?:savings|discounts?|benefits?|rewards?|offers?)|miss (?:out|the deal))\b/i;
  const lossFrame = /\byou(?:'ll|’ll| will)? (?:lose|miss out on|forfeit)\b.{0,40}(?:savings?|discounts?|benefits?|offers?|cashback|rewards?|₹)/i;
  const autoRenew = /\b(?:auto[- ]?renew(?:al)?|autopay|auto[- ]?debit|recurring payments?|renews? automatically|standing instruction)\b/i;
  const payLater = /\b(?:pay ?later|buy now,? pay later|bnpl|simpl|lazypay|postpaid|emi)\b/i;
  const membershipOffer = /\b(?:join|get|add|buy|try|upgrade to|become an?|unlock)\b.{0,30}\b(?:membership|pass|gold|plus|insider|prime|bbstar|vip|club)\b/i;
  const saveAmount = new RegExp(String.raw`\bsave\s+(${money})`, "i");
  const freeDeliveryClaim = /^(?:yay!?\s*)?(?:you (?:got|get|have|unlocked)\s+|enjoy\s+|get\s+)?free delivery(?: on this order| applied| unlocked| for you)?\s*!?$/i;

  // Product cards ("16 MINS Amul Curd 1 kg ₹80 ADD") record list prices to compare with the cart later.
  const itemName = text => text.replace(/\b\d+\s*mins?\b|\b\d+%\s*off\b|^\s*(?:ad|sponsored|bestseller|new)\b/gi, " ")
    .replace(/\s+/g, " ").trim().toLowerCase();
  function productLine(text, listing) {
    if (listing !== /\bADD\b|\badd to (?:cart|bag|basket)\b/i.test(text)) return null;
    const amounts = prices(text);
    if (!amounts.length || amounts.length > 2) return null;
    const name = itemName(text.slice(0, text.indexOf(amounts[0].label)));
    return name.length >= 8 && name.length <= 140 ? { name, amount: amounts[0].amount, currency: amounts[0].currency } : null;
  }

  const renewalRate = new RegExp(String.raw`\b(?:then|renews? at|charged at)\s+(${money})\s*(?:\/|per )\s*(week|month|year)\b`, "i");

  function checkoutStage({ headings, lines, controls, route, hasTotal }) {
    const text = lines.map(item => item.text);
    const actions = controls.map(item => item.text);
    if (headings.some(value => /\b(?:order (?:placed|confirmed)|thank you for your order)\b/i.test(value))) return null;
    if (paymentRoute.test(route)) return "payment";
    if (cartRoute.test(route)) return "cart";
    if (headings.some(value => paymentLabel.test(value)) ||
        text.some(value => paymentChoice.test(value)) ||
        actions.some(value => payAction.test(value))) return "payment";
    if (headings.some(value => cartLabel.test(value)) ||
        (hasTotal && (text.some(value => cartLabel.test(value) || /^(?:bill details|bill summary|order summary|price details)\b/i.test(value)) ||
          actions.some(value => advanceAction.test(value))))) return "cart";
    if (actions.some(value => placeOrder.test(value))) return "payment";
    return null;
  }

  function prices(text) {
    return Array.from(text.matchAll(/(₹|\bINR\s*|\bRs\.?\s*|\$|€|£)\s*(\d[\d,]*(?:\.\d{1,2})?)/gi), match => ({
      label: match[0],
      amount: Number(match[2].replaceAll(",", "")),
      currency: /^(?:₹|inr|rs)/i.test(match[1]) ? "INR" : match[1]
    }));
  }

  function getDeliveryUpsell(entry) {
    const text = entry.text;
    const start = text.search(/\bfree(?: delivery)?\s+(?:above|over|on orders)\b/i);
    const offer = start < 0 ? text : text.slice(start);
    const increase = offer.match(amountToAdd);
    if (!increase || (start < 0 && !/\bfree delivery\b/i.test(offer))) return null;
    const [extraSpend] = prices(increase[1]);
    if (!extraSpend || extraSpend.amount <= 0) return null;

    for (const context of [text, ...(entry.nearby || [])]) {
      const fees = [...context.matchAll(deliveryFee)];
      if (!fees.length) continue;
      if (fees.length !== 1 || anotherPrice.test(context.slice(fees[0].index + fees[0][0].length))) return null;
      const [saving] = prices(fees[0][1]);
      if (!saving || saving.amount <= 0 || saving.currency !== extraSpend.currency) return null;
      const difference = Math.round(extraSpend.amount * 100) - Math.round(saving.amount * 100);
      const symbol = { INR: "₹", "$": "$", "€": "€", "£": "£" }[saving.currency];
      const format = units => symbol + (units / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
      const feeText = format(Math.round(saving.amount * 100));
      const comparison = difference > 0 ? `You’d spend ${format(difference)} more to save ${feeText} on delivery.`
        : difference < 0 ? `You’d spend ${format(-difference)} less overall after saving ${feeText} on delivery.`
        : `Your total would stay the same after saving ${feeText} on delivery.`;
      const end = increase.index + increase[0].length;
      const evidence = offer.slice(0, end) + (offer[end] === ")" ? ")" : "");
      return { offer: evidence, comparison };
    }
    return null;
  }

  function getCouponUpsell(entry) {
    const threshold = entry.text.match(couponThreshold);
    if (!threshold) return null;
    const [extraSpend] = prices(threshold[1]);
    if (!extraSpend || extraSpend.amount <= 0) return null;
    for (const context of [entry.text, ...(entry.nearby || [])]) {
      const offers = [...context.matchAll(couponSaving)];
      if (!offers.length) continue;
      if (offers.length !== 1) return null;
      const [saving] = prices(offers[0][1]);
      if (!saving || saving.currency !== extraSpend.currency || extraSpend.amount <= saving.amount || saving.amount <= 0) return null;
      const difference = Math.round(extraSpend.amount * 100 - saving.amount * 100) / 100;
      return {
        evidence: `${offers[0][0]} · ${threshold[0]}`,
        signal: `You’d spend ${formatMoney(difference, saving.currency)} more overall if the ${formatMoney(saving.amount, saving.currency)} coupon applies.`
      };
    }
    return null;
  }

  function detect(page, memory) {
    const findings = [];
    const add = (key, signal, entry, evidence = entry.text) => {
      // Container elements repeat their children's text, so keep the most specific line as evidence.
      const duplicate = findings.findIndex(item => item.key === key &&
        (item.evidence.includes(evidence) || evidence.includes(item.evidence)));
      if (duplicate >= 0 && findings[duplicate].evidence.length <= evidence.length) return;
      const [title, advice, kind = "review"] = rules[key];
      const ccpa = rules[key].length === 2;
      const finding = { key, title, advice, kind: key === "rogue" ? "security" : kind, ccpa, signal, evidence, target: entry.id };
      if (duplicate >= 0) findings[duplicate] = finding;
      else findings.push(finding);
    };

    // When the page has a recognisable bill, only its rows count as charges or extras.
    const billLine = entry => !page.hasBill || entry.inBill;
    const touched = new Set(page.touched || []);
    const feeRows = page.lines.filter(entry => billLine(entry) && isFee(entry.text) && prices(entry.text).length <= 2);
    if (page.stage === "cart" && (feeRows.length || page.hasTotal)) {
      const subtotal = billAmount(page.lines, subtotalRow);
      const total = billAmount(page.lines, totalRow);
      const amounts = subtotal && total && subtotal.currency === total.currency && subtotal.amount > 0
        ? { subtotal: subtotal.amount, total: total.amount, currency: total.currency } : null;
      const fees = [...new Map(feeRows.map(entry => [feeName(entry.text), feeLabel(entry.text)])).entries()].slice(0, 60);
      memory.cart = {
        fees: fees.map(([name]) => name),
        labels: fees.map(([, label]) => label).slice(0, 12),
        total: total ? formatMoney(total.amount, total.currency) : null,
        amounts
      };
    }
    if (page.stage === "payment" && memory.cart) {
      const previous = memory.cart.amounts;
      const current = billAmount(page.lines, totalRow);
      const subtotal = billAmount(page.lines, subtotalRow);
      const chosenExtras = page.lines.reduce((sum, entry) => {
        const extraLine = billLine(entry) && billedExtra(entry.text);
        return extraLine && extraLine.topics.some(topic => touched.has(topic)) ? sum + prices(entry.text)[0].amount : sum;
      }, 0);
      if (previous && current && subtotal?.amount === previous.subtotal &&
          current.currency === previous.currency && subtotal.currency === current.currency &&
          current.amount > previous.total + chosenExtras + 0.5) {
        const before = formatMoney(previous.total, current.currency);
        const after = formatMoney(current.amount, current.currency);
        add("total", `Your displayed total rose from ${before} to ${after} while the displayed subtotal stayed the same.`, current.entry);
      }
      for (const entry of feeRows) {
        if (prices(entry.text).some(price => price.amount > 0) && !discount.test(entry.text) && !memory.cart.fees.includes(feeName(entry.text))) {
          add("drip", `“${feeLabel(entry.text)}” was not in the cart’s price breakdown. It first appeared at payment.`, entry);
        }
      }
    }

    // Quick-commerce fees are only listed inside the bill, so summarise what they add to the order.
    const charged = page.stage ? feeRows.flatMap(entry => {
      const amount = prices(entry.text).at(-1);
      const billLine = amount && !entry.text.slice(entry.text.lastIndexOf(amount.label) + amount.label.length).trim();
      return billLine && amount.amount > 0 && !discount.test(entry.text) ? [{ entry, amount, label: feeLabel(entry.text) }] : [];
    }) : [];
    if (charged.length) {
      const currency = charged[0].amount.currency;
      const rows = charged.filter(row => row.amount.currency === currency);
      const sum = Math.round(rows.reduce((total, row) => total + row.amount.amount * 100, 0)) / 100;
      const items = billAmount(page.lines, itemsRow);
      const percent = items?.currency === currency && items.amount > 0 ? Math.round(sum / items.amount * 100) : 0;
      const share = percent >= 1 ? ` That is ${percent}% on top of your ${formatMoney(items.amount, currency)} items total.` : "";
      const smallCart = rows.some(row => /\bsmall[- ](?:cart|order|basket)\b/i.test(row.label))
        ? " The small-cart charge applies because the order is below a minimum." : "";
      add("fees", `${rows.length === 1 ? "1 charge adds" : `${rows.length} charges add`} ${formatMoney(sum, currency)} to this order.${share}${smallCart}`,
        rows[0].entry, rows.map(row => `${row.label} ${formatMoney(row.amount.amount, currency)}`).join(" · "));
      const deliveryRow = rows.find(row => /\bdelivery\b/i.test(row.label));
      if (deliveryRow && page.lines.some(entry => freeDeliveryClaim.test(entry.text))) {
        add("freeDelivery", `The page says delivery is free, but the bill charges ${formatMoney(deliveryRow.amount.amount, currency)} for “${deliveryRow.label}”.`, deliveryRow.entry);
      }
    }

    // A price that rises between the product card and the cart. Whole multiples are treated as quantity.
    memory.listed ??= {};
    for (const entry of page.lines) {
      const card = productLine(entry.text, true);
      if (!card || card.currency !== "INR") continue;
      if (memory.listed[card.name] === undefined && Object.keys(memory.listed).length >= 300) continue;
      if (!(memory.listed[card.name] <= card.amount)) memory.listed[card.name] = card.amount;
    }
    if (page.stage) {
      for (const entry of page.lines) {
        const item = productLine(entry.text, false);
        const listed = item && memory.listed[item.name];
        if (!listed || item.amount <= listed + 0.5) continue;
        const ratio = item.amount / listed;
        if (ratio >= 2 && Math.abs(ratio - Math.round(ratio)) < 0.01) continue;
        add("drip", `This item was listed at ${formatMoney(listed, "INR")} earlier in this session and costs ${formatMoney(item.amount, "INR")} here.`, entry);
      }
    }

    for (const control of page.controls) {
      const { text, context = text } = control;
      const picked = control.chosen || topics(text).some(topic => touched.has(topic));
      if (page.stage && control.selected && !picked && extra.test(text) && prices(text).some(price => price.amount > 0)) {
        add("basket", "A paid extra was already selected when the extension first observed it.", control);
      }
      if (control.toggleable && control.selected && !control.chosen &&
          /\b(?:marketing (?:emails?|messages|communications|updates)|promotional (?:emails?|messages|communications|offers)|newsletter|personali[sz]ed ads?|allow tracking|(?:offers?|promotions?|deals?) (?:on|via) (?:whatsapp|sms)|whatsapp (?:offers|promotions|marketing))\b/i.test(text) &&
          !/\b(?:opt out|unsubscribe|decline|disable|do not|don.t)\b/i.test(text)) {
        add("consent", "This option was already selected when the extension observed it.", control);
      }
      if (declineStart.test(text) && shameWords.test(text)) {
        add("shame", "The decline option uses guilt, fear, or a sense of loss.", control);
      }
      if (control.selected && !control.chosen && autoRenew.test(text) && !/\b(?:turn off|disable|cancel|stop|don.t|do not)\b/i.test(text)) {
        add("trap", "Automatic renewal or a recurring payment was switched on before you chose it.", control);
      }
      if (control.selected && !control.chosen && payLater.test(text)) {
        add("payLater", "A pay-later or EMI option was already selected when the extension observed it.", control);
      }
      if ((control.required && /\b(?:marketing|newsletter|promotional|share (?:my |your )?contacts|download (?:our|the) app)\b/i.test(text))) {
        add("forced", "An unrelated option is marked as required.", control);
      }
      if (/\b(?:do not|don.t|never)\b.{0,60}\b(?:opt out|unsubscribe|decline|disable|do not|don.t|not receive)\b/i.test(text) ||
          (/\b(?:opt out|unsubscribe)\b.*\?/i.test(context) && /^(?:yes|agree)\b.*\b(?:receive|subscribe|get updates)\b/i.test(text))) {
        add("trick", "The wording or answer makes it hard to tell which choice opts out.", control);
      }
    }

    for (const entry of page.lines) {
      const text = entry.text;
      // A priced extra next to an unticked box is an offer, not a charge.
      const billed = page.stage && billLine(entry) && entry.toggle !== false && billedExtra(text);
      if (billed && !billed.topics.some(topic => touched.has(topic)) &&
          !findings.some(item => item.key === "basket" && topics(item.evidence).some(topic => billed.topics.includes(topic)))) {
        add("basket", `${billed.amount} for “${billed.label}” is already in your bill, and you haven’t selected it during this watch.`, entry);
      }
      if (page.stage && !touched.has("coupon") && !findings.some(item => item.key === "autoCoupon") && appliedCoupon(text)) {
        add("autoCoupon", "A coupon is applied, but you haven’t opened or applied one during this watch.", entry);
      }
      if (page.stage && text.length < 220 && membershipOffer.test(text)) {
        const save = text.match(saveAmount);
        const [cost] = prices(save ? text.replace(save[0], "") : text);
        const [saving] = save ? prices(save[1]) : [];
        if (cost?.amount > 0) {
          const fee = formatMoney(cost.amount, cost.currency);
          const signal = !saving || saving.currency !== cost.currency ? `The checkout promotes a paid membership costing ${fee}.`
            : saving.amount < cost.amount ? `The membership costs ${fee} but saves ${formatMoney(saving.amount, saving.currency)} on this order, so this order alone does not cover it.`
            : `The membership costs ${fee} and the page says it saves ${formatMoney(saving.amount, saving.currency)} on this order. Check whether that saving is guaranteed.`;
          add("membershipUpsell", signal, entry);
        }
      }
      if (page.stage && text.length < 240 && /\bcashback\b/i.test(text) && !/\binstant\b/i.test(text) &&
          /\b(?:wallet|credits?|super ?cash|points|coins|gift card|balance|money)\b/i.test(text)) {
        const expires = /\bexpir/i.test(text) ? " The page also says it expires." : "";
        add("cashback", `This cashback is credited as app credit or points, not taken off this order.${expires}`, entry);
      }
      if (/\bno[- ]cost emi\b/i.test(text) && !findings.some(item => item.key === "emiFee")) {
        const fee = page.lines.find(row => /\b(?:processing|emi|convenience) (?:fees?|charges?)\b/i.test(row.text) && prices(row.text).some(price => price.amount > 0));
        if (fee) add("emiFee", "“No-cost EMI” is offered, but the page also lists a processing or EMI fee.", fee);
      }
      const upsell = getDeliveryUpsell(entry);
      if (upsell) add("upsell", upsell.comparison, entry, upsell.offer);
      const couponOffer = getCouponUpsell(entry);
      if (couponOffer) add("couponUpsell", couponOffer.signal, entry, couponOffer.evidence);
      if (page.stage && /\b(?:minimum order|order minimum)\b/i.test(text) &&
          (/\b(?:add|below|short|to (?:checkout|proceed)|required)\b/i.test(text) || prices(text).length > 0)) {
        add("minimum", "This checkout shows a minimum spend requirement.", entry);
      }
      if (page.stage && /\b(?:coupon|promo(?: code)?|discount|voucher)\b.{0,45}\b(?:removed|no longer (?:applies|valid|eligible)|wasn.t applied|couldn.t be applied|not applied|has expired)\b/i.test(text)) {
        add("coupon", "The checkout says a discount is unavailable or was removed from this order.", entry);
      }
      // Trial fine print often sits in its own line under the offer, so an auto-renew notice counts as the membership context.
      if ((membership.test(text) || /\bauto[- ]?renews?\b/i.test(text)) && /\b(?:free trial|free for \d+ (?:days?|weeks?|months?))\b/i.test(text)) {
        const renewal = text.match(renewalRate);
        if (renewal && prices(renewal[1])[0]?.amount > 0) {
          add("renewal", `After the free period, the page lists ${renewal[1]} per ${renewal[2].toLowerCase()}.`, entry);
        }
      }
      if (page.stage && /\b(?:sign in|log in|create an? account|register)\b.{0,38}\b(?:required|to (?:check\s?out|place (?:your )?order|continue (?:to )?payment))\b/i.test(text)) {
        add("account", "The page says an account is needed to complete checkout.", entry);
      }
      if (page.stage && /\b(?:refunds? (?:are |will be )?(?:only|solely)|(?:only|solely) (?:receive|get) (?:a )?refund)\b.{0,48}\b(?:store credit|gift card|wallet balance)\b/i.test(text)) {
        add("credit", "The stated refund method is limited to store credit or a similar balance.", entry);
      }
      const scarcity = /\b(?:only\s+(?:\d+|a few|few)\s+(?:items?\s+|units?\s+|slots?\s+)?(?:left|remaining|in stock)|\d+\s+(?:people|shoppers|users)\s+(?:are )?(?:viewing|looking|watching)|(?:offer|deal|sale|reservation|price|delivery slot)\s+(?:expires|ends|resets|is held)|limited[- ]time offer|hurry|selling fast|almost gone|last chance|order (?:with)?in (?:the next )?\d+\s*(?:hrs?|hours?|mins?|minutes?)|(?:slots?|stock) (?:are |is )?(?:filling|running out|selling) fast)\b/i.test(text) ||
          /^(?:only\s+)?\d+\s+left(?:\s+in stock)?!?$/i.test(text);
      if (scarcity || (text.length < 160 && popularity.test(text))) {
        const clock = text.match(/\b\d{1,2}\s?:\s?\d{2}(?:\s?:\s?\d{2})?\b|\b\d{1,2}h\s*\d{1,2}m(?:\s*\d{1,2}s)?\b/i);
        const evidence = clock ? text.replace(clock[0], "[countdown]") : text;
        let signal = scarcity ? "This message uses scarcity or a deadline to encourage a quick decision."
          : "This message uses popularity or demand to encourage a quick decision.";
        if (clock) {
          memory.timers ??= new Map();
          if (memory.timers.size >= 60 && !memory.timers.has(evidence)) memory.timers.clear();
          const time = clock[0].match(/\d+/g).reduce((seconds, part) => seconds * 60 + Number(part), 0);
          const previous = memory.timers.get(evidence);
          const restarted = previous?.restarted || (previous?.time <= 2 && time >= 10);
          memory.timers.set(evidence, { time, restarted });
          if (restarted) signal = "This countdown jumped back up after nearly expiring.";
        }
        add("urgency", signal, entry, evidence);
      }
      if (/\b(?:newsletter|marketing emails?|download (?:our|the) app|share (?:your )?contacts|enable notifications)\b/i.test(text) &&
          /\b(?:required|must|to continue|to checkout|before you can|only way)\b/i.test(text)) {
        add("forced", "The page links an unrelated request to continuing the task.", entry);
      }
      if (membership.test(text) && /\b(?:to cancel|cancel(?:lation)? (?:requires|only)|can only cancel|cannot cancel)\b/i.test(text) &&
          /\b(?:call|phone|mail|in person|visit|cannot cancel|contact support)\b/i.test(text)) {
        add("trap", "The stated cancellation method requires another channel or limits cancellation.", entry);
      }
      if (/\bfree trial\b/i.test(text) && /\b(?:card required|requires? (?:a |your )?(?:payment method|card|credit card)|(?:payment|card|auto[- ]?debit) (?:details|authorization) required)\b/i.test(text)) {
        add("trap", "The free trial asks for a payment method or debit authorization.", entry);
      }
      if (/\b(?:sold out|unavailable|out of stock|no longer available)\b/i.test(text) &&
          /\b(?:instead|replacement|alternative|upgrade|similar|switch to)\b/i.test(text) && prices(text).some(price => price.amount > 0)) {
        add("switch", "The page offers a priced replacement alongside an unavailable option.", entry);
      }
      if (billingContext.test(text) && /\b(?:automatically renews?|auto[- ]?renew|automatically (?:charged|billed)|recurring charge)\b/i.test(text) &&
          !prices(text).some(price => price.amount > 0)) {
        add("saas", "Automatic billing is mentioned without an amount in the same statement.", entry);
      }
      if (/\b(?:device|computer|windows|mac|phone|system)\b.{0,48}\b(?:infected|viruses?|malware|locked)\b/i.test(text) &&
          /\b(?:download|install|pay|call|scan now|unlock)\b/i.test(text)) {
        add("rogue", "A webpage claims there is a device threat and asks you to take action.", entry);
      }
    }

    for (const prompt of page.dialogs) {
      if (prompt.accept && prompt.decline &&
          (prompt.accept.font >= prompt.decline.font * 1.45 || prompt.decline.opacity <= 0.45)) {
        add("interference", "The decline control is much smaller or fainter than the accept control.", prompt.decline);
      }
      if (!prompt.decline && /^accept all(?: cookies)?$/i.test(prompt.accept?.text || "") &&
          /\bcookies\b/i.test(prompt.text) && /\b(?:analytics|marketing|personali[sz]|advertising)\w*/i.test(prompt.text)) {
        add("interference", "The cookie dialog offers Accept all without a clear decline control.", prompt);
      }
      if (lossFrame.test(prompt.text || "")) {
        add("shame", "The dialog warns that you will lose savings to discourage you from leaving or removing something.", prompt);
      }
      if (prompt.reappeared && /\b(?:notifications?|cookies?|offer|newsletter|download|app|subscribe|trial|membership)\b/i.test(prompt.text)) {
        add("nag", "This prompt returned after you dismissed it.", prompt);
      }
    }
    for (const link of page.links) {
      if (link.adSignal && !link.disclosed) {
        add("ad", "A recommendation link has advertising indicators and no visible disclosure was found nearby.", link);
      }
    }
    // Security first, then money already added to the bill, then everything else in page order.
    const priority = { rogue: 0, drip: 1, basket: 1, total: 2, fees: 2, upsell: 2 };
    return findings.sort((left, right) => (priority[left.key] ?? 3) - (priority[right.key] ?? 3));
  }

  function formatMoney(amount, currency) {
    return (currency === "INR" ? "₹" : currency) + amount.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }

  function billAmount(lines, row) {
    const candidates = new Map();
    for (const entry of lines) {
      const [price, other] = prices(entry.text);
      if (!price || other) continue;
      const start = entry.text.indexOf(price.label);
      if (row.test(entry.text.slice(0, start)) && !entry.text.slice(start + price.label.length).trim()) {
        candidates.set(`${price.currency} ${price.amount}`, { entry, amount: price.amount, currency: price.currency });
      }
    }
    return candidates.size === 1 ? candidates.values().next().value : null;
  }

  globalThis.CheckoutRules = { checkoutStage, detect, rules, topics };
})();
