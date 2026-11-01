# Releasing the paid edition on the Chrome Web Store

> 🇻🇳 Vietnamese: [`HUONG-DAN-PHAT-HANH.md`](HUONG-DAN-PHAT-HANH.md)

The store edition is built automatically from the `extension/` folder (the personal edition stays untouched and unlimited):

    python3 tools/build-store.py        →  dist/song-ngu-thuyet-minh-<version>.zip   (upload to the store)
                                           dist/store/                               (Load unpacked to try it)

Differences from the personal edition: free 30 minutes/day, Pro unlocked through Lemon Squeezy; the name doesn't contain "YouTube";
no offline Piper/MMS voices (training data forbids commercial use); ships with LICENSE GPL-3.0 + NOTICE; no test channel (dev-mode.json).

## Things only the owner can do (accounts, paperwork, payments)

1. **Lemon Squeezy** (https://app.lemonsqueezy.com/register)
   - Sign up, create a Store, fill in payout details: Vietnamese bank accounts are supported (or PayPal).
   - Lemon Squeezy reviews the store before enabling live sales (a few days) — needs a product description + links to the store page / policies.
   - Create the product **Song Ngữ Pro** with 3 variants:
     | Variant | Price | Type |
     |---|---|---|
     | Monthly | 2 USD | Subscription, every 1 month |
     | Yearly | 20 USD | Subscription, every 1 year |
     | Lifetime | 50 USD | Single payment |
   - On each variant enable **Generate license keys**, Activation limit = 3, License length = Unlimited
     (for monthly/yearly plans the key expires automatically when the subscription ends).
   - Then fill `store/config.json` with the store ID, product ID, variant IDs and checkout links (template in the file) and rebuild.

2. **Chrome Web Store** (https://chrome.google.com/webstore/devconsole)
   - Register a developer account (one-time 5 USD fee), verify the email; set the Publisher name — this is the seller name customers see.
   - Support email: fill in `store/config.json` ("support") and `store/privacy.html` (2 occurrences of "[email hỗ trợ]").

3. **Privacy-policy page + GPL source** — needs a public URL.
   Simplest: a public GitHub repository with the source (which also satisfies GPL's source-disclosure requirement) and GitHub Pages
   enabled for `store/privacy.html`.

## Submitting to the store

- Package: upload `dist/song-ngu-thuyet-minh-<version>.zip`.
- Store listing: copy from `store/listing.md`; images in `store/assets/` (5 screenshots 1280×800 + small tile 440×280); category Education.
- Privacy practices: copy from `store/review-notes.md` (purpose, permission justifications, data, reviewer notes).
- Privacy policy URL: the page from step 3.
- Distribution: Public, all countries (or Vietnam only).
- First review usually takes 1–7 days; host access to every site (`<all_urls>`) may get a closer look.

## Shipping an update
1. Change the code in `extension/`, run the tests (see README).
2. Bump "version" in `store/config.json`, run `python3 tools/build-store.py`.
3. Upload the new zip in the extension's Package tab on the store.

## Notes
- Lemon Squeezy is the merchant of record: it collects VAT / sales tax from foreign customers and pays you out.
  Fee: 5 % + 0.50 USD per transaction. Income tax on the Vietnamese side is your responsibility (this is not legal or accounting advice).
- License checks: the extension calls Lemon Squeezy's License API directly, no server of your own. Pro is kept for 7 days offline.
- Customers who need their key again / want to cancel: https://app.lemonsqueezy.com/my-orders (linked from the extension's Pro page).
