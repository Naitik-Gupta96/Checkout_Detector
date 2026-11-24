# Checkout Dark Pattern Detector

This Chrome extension watches a shopper-selected web tab and flags visible signals associated with the 13 categories in [Annexure 1 of the CCPA guidelines](https://consumeraffairs.gov.in/public/upload/files/The%20Guidelines%20for%20Prevention%20and%20Regulation%20of%20Dark%20Patterns%2C%202023_1732705993.pdf). Each card shows the observed evidence, a suggested next step, and a control that highlights the relevant part of the page.

## Install and use

1. Extract the ZIP if applicable. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select the folder containing `manifest.json`. Pin the extension so you can see its badge.
3. Open the cart on a website. Open the extension and click **Start watching**. Check that the cart has loaded before going to payment.
4. The **Checkout Detector** panel opens at the bottom left when it finds an alert. Each alert names the pattern, quotes the text found on the page, and suggests a next step. **Show on page** minimizes the panel and outlines the relevant element. **I chose this** (for pre-selected extras) or **Dismiss** hides an alert for the rest of the watch.
5. The toolbar badge counts current findings. The popup shows a **Cart → Payment** tracker and the fees recorded from your cart, so you can see what the payment screen is compared against. A dot in the toolbar indicates an active watch with zero current alerts.
6. Click **Stop watching** in either view to end the session. If checkout opens a new tab or moves to another origin, start a fresh watch there. A new watch cannot reconstruct fee evidence from the previous tab.

The popup indicates whether it recognized the cart or payment screen and whether it saved the cart fee baseline. For unpacked updates, click **Reload** on the extension card at `chrome://extensions`, then refresh the shopping tab and start a new watch.

Charges and extras are read from the page's bill (the block around **Bill details** or **Price details** that also shows the total). A donation, tip or other extra is flagged only while it is in that bill, so unticking it clears the alert. Anything you tick or pick yourself while watching counts as your choice and is not flagged, including on later checkout pages. On quick-commerce carts, expand **Sub total** under **Bill details** if the individual charges are collapsed.

The [activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) grants temporary access to the selected tab. The extension processes evidence locally. It reads displayed labels and selected controls, without reading typed field values. The tab's cart fee labels are held in Chrome's in-memory session storage to support same-origin navigation. The extension sends no data to a server and does not click any purchase or removal controls.

## Detection coverage

| CCPA category | Signal implemented |
| --- | --- |
| False urgency | Scarcity or deadline language, with stronger evidence when a visible countdown jumps back up after nearly expiring. Popularity and demand claims such as “1.2K+ bought in past month”, “In 23 carts” or “High demand in your area”, since the CCPA definition includes false popularity |
| Basket sneaking | A paid extra (donation, tip, gift packaging, protection, membership, carry bag, secure delivery) that is pre-selected or already billed, which the shopper has not clicked during the watch |
| Confirm shaming | Guilt, fear or loss framing on a decline option (“Continue without savings”), or an exit dialog warning that you will lose savings |
| Forced action | A mandatory marketing, contact-sharing, notification, or app-download prompt |
| Subscription trap | A trial requiring a payment method, wording that limits cancellation or sends the shopper to another channel, or auto-renew / autopay switched on before the shopper chose it |
| Interface interference | A dialog's decline option is substantially smaller or fainter than its accept option |
| Bait and switch | Sold-out wording paired with a priced alternative |
| Drip pricing | A positive fee first shown at payment after the extension captured the cart, or an item that costs more in the cart than on its product card earlier in the watch |
| Disguised advertisement | A recommendation link with advertising indicators and no visible disclosure nearby |
| Nagging | A commercial dialog returns after the shopper dismisses it |
| Trick question | Confusing opt-out wording or an answer that conflicts with the question |
| SaaS billing | Automatic billing in a software subscription statement without a visible amount in that statement |
| Rogue malwares | A webpage claims a device is infected or locked and asks the shopper to download, call, or pay |

These are signals to review. The extension cannot establish intent, compare prices across devices (reported iOS-versus-Android price differences happen inside native apps, which a browser extension cannot see), verify stock, inspect bank transactions, or determine whether malware is present. English-language heuristics cover the visible top-level page. Native apps, embedded cross-origin payment frames, and unfamiliar layouts may escape detection. A site that changes fees after an address or basket update can trigger a late-fee signal. A shopper who activates the extension after making selections can see those selections flagged.

## Additional checks

| Check | Signal implemented |
| --- | --- |
| Extra charges | The delivery, handling, small-cart and other charges in the bill, their sum, and their share of the items total |
| Free-delivery upsell | The extra spend needed to unlock delivery minus the current delivery fee, assuming other charges stay the same |
| Minimum-order prompt | Visible text asking the shopper to meet a stated minimum |
| Checkout total increased | The amount payable rose while the displayed subtotal stayed the same |
| Preselected marketing consent | A selected opt-in for marketing, personalisation, tracking, or offers on WhatsApp or SMS |
| Lost discount | A notice that a coupon, voucher, or discount is unavailable or was removed |
| Coupon spend threshold | The extra spend required to unlock a coupon minus its advertised savings |
| Membership upsell | A paid membership promoted at checkout, compared with what it says it saves on this order |
| Cashback as app credit | Cashback paid as wallet money, points or coins rather than taken off the order, and whether it expires |
| Free delivery not applied | The page claims free delivery while the bill charges for delivery |
| Pre-selected pay later | A pay-later, BNPL or EMI payment option selected before the shopper chose it |
| No-cost EMI with fees | “No-cost EMI” offered alongside a processing or EMI fee |
| Auto-applied coupon | A coupon shown as applied although the shopper has not touched the coupon section, so its conditions are worth checking |
| Trial renewal | A recurring rate visible alongside a free trial or free period |
| Required account | A notice that sign-in or registration is required to check out |
| Store-credit refund | Terms saying refunds are limited to store credit, a gift card, or a wallet balance |

Interface interference also checks cookie dialogs that expose **Accept all** and lack a clear decline control. Shopping nudges and terms can help the shopper make a decision and vary with context.

## Test the project prototype

From the parent folder, serve the supplied simulator over HTTP. For example, run `python -m http.server 8765 --bind 127.0.0.1 --directory <folder-containing-simulator>` and open the simulator through `http://127.0.0.1:8765`. The extension only watches HTTP and HTTPS pages.

Use the Dark checkout to review default add-ons and step through payment. Repeat in Fair with an upfront fee and an extra that you deliberately opt into. For merchant validation, record the site, date, checkout step, expected evidence, actual result, and whether the suggested action was possible. Real merchant coverage remains unverified.

Run the automated rule tests from this folder with `node --test tests/rules.test.cjs`.

`tests/fixtures/` holds synthetic pages for regression checks: a bag and payment page laid out like a large Indian fashion retailer's checkout (the bag's button reads **Place order**, and a cash-on-delivery fee first appears at payment), and a quick-commerce cart drawer placed after a long product grid with a pre-selected tip and donation.

If the detector misses something on a real site, open **What we check → Copy page diagnostics** while watching. It copies the stage, recorded fees, and visible page text the scanner read, which is enough to reproduce the case as a fixture.

A local Chrome smoke test checked a preselected extra, a deliberately selected tip, evidence highlighting, cart-to-payment navigation, a newly displayed fee, and stopping the watch. The smoke test used a temporary localhost permission to drive Chrome without clicking the toolbar. The distributed manifest uses only temporary tab access.
