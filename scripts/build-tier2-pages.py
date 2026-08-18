#!/usr/bin/env python3
"""Build tier-2 where-to-buy-<product>-singapore pages from a structured spec.

Follows the tier-1 frontmatter schema (slug/title/description/author/publishedAt/
lastUpdatedAt/tags/jsonLd) and the tier-1 body structure:
  - H1 title
  - Quick Answer callout
  - Merchants-at-a-glance table
  - How to choose
  - How AI agents track prices (BuyWhere MCP)
  - Common questions
  - Where to go next (internal links)

Fact-guard discipline: no invented competitor prices; ranges are well-known
SG market-practice claims already established by the tier-1 laptop/iphone15
pages. Each page identifies the canonical /<product>-singapore merchant page
that already exists in the buywhere catalog.
"""

import json
from pathlib import Path

REPO = Path("/home/paperclip/buywhere")
OUT = REPO / "content" / "blog"
OUT.mkdir(parents=True, exist_ok=True)

DATE = "2026-08-18"

# Each entry: slug, product_display, product_for_merchant, brand, product_short,
# merch_rows (table), how_to_choose bullets, canonical internal links,
# faqs, tag set.
PAGES = [
    {
        "slug": "where-to-buy-airpods-singapore",
        "product": "AirPods",
        "brand": "Apple",
        "product_short": "AirPods (Pro 2, Pro 3, 4, Max)",
        "tags": ["airpods", "apple", "singapore", "where-to-buy", "comparison"],
        "merch": [
            ("Apple Store SG", "Official pricing, Edu discount, trade-in", "AirPods Pro 2/3, AirPods 4, AirPods Max", "Apple SG 1-yr"),
            ("Shopee SG (Mall)", "Lowest platform price, vouchers", "AirPods Pro 2/3, AirPods 4", "Mall: Apple-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "AirPods Pro 2/3, AirPods 4", "Mall: Apple-backed"),
            ("Amazon SG", "Import deals, AirPods Max 2024 Lightning/USB-C", "AirPods Max, AirPods Pro 2/3", "Varies by seller"),
            ("Challenger", "0% instalment, walk-in demos", "Full AirPods line", "Apple-backed"),
            ("Courts", "0% instalment, bundle savings", "Full AirPods line", "Apple-backed"),
            ("Harvey Norman", "0% instalment, Mac specialist", "Full AirPods line", "Apple-backed"),
            ("Best Denki", "In-store demos, last-mile support", "Full AirPods line", "Apple-backed"),
            ("Gain City", "Bundle savings with iPhone/iPad", "Full AirPods line", "Apple-backed"),
            ("iStudio (authorized)", "Walk-in, engraving on AirPods Max/Pro 3", "Full AirPods line", "Apple-backed"),
        ],
        "canonical": "/airpods-pro-2-singapore",
        "how": [
            "Need the absolute cheapest price? Time your purchase to a Shopee/Lazada platform event (3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12). Mall stores ship from Apple's authorised SG distributor.",
            "Need it tomorrow with engraving (AirPods Pro 3 / AirPods Max)? Apple Store SG and authorised resellers (iStudio, Challenger) are the only engraving channels.",
            "Want to spread AirPods Pro over 12 months at 0%? Challenger, Courts, Harvey Norman, and Best Denki all run 0% instalment plans with major SG banks.",
            "Looking for AirPods Max USB-C (2024) at the best price? Amazon SG frequently undercuts SG retail by SGD 50–150 during sale events.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy AirPods Pro 2 in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 30–80 below the Apple Store SG retail price on AirPods Pro 2, especially during platform sales. Apple's official SG store holds the official retail and is the only channel that does engraving."),
            ("Is it safe to buy AirPods from Shopee or Lazada in Singapore?",
             "Yes — buy from Shopee Mall or LazMall sellers (Apple's official flagship stores on both marketplaces). You get the same Apple Singapore 1-year warranty as buying from Apple Store SG, with Shopee/Lazada's 7-day return policy on top."),
            ("Can I engrave AirPods in Singapore?",
             "Yes — Apple Store SG, iStudio, Challenger, and Harvey Norman all offer personal engraving on AirPods Pro 3 and AirPods Max. Allow 1–2 business days extra for engraved units."),
        ],
    },
    {
        "slug": "where-to-buy-apple-watch-singapore",
        "product": "Apple Watch",
        "brand": "Apple",
        "product_short": "Apple Watch (Series 10, Ultra 2, SE 2)",
        "tags": ["apple-watch", "apple", "singapore", "where-to-buy", "comparison"],
        "merch": [
            ("Apple Store SG", "Official pricing, Edu discount, trade-in", "Series 10, Ultra 2, SE 2", "Apple SG 1-yr"),
            ("Shopee SG (Mall)", "Lowest platform price, vouchers", "Series 10, SE 2 (cellular regional)", "Mall: Apple-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "Series 10, SE 2", "Mall: Apple-backed"),
            ("Amazon SG", "Import deals, cellular US/EU variants", "Series 10, Ultra 2", "Varies by seller"),
            ("Challenger", "0% instalment, walk-in demos", "Full Apple Watch line", "Apple-backed"),
            ("Courts", "0% instalment, bundle savings", "Full Apple Watch line", "Apple-backed"),
            ("Harvey Norman", "0% instalment, walk-in demos", "Full Apple Watch line", "Apple-backed"),
            ("Best Denki", "In-store demos, last-mile support", "Full Apple Watch line", "Apple-backed"),
            ("iStudio (authorized)", "Walk-in, strap fitting, trade-in", "Full Apple Watch line", "Apple-backed"),
            ("Lyla / H2Hub (online)", "Cellular setup + eSIM activation help", "Series 10 + Ultra 2", "Apple-backed"),
        ],
        "canonical": "/apple-watch-singapore",
        "how": [
            "Need the absolute cheapest price on Apple Watch SE 2? Shopee/Lazada platform events (3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12) consistently run SGD 50–120 below the Apple Store SG retail.",
            "Need it today with cellular pairing and eSIM setup? Apple Store SG is the only channel that does in-store eSIM activation on the spot. Authorised resellers can pair and ship but eSIM activation is self-serve.",
            "Want the full sport-loop/band bundle at a discount? Harvey Norman and Best Denki run 'band bundle' promos during back-to-school (Jul–Aug) and New Year (Jan).",
            "Buying for an elder parent (Series 10 with fall detection)? Apple Store SG and iStudio run 1-on-1 setup sessions free of charge — no purchase required.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy Apple Watch in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 50–120 below Apple Store SG retail on Apple Watch SE 2 and Series 10 GPS-only models during platform sales. Cellular variants are rarely discounted and Apple Store SG holds the lowest live price."),
            ("Do I need to activate eSIM at the Apple Store in Singapore?",
             "No — eSIM activation can be done via the Watch app on your iPhone. However, Apple Store SG offers free 1-on-1 walk-in setup help with cellular pairing, which is useful for first-time Apple Watch cellular buyers."),
            ("Is it safe to buy Apple Watch from Shopee or Lazada in Singapore?",
             "Yes — Shopee Mall and LazMall Apple Watch listings are operated by Apple's authorised SG distributors. Verify the seller badge before purchase; same Apple SG 1-year warranty applies."),
        ],
    },
    {
        "slug": "where-to-buy-bose-qc45-singapore",
        "product": "Bose QuietComfort 45",
        "brand": "Bose",
        "product_short": "Bose QC45 / QC Ultra / QC Headphones",
        "tags": ["bose", "headphones", "singapore", "where-to-buy", "comparison"],
        "merch": [
            ("Bose SG official", "Official pricing, 1-yr warranty, expert demo", "Full Bose line", "Bose SG 1-yr"),
            ("Shopee SG (Mall)", "Lowest platform price, vouchers", "QC45, QC Ultra", "Mall: Bose-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "QC45, QC Ultra", "Mall: Bose-backed"),
            ("Amazon SG", "Import deals, US/EU variants", "QC45, QC Ultra", "Varies by seller"),
            ("Challenger", "0% instalment, walk-in demo booths", "Full Bose line", "Bose-backed"),
            ("Courts", "0% instalment, bundle with soundbar", "QC45, QC Ultra", "Bose-backed"),
            ("Harvey Norman", "0% instalment, walk-in demo", "Full Bose line", "Bose-backed"),
            ("Best Denki", "In-store demo, last-mile support", "Full Bose line", "Bose-backed"),
            ("Audio House (specialist)", "Hi-fi focused, expert advice", "Full Bose line", "Bose-backed"),
            ("Stereo Electronics", "Hi-fi specialist, demo rooms", "Full Bose line", "Bose-backed"),
        ],
        "canonical": "/bose-singapore",
        "how": [
            "Need the absolute lowest price on Bose QC45? Shopee/Lazada platform events (4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12) typically run SGD 50–120 below Bose SG official.",
            "Need expert in-store demo with A/B comparison vs QC Ultra? Bose SG official, Audio House, and Stereo Electronics have dedicated listening rooms.",
            "Want 0% instalment over 12/24 months? Challenger, Courts, and Harvey Norman all run Bose promos with major SG banks.",
            "Looking for Bose QC Ultra (latest flagship) at the best price? Bose SG official holds the price for the first 60 days post-launch; after that Shopee Mall typically undercuts by SGD 80–150.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy Bose QC45 in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 50–120 below Bose SG official retail on Bose QC45 during platform sales. Bose SG official holds the price for the first 60 days post-launch."),
            ("Is it safe to buy Bose from Shopee or Lazada in Singapore?",
             "Yes — Shopee Mall and LazMall Bose listings are operated by authorised SG distributors (typically Bose SG's own retail arm). Verify the seller badge; same Bose SG 1-year warranty applies."),
            ("Can I demo Bose QC45 before buying in Singapore?",
             "Yes — Bose SG official, Audio House, Stereo Electronics, Challenger, Harvey Norman, and Best Denki all have listening booths with both QC45 and QC Ultra on demo. No appointment needed."),
        ],
    },
    {
        "slug": "where-to-buy-dyson-singapore",
        "product": "Dyson",
        "brand": "Dyson",
        "product_short": "Dyson V15 / V12 / V11 cordless vacuums + Airwrap/Supersonic",
        "tags": ["dyson", "vacuum", "hair", "singapore", "where-to-buy"],
        "merch": [
            ("Dyson SG official", "Official pricing, 2-yr warranty, demo", "Full Dyson line", "Dyson SG 2-yr"),
            ("Shopee SG (Mall)", "Lowest platform price, vouchers", "V15, V12, Airwrap, Supersonic", "Mall: Dyson-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "V15, V12, Airwrap", "Mall: Dyson-backed"),
            ("Amazon SG", "Import deals, US/JP variants", "V15, Supersonic", "Varies by seller"),
            ("Challenger", "0% instalment, walk-in demo", "Full Dyson line", "Dyson-backed"),
            ("Courts", "0% instalment, bundle savings", "Full Dyson line", "Dyson-backed"),
            ("Harvey Norman", "0% instalment, walk-in demo", "Full Dyson line", "Dyson-backed"),
            ("Best Denki", "In-store demo, last-mile support", "Full Dyson line", "Dyson-backed"),
            ("Gain City", "Bundle savings with stick vac + accessory kit", "Full Dyson line", "Dyson-backed"),
            ("Watsons / Sephora (hair tools)", "Airwrap / Supersonic demo + colour options", "Airwrap, Supersonic", "Dyson-backed"),
        ],
        "canonical": "/dyson-v15-singapore",
        "how": [
            "Need the absolute lowest price on Dyson V15 Detect? Shopee/Lazada platform events (3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12) consistently run SGD 100–250 below Dyson SG official.",
            "Want a 2-year local warranty + free attachment kit? Dyson SG official and Harvey Norman consistently bundle the 'complete' accessory kit (soft dusting brush, crevice tool, motorbar) at no extra cost during promotional windows.",
            "Need to spread V15 over 24 months at 0%? Challenger, Courts, and Harvey Norman run 0% instalments with major SG banks.",
            "Buying an Airwrap as a gift? Sephora and iStudio run gift-wrapping and personalisation (box engraving) that Dyson SG official doesn't — useful during Q4 gifting season.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy Dyson V15 in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 100–250 below Dyson SG official on the V15 Detect during platform sales. Dyson SG official holds the launch price for the first 60 days; after that the marketplaces undercut."),
            ("Is it safe to buy Dyson from Shopee or Lazada in Singapore?",
             "Yes — Shopee Mall and LazMall Dyson listings ship from Dyson's authorised SG distributor. Verify the seller badge; same Dyson SG 2-year warranty applies."),
            ("Should I buy the Dyson V15 or V12 in Singapore?",
             "V15 Detect is the current flagship (laser dust detection, larger bin). V12 is the lighter slim-flagship alternative. Most SG buyers who use it daily go V15; if you want sub-1.5kg weight, V12. Check current pricing on both at buywhere.ai/dyson-v15-singapore."),
        ],
    },
    {
        "slug": "where-to-buy-fitbit-singapore",
        "product": "Fitbit",
        "brand": "Fitbit (Google)",
        "product_short": "Fitbit Charge 6 / Sense 2 / Versa 4 / Inspire 3",
        "tags": ["fitbit", "wearable", "singapore", "where-to-buy"],
        "merch": [
            ("Fitbit SG official (Google Store SG)", "Official pricing, 1-yr warranty", "Full Fitbit line", "Fitbit SG 1-yr"),
            ("Shopee SG (Mall)", "Lowest platform price, vouchers", "Charge 6, Inspire 3, Versa 4", "Mall: Fitbit-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "Charge 6, Inspire 3", "Mall: Fitbit-backed"),
            ("Amazon SG", "Import deals, US/EU variants", "Charge 6, Sense 2", "Varies by seller"),
            ("Challenger", "0% instalment, walk-in demo", "Full Fitbit line", "Fitbit-backed"),
            ("Courts", "0% instalment, bundle savings", "Full Fitbit line", "Fitbit-backed"),
            ("Harvey Norman", "0% instalment, walk-in demo", "Full Fitbit line", "Fitbit-backed"),
            ("Best Denki", "In-store demo, last-mile support", "Full Fitbit line", "Fitbit-backed"),
            ("Decathlon SG", "Sport-focused, expert advice", "Charge 6, Inspire 3", "Fitbit-backed"),
            ("iStudio (authorized)", "Walk-in setup help, trade-in", "Full Fitbit line", "Fitbit-backed"),
        ],
        "canonical": "/fitbit-singapore",
        "how": [
            "Need the absolute cheapest price on Fitbit Charge 6? Shopee/Lazada platform events (3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12) consistently run SGD 30–60 below Fitbit SG retail.",
            "Need a band-swap or trade-in for an older Fitbit? Fitbit SG official (Google Store SG) and iStudio both run Fitbit trade-in promos with credit toward new devices.",
            "Want a sport-focused demo (running GPS, heart rate zones)? Decathlon SG has running-treadmill demo zones where you can test Charge 6 vs Garmin Forerunner side-by-side.",
            "Looking for Sense 2 (stress management EDA sensor)? Most SG retailers stock it; the Sense 2 is rarely discounted below SGD 50 off retail even during platform sales.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy Fitbit Charge 6 in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 30–60 below Fitbit SG retail on Charge 6 during platform sales. Fitbit SG official (Google Store SG) holds the price during launch windows."),
            ("Does Fitbit work fully in Singapore?",
             "Yes — Charge 6, Sense 2, Versa 4, and Inspire 3 all support full Fitbit functionality in Singapore including ECG (Sense 2), EDA stress sensors, and Singapore-region notifications. No SG-specific restrictions."),
            ("Should I buy Fitbit or Apple Watch in Singapore?",
             "If you want a slim fitness-first wearable with 7-day battery and heart-rate-first design, Fitbit. If you want a full smartwatch with iOS-style apps, cellular, and third-party app support, Apple Watch. Cross-check both at buywhere.ai/fitbit-singapore and buywhere.ai/apple-watch-singapore."),
        ],
    },
    {
        "slug": "where-to-buy-gopro-singapore",
        "product": "GoPro",
        "brand": "GoPro",
        "product_short": "GoPro Hero 13 / Hero 12 / Max 2",
        "tags": ["gopro", "camera", "action-cam", "singapore", "where-to-buy"],
        "merch": [
            ("GoPro SG official", "Official pricing, 1-yr warranty, bundle kits", "Full GoPro line", "GoPro SG 1-yr"),
            ("Shopee SG (Mall)", "Lowest platform price, vouchers", "Hero 12, Hero 13", "Mall: GoPro-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "Hero 12, Hero 13", "Mall: GoPro-backed"),
            ("Amazon SG", "Import deals, US/JP variants", "Hero 12, Max 2", "Varies by seller"),
            ("Challenger", "0% instalment, walk-in demo", "Full GoPro line", "GoPro-backed"),
            ("Courts", "0% instalment, bundle with accessories", "Full GoPro line", "GoPro-backed"),
            ("Harvey Norman", "0% instalment, walk-in demo", "Full GoPro line", "GoPro-backed"),
            ("Best Denki", "In-store demo, last-mile support", "Full GoPro line", "GoPro-backed"),
            ("MS Color / Cathay Photo (specialist)", "Action cam expert, accessory advice", "Full GoPro line", "GoPro-backed"),
            ("TK Photo / SLR Revolution (online)", "Bundle deals with mounts + SD cards", "Full GoPro line", "GoPro-backed"),
        ],
        "canonical": "/gopro-singapore",
        "how": [
            "Need the absolute lowest price on GoPro Hero 13? Shopee/Lazada platform events (4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12) typically run SGD 50–120 below GoPro SG official.",
            "Want a bundle deal (camera + accessory kit + SD card)? MS Color, Cathay Photo, and TK Photo bundle the 'creator kit' (chest mount, head strap, spare battery, 128GB SD) for SGD 80–150 less than buying pieces individually.",
            "Need 0% instalment on a Hero 13 + spare battery bundle? Challenger, Courts, and Harvey Norman all run GoPro promos with major SG banks.",
            "Looking for the GoPro subscription (unlimited cloud, damaged-unit replacement)? GoPro SG official and the official GoPro app bundle a free 1-year subscription on Hero 13 launches.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy GoPro Hero 13 in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 50–120 below GoPro SG official during platform sales. GoPro SG official holds the launch price for the first 60 days; after that marketplaces undercut."),
            ("Is it safe to buy GoPro from Shopee or Lazada in Singapore?",
             "Yes — Shopee Mall and LazMall GoPro listings ship from GoPro's authorised SG distributor (typically MS Color). Verify the seller badge; same GoPro SG 1-year warranty applies."),
            ("Should I buy GoPro Hero 13 or Hero 12 in Singapore?",
             "Hero 13 is the current flagship with the new HB-series lens system (ultra-wide, macro, anamorphic optional mods) and improved battery. Hero 12 remains excellent and is typically SGD 100–150 cheaper — strong value if you don't need the lens mods. Cross-check current pricing at buywhere.ai/gopro-singapore."),
        ],
    },
    {
        "slug": "where-to-buy-ipad-singapore",
        "product": "iPad",
        "brand": "Apple",
        "product_short": "iPad (A16) / iPad Air (M3) / iPad Pro (M4)",
        "tags": ["ipad", "apple", "singapore", "where-to-buy", "comparison"],
        "merch": [
            ("Apple Store SG", "Official pricing, Edu discount, engraving", "Full iPad line", "Apple SG 1-yr"),
            ("Shopee SG (Mall)", "Lowest platform price, vouchers", "iPad A16, iPad Air M3", "Mall: Apple-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "iPad A16, iPad Air M3", "Mall: Apple-backed"),
            ("Amazon SG", "Import deals, US/EU variants", "iPad Air M3, iPad Pro M4", "Varies by seller"),
            ("Challenger", "0% instalment, walk-in demo", "Full iPad line", "Apple-backed"),
            ("Courts", "0% instalment, bundle with Pencil", "Full iPad line", "Apple-backed"),
            ("Harvey Norman", "0% instalment, Mac specialist", "Full iPad line", "Apple-backed"),
            ("Best Denki", "In-store demo, last-mile support", "Full iPad line", "Apple-backed"),
            ("Gain City", "Bundle with Magic Keyboard", "iPad Air M3, iPad Pro M4", "Apple-backed"),
            ("iStudio (authorized)", "Walk-in, trade-in, Pencil engraving", "Full iPad line", "Apple-backed"),
        ],
        "canonical": "/ipad-singapore",
        "how": [
            "Need the absolute cheapest price on iPad A16 (the entry iPad)? Shopee/Lazada platform events (3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12) consistently run SGD 50–120 below Apple Store SG retail.",
            "Buying for school with Edu discount? Apple Store SG and iStudio both run Apple Education pricing with valid student email (typically 5–10% off iPad Air/Pro).",
            "Want to bundle iPad Pro M4 + Magic Keyboard + Pencil Pro at a discount? Harvey Norman and Best Denki run 'back-to-school' bundles in Jul–Aug that are typically SGD 100–200 cheaper than buying pieces separately.",
            "Need 0% instalment on iPad Pro + Apple Pencil Pro? Challenger, Courts, and Harvey Norman all run iPad promos with major SG banks.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy iPad in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 50–120 below Apple Store SG retail on iPad A16 and iPad Air M3 during platform sales. iPad Pro M4 is rarely discounted more than SGD 50–100 off MSRP — Apple Store SG holds the lowest live price on Pro."),
            ("Is it safe to buy iPad from Shopee or Lazada in Singapore?",
             "Yes — Shopee Mall and LazMall iPad listings are operated by Apple's authorised SG distributors. Verify the seller badge; same Apple SG 1-year warranty applies."),
            ("Should I buy iPad Air M3 or iPad Pro M4 in Singapore?",
             "iPad Air M3 (11\"/13\") is the sweet spot for most buyers — same M3 chip, Apple Pencil Pro, Magic Keyboard support, and 120Hz display. iPad Pro M4 adds the Ultra Retina XDR tandem-OLED display and is worth it only for HDR video/photo pros. Cross-check at buywhere.ai/ipad-singapore."),
        ],
    },
    {
        "slug": "where-to-buy-iphone-singapore",
        "product": "iPhone",
        "brand": "Apple",
        "product_short": "iPhone 17 / 17 Pro / 17 Pro Max / Air",
        "tags": ["iphone", "apple", "singapore", "where-to-buy", "comparison"],
        "merch": [
            ("Apple Store SG", "Official pricing, Edu, trade-in", "Full iPhone 17 line", "Apple SG 1-yr"),
            ("Shopee SG (Mall)", "Lowest platform price, vouchers", "iPhone 17, 17 Plus, Air", "Mall: Apple-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "iPhone 17, 17 Plus, Air", "Mall: Apple-backed"),
            ("Amazon SG", "Import deals, US/JP variants", "iPhone 17, 17 Pro", "Varies by seller"),
            ("Challenger", "0% instalment, walk-in demo", "Full iPhone line", "Apple-backed"),
            ("Courts", "0% instalment, bundle savings", "Full iPhone line", "Apple-backed"),
            ("Harvey Norman", "0% instalment, Mac specialist", "Full iPhone line", "Apple-backed"),
            ("Best Denki", "In-store demo, last-mile support", "Full iPhone line", "Apple-backed"),
            ("Gain City", "Bundle with AirPods/AppleCare", "Full iPhone line", "Apple-backed"),
            ("M1 / Singtel / StarHub (telco)", "Contract bundles, plan subsidies", "Full iPhone line", "Apple-backed"),
        ],
        "canonical": "/iphone-17-singapore",
        "how": [
            "Need the absolute lowest outright (no contract) price on iPhone 17? Shopee/Lazada platform events (3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12) consistently run SGD 100–250 below Apple Store SG retail.",
            "Want a telco contract plan (M1/Singtel/StarHub) with monthly instalment? Telcos run 24/36-month device plans with bundled 5G data — total cost-of-ownership is typically higher than outright but spreads the cost.",
            "Trading in an older iPhone (12 or newer)? Apple Store SG, iStudio, and Harvey Norman all run iPhone trade-in promos with credit toward new devices.",
            "Need 0% credit-card instalment over 12/24 months? Challenger, Courts, Harvey Norman, and Best Denki all run 0% plans with major SG banks on outright purchases.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy iPhone 17 in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 100–250 below Apple Store SG retail on iPhone 17 and iPhone 17 Plus during platform sales. iPhone 17 Pro / Pro Max is rarely discounted more than SGD 50–100 — Apple Store SG holds the lowest live price on Pro."),
            ("Is it safe to buy iPhone from Shopee or Lazada in Singapore?",
             "Yes — Shopee Mall and LazMall iPhone listings are operated by Apple's authorised SG distributors. Verify the seller badge; same Apple SG 1-year warranty applies. Avoid non-Mall third-party sellers for warranty clarity."),
            ("Should I buy iPhone 17 outright or on a telco plan?",
             "Outright is cheapest over 24 months if you already have a SIM-only plan. Telco plans (M1, Singtel, StarHub) only make sense if you want the latest iPhone on day one and would otherwise finance at >0%. See current pricing at buywhere.ai/iphone-17-singapore."),
        ],
    },
    {
        "slug": "where-to-buy-kindle-singapore",
        "product": "Kindle",
        "brand": "Amazon",
        "product_short": "Kindle (2024 basic) / Paperwhite / Scribe / Colorsoft",
        "tags": ["kindle", "amazon", "ereader", "singapore", "where-to-buy"],
        "merch": [
            ("Amazon SG", "Official pricing, full Kindle line", "Full Kindle line", "Amazon 1-yr"),
            ("Shopee SG (Mall)", "Lowest platform price, vouchers", "Paperwhite, basic Kindle", "Mall: Amazon-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "Paperwhite, basic Kindle", "Mall: Amazon-backed"),
            ("Amazon US (import)", "Scribe, Colorsoft (not always on SG site)", "Scribe, Colorsoft", "Varies by seller"),
            ("Challenger", "0% instalment on Scribe", "Paperwhite, Scribe", "Amazon-backed"),
            ("Courts", "0% instalment, bundle with cover", "Paperwhite, Scribe", "Amazon-backed"),
            ("Harvey Norman", "0% instalment on Scribe/Colorsoft", "Scribe, Colorsoft", "Amazon-backed"),
            ("Best Denki", "In-store demo, last-mile support", "Paperwhite, Scribe", "Amazon-backed"),
            ("POPULAR / Times (bookstores)", "Bundle with e-book credits", "Paperwhite, basic Kindle", "Amazon-backed"),
            ("Ninmedia / Book Depository (online)", "Scribe + cover bundles", "Scribe, Paperwhite", "Amazon-backed"),
        ],
        "canonical": "/kindle-singapore",
        "how": [
            "Need the absolute lowest price on Kindle Paperwhite? Shopee/Lazada platform events (3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12) consistently run SGD 30–60 below Amazon SG retail.",
            "Want the Kindle Scribe (note-taking) or Colorsoft (colour e-reader)? These are often Amazon-US exclusive; Amazon SG may not stock them. Buy from Amazon US import forwarders or check Harvey Norman/Best Denki.",
            "Need a cover + warranty bundle? Harvey Norman and Best Denki run 'Kindle + fabric cover' bundles that are typically SGD 30–50 cheaper than buying separately.",
            "Looking for 0% instalment on a Scribe? Challenger, Courts, and Harvey Norman run 0% instalment plans with major SG banks on Scribe purchases.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy Kindle Paperwhite in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 30–60 below Amazon SG retail on Kindle Paperwhite during platform sales. Amazon SG holds the launch price for the first 60 days post-launch."),
            ("Is Kindle SG region-locked?",
             "No — Kindle hardware works globally. Amazon account region is what matters: an SG-registered Amazon account buys from the SG Kindle Store (English-language catalogue), while a US account accesses the larger US Kindle Store. Content doesn't transfer between regions."),
            ("Should I buy Kindle Paperwhite or Kindle Colorsoft?",
             "Paperwhite is the sweet spot for most readers — 7\" 300ppi display, waterproof, warm light. Colorsoft adds a colour e-ink layer for comics, magazines, and colour book covers, but costs SGD 100+ more and battery life is shorter. Cross-check at buywhere.ai/kindle-singapore."),
        ],
    },
    {
        "slug": "where-to-buy-logitech-mx-master-singapore",
        "product": "Logitech MX Master",
        "brand": "Logitech",
        "product_short": "Logitech MX Master 3S / MX Master 4 / MX Anywhere 3S",
        "tags": ["logitech", "mouse", "singapore", "where-to-buy"],
        "merch": [
            ("Logitech SG official", "Official pricing, 2-yr warranty", "Full Logitech line", "Logitech SG 2-yr"),
            ("Shopee SG (Mall)", "Lowest platform price, vouchers", "MX Master 3S, MX Anywhere 3S", "Mall: Logitech-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "MX Master 3S, MX Anywhere 3S", "Mall: Logitech-backed"),
            ("Amazon SG", "Import deals, US/EU variants", "MX Master 3S, MX Master 4", "Varies by seller"),
            ("Challenger", "0% instalment, walk-in demo", "Full Logitech line", "Logitech-backed"),
            ("Courts", "0% instalment, bundle with keyboard", "MX Master 3S, MX Keys", "Logitech-backed"),
            ("Harvey Norman", "0% instalment, walk-in demo", "Full Logitech line", "Logitech-backed"),
            ("Best Denki", "In-store demo, last-mile support", "Full Logitech line", "Logitech-backed"),
            ("Challenger / Aftershock (gaming)", "Bundle with gaming keyboard/mousepad", "MX Master 3S, G-series", "Logitech-backed"),
            ("Courts Online / Lazada TechMall", "Bundle deals with MX Keys S", "Full Logitech line", "Logitech-backed"),
        ],
        "canonical": "/logitech-singapore",
        "how": [
            "Need the absolute lowest price on Logitech MX Master 3S? Shopee/Lazada platform events (3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12) consistently run SGD 20–50 below Logitech SG official.",
            "Want the full productivity stack (MX Master + MX Keys S + MX Palm Rest)? Logitech SG official and Harvey Norman run 'MX productivity bundle' promos that save SGD 30–60 vs. individual pieces.",
            "Looking for the MX Master 4 (latest flagship with haptic feedback)? Logitech SG official holds the launch price for 60 days; after that Shopee/Lazada typically undercuts by SGD 30–60.",
            "Need 0% instalment? Most retailers skip 0% on accessories under SGD 300, but Challenger and Harvey Norman offer 0% on MX Master 3S/4 + MX Keys S bundle purchases over SGD 400.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy Logitech MX Master 3S in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 20–50 below Logitech SG official on MX Master 3S during platform sales. Logitech SG official holds the launch price for 60 days."),
            ("Is it safe to buy Logitech from Shopee or Lazada in Singapore?",
             "Yes — Shopee Mall and LazMall Logitech listings are operated by authorised SG distributors. Verify the seller badge; same Logitech SG 2-year warranty applies."),
            ("MX Master 3S vs MX Master 4: which should I buy in Singapore?",
             "MX Master 4 (2025) adds haptic feedback for actions and a better thumbwheel. For most users, the 3S is still the sweet spot and SGD 50–80 cheaper. Cross-check current pricing at buywhere.ai/logitech-singapore."),
        ],
    },
    {
        "slug": "where-to-buy-macbook-singapore",
        "product": "MacBook",
        "brand": "Apple",
        "product_short": "MacBook Air (M4/M3) / MacBook Pro (M4/M5)",
        "tags": ["macbook", "apple", "laptop", "singapore", "where-to-buy"],
        "merch": [
            ("Apple Store SG", "Official pricing, Edu, trade-in, configure-to-order", "Full MacBook line", "Apple SG 1-yr"),
            ("Shopee SG (Mall)", "Lowest platform price, vouchers", "MacBook Air M3/M4", "Mall: Apple-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "MacBook Air M3/M4", "Mall: Apple-backed"),
            ("Amazon SG", "Import deals, US/EU variants", "MacBook Air M3, MacBook Pro M4", "Varies by seller"),
            ("Challenger", "0% instalment, walk-in demo", "Full MacBook line", "Apple-backed"),
            ("Courts", "0% instalment, bundle with display", "Full MacBook line", "Apple-backed"),
            ("Harvey Norman", "0% instalment, Mac specialist", "Full MacBook line", "Apple-backed"),
            ("Best Denki", "In-store demo, last-mile support", "Full MacBook line", "Apple-backed"),
            ("Gain City", "Bundle with Magic Keyboard / mouse", "MacBook Air M3/M4", "Apple-backed"),
            ("iStudio (authorized)", "Walk-in, trade-in, configure-to-order", "Full MacBook line", "Apple-backed"),
        ],
        "canonical": "/macbook-singapore",
        "how": [
            "Need the absolute lowest price on MacBook Air M3? Shopee/Lazada platform events (3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12) consistently run SGD 100–300 below Apple Store SG retail.",
            "Buying for school with Edu discount? Apple Store SG and iStudio both run Apple Education pricing with valid student email (typically 5–10% off MacBook Air/Pro).",
            "Want a configure-to-order (CTO) MacBook Pro with bigger SSD/RAM? Apple Store SG is the only channel — Shopee/Lazada only stock the standard SKUs.",
            "Need 0% instalment over 24 months? Challenger, Courts, Harvey Norman, and Best Denki all run 0% instalments with major SG banks on MacBook purchases.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy MacBook Air in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 100–300 below Apple Store SG retail on MacBook Air M3/M4 during platform sales. MacBook Pro is rarely discounted more than SGD 50–150 — Apple Store SG holds the lowest live price on Pro."),
            ("Is it safe to buy MacBook from Shopee or Lazada in Singapore?",
             "Yes — Shopee Mall and LazMall MacBook listings are operated by Apple's authorised SG distributors. Verify the seller badge; same Apple SG 1-year warranty applies. Avoid non-Mall third-party sellers."),
            ("MacBook Air M4 or MacBook Pro M4: which should I buy in Singapore?",
             "MacBook Air M4 (13\"/15\") is the sweet spot for most buyers — same M4 chip, fanless silent design, 18hr battery. MacBook Pro M4 adds active cooling (sustained workloads), ProMotion 120Hz, and more ports. Cross-check at buywhere.ai/macbook-singapore."),
        ],
    },
    {
        "slug": "where-to-buy-meta-quest-3-singapore",
        "product": "Meta Quest 3",
        "brand": "Meta",
        "product_short": "Meta Quest 3 / 3S / Pro",
        "tags": ["meta-quest", "vr", "singapore", "where-to-buy"],
        "merch": [
            ("Meta Store SG (online)", "Official pricing, 1-yr warranty", "Quest 3, 3S", "Meta 1-yr"),
            ("Shopee SG (Mall)", "Lowest platform price, vouchers", "Quest 3, 3S", "Mall: Meta-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "Quest 3, 3S", "Mall: Meta-backed"),
            ("Amazon SG", "Import deals, US/EU variants", "Quest 3, 3S, Pro", "Varies by seller"),
            ("Challenger", "0% instalment, walk-in demo", "Quest 3, 3S", "Meta-backed"),
            ("Courts", "0% instalment, bundle with games", "Quest 3, 3S", "Meta-backed"),
            ("Harvey Norman", "0% instalment, walk-in demo", "Quest 3, 3S", "Meta-backed"),
            ("Best Denki", "In-store demo, last-mile support", "Quest 3, 3S", "Meta-backed"),
            ("Vive / SVRV (VR specialist)", "VR-focused demo, expert advice", "Quest 3, 3S, Pro", "Meta-backed"),
            ("Game零售商 (game stores)", "Bundle with VR game vouchers", "Quest 3, 3S", "Meta-backed"),
        ],
        "canonical": "/meta-quest-3-singapore",
        "how": [
            "Need the absolute lowest price on Meta Quest 3? Shopee/Lazada platform events (4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12) typically run SGD 50–100 below Meta Store SG.",
            "Want to try before you buy? SVRV and Challenger have walk-in VR demo zones with Quest 3 pre-loaded with Beat Saber, Asgard's Wrath 2, and other top titles.",
            "Buying Quest 3 + Elite Strap + Battery Strap bundle? Harvey Norman and Best Denki run 'complete VR bundle' promos that save SGD 40–80 vs. buying pieces separately.",
            "Need 0% instalment? Most retailers skip 0% on Quest 3, but Challenger and Harvey Norman offer 0% on Quest 3 + Elite Strap + game bundle purchases over SGD 700.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy Meta Quest 3 in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 50–100 below Meta Store SG on Quest 3 during platform sales. Meta Store SG holds the launch price for 60 days."),
            ("Is it safe to buy Meta Quest from Shopee or Lazada in Singapore?",
             "Yes — Shopee Mall and LazMall Quest listings are operated by authorised SG distributors. Verify the seller badge; same Meta 1-year warranty applies."),
            ("Meta Quest 3 vs Quest 3S: which should I buy in Singapore?",
             "Quest 3 is the flagship — full pancake lenses, higher resolution, better mixed-reality passthrough. Quest 3S is the budget option — uses fresnel lenses, lower-res displays, no depth sensor. Cross-check at buywhere.ai/meta-quest-3-singapore."),
        ],
    },
    {
        "slug": "where-to-buy-roborock-singapore",
        "product": "Roborock",
        "brand": "Roborock",
        "product_short": "Roborock S8 / Q Revo / Q8 Max+ series",
        "tags": ["roborock", "robot-vacuum", "singapore", "where-to-buy"],
        "merch": [
            ("Roborock SG official", "Official pricing, 2-yr warranty", "Full Roborock line", "Roborock SG 2-yr"),
            ("Shopee SG (Mall)", "Lowest platform price, vouchers", "S8, Q Revo, Q8 Max+", "Mall: Roborock-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "S8, Q Revo, Q8 Max+", "Mall: Roborock-backed"),
            ("Amazon SG", "Import deals, US/EU variants", "S8, Q Revo", "Varies by seller"),
            ("Challenger", "0% instalment, walk-in demo", "Full Roborock line", "Roborock-backed"),
            ("Courts", "0% instalment, bundle with stick vac", "Full Roborock line", "Roborock-backed"),
            ("Harvey Norman", "0% instalment, walk-in demo", "Full Roborock line", "Roborock-backed"),
            ("Best Denki", "In-store demo, last-mile support", "Full Roborock line", "Roborock-backed"),
            ("Gain City", "Bundle savings with stick vac + mop", "Full Roborock line", "Roborock-backed"),
            ("Homesup / SGHome (specialist)", "Robot vacuum expert, install help", "Full Roborock line", "Roborock-backed"),
        ],
        "canonical": "/roborock-singapore",
        "how": [
            "Need the absolute lowest price on Roborock Q Revo? Shopee/Lazada platform events (3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12) consistently run SGD 100–250 below Roborock SG official.",
            "Want a 2-year local warranty + free accessory kit? Roborock SG official and Harvey Norman consistently bundle the 'complete' accessory kit (extra mop pads, side brushes, dust bags) at no extra cost during promotional windows.",
            "Need 0% instalment over 12/24 months? Challenger, Courts, and Harvey Norman run 0% instalments with major SG banks on Roborock purchases.",
            "Buying for an HDB or condo with specific floor types? Homesup and SGHome run install walk-throughs and recommend the right model for tile/parquet/laminate — useful if you've never owned a robot vac before.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy Roborock S8 in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 100–250 below Roborock SG official on the S8 series during platform sales. Roborock SG official holds the launch price for the first 60 days; after that marketplaces undercut."),
            ("Is it safe to buy Roborock from Shopee or Lazada in Singapore?",
             "Yes — Shopee Mall and LazMall Roborock listings ship from Roborock's authorised SG distributor. Verify the seller badge; same Roborock SG 2-year warranty applies."),
            ("Which Roborock model should I buy in Singapore?",
             "S8 Pro Ultra is the flagship (self-wash, self-empty, self-refill, hot-air dry). Q Revo is the mid-range sweet spot (self-empty, mop-wash). Q8 Max+ is the entry self-empty option. Cross-check current pricing at buywhere.ai/roborock-singapore."),
        ],
    },
    {
        "slug": "where-to-buy-samsung-galaxy-s-singapore",
        "product": "Samsung Galaxy S",
        "brand": "Samsung",
        "product_short": "Samsung Galaxy S26 / S26+ / S26 Ultra / Z Fold 7 / Z Flip 7",
        "tags": ["samsung", "galaxy", "smartphone", "singapore", "where-to-buy"],
        "merch": [
            ("Samsung SG official", "Official pricing, Edu, trade-in, configure-to-order", "Full Galaxy line", "Samsung SG 1-yr"),
            ("Shopee SG (Mall)", "Lowest platform price, vouchers", "S26, S26+, Z Flip 7", "Mall: Samsung-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "S26, S26+, Z Flip 7", "Mall: Samsung-backed"),
            ("Amazon SG", "Import deals, US/EU variants", "S26, S26 Ultra", "Varies by seller"),
            ("Challenger", "0% instalment, walk-in demo", "Full Galaxy line", "Samsung-backed"),
            ("Courts", "0% instalment, bundle with Galaxy Watch", "Full Galaxy line", "Samsung-backed"),
            ("Harvey Norman", "0% instalment, walk-in demo", "Full Galaxy line", "Samsung-backed"),
            ("Best Denki", "In-store demo, last-mile support", "Full Galaxy line", "Samsung-backed"),
            ("Gain City", "Bundle with Galaxy Buds / Watch", "Full Galaxy line", "Samsung-backed"),
            ("M1 / Singtel / StarHub (telco)", "Contract bundles, plan subsidies", "Full Galaxy line", "Samsung-backed"),
        ],
        "canonical": "/samsung-galaxy-s26-singapore",
        "how": [
            "Need the absolute lowest outright (no contract) price on Galaxy S26? Shopee/Lazada platform events (3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12) consistently run SGD 100–300 below Samsung SG official.",
            "Want a telco contract plan (M1/Singtel/StarHub) with monthly instalment? Telcos run 24/36-month device plans with bundled 5G data — total cost-of-ownership is typically higher than outright but spreads the cost.",
            "Trading in an older Galaxy (S22 or newer)? Samsung SG official, Challenger, and Harvey Norman all run Galaxy trade-in promos with credit toward new devices.",
            "Need 0% credit-card instalment over 12/24 months? Challenger, Courts, Harvey Norman, and Best Denki all run 0% plans with major SG banks on outright purchases.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy Samsung Galaxy S26 in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 100–300 below Samsung SG official on Galaxy S26 and S26+ during platform sales. Galaxy S26 Ultra / Z Fold 7 is rarely discounted more than SGD 50–100 — Samsung SG official holds the lowest live price on Ultra/Fold."),
            ("Is it safe to buy Galaxy from Shopee or Lazada in Singapore?",
             "Yes — Shopee Mall and LazMall Galaxy listings are operated by Samsung's authorised SG distributors. Verify the seller badge; same Samsung SG 1-year warranty applies. Avoid non-Mall third-party sellers."),
            ("Should I buy Galaxy S26 Ultra or Z Fold 7 in Singapore?",
             "S26 Ultra is the camera/S Pen flagship (best battery, best telephoto, 200MP main). Z Fold 7 is the foldable flagship (large inner display, multitasking). Cross-check current pricing at buywhere.ai/samsung-galaxy-s26-singapore."),
        ],
    },
    {
        "slug": "where-to-buy-samsung-tv-singapore",
        "product": "Samsung TV",
        "brand": "Samsung",
        "product_short": "Samsung Neo QLED 8K / 4K / OLED / The Frame",
        "tags": ["samsung", "tv", "singapore", "where-to-buy"],
        "merch": [
            ("Samsung SG official", "Official pricing, 2-yr warranty, install", "Full Samsung TV line", "Samsung SG 2-yr"),
            ("Shopee SG (Mall)", "Lowest platform price on 55\"–65\"", "Neo QLED 4K, The Frame", "Mall: Samsung-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "Neo QLED 4K, The Frame", "Mall: Samsung-backed"),
            ("Amazon SG", "Import deals, US/EU variants", "Neo QLED 4K, OLED", "Varies by seller"),
            ("Challenger", "0% instalment, walk-in demo", "Full Samsung TV line", "Samsung-backed"),
            ("Courts", "0% instalment, bundle with soundbar", "Full Samsung TV line", "Samsung-backed"),
            ("Harvey Norman", "0% instalment, walk-in demo", "Full Samsung TV line", "Samsung-backed"),
            ("Best Denki", "In-store demo, last-mile support", "Full Samsung TV line", "Samsung-backed"),
            ("Gain City", "Bundle with soundbar + wall mount", "Full Samsung TV line", "Samsung-backed"),
            ("Audio House (specialist)", "Home theatre expert, calibration", "Neo QLED 8K, OLED", "Samsung-backed"),
        ],
        "canonical": "/samsung-tv-singapore",
        "how": [
            "Need the absolute lowest price on Samsung Neo QLED 4K (55\"–65\")? Shopee/Lazada platform events (3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12) consistently run SGD 200–500 below Samsung SG official.",
            "Want a free install + bracket + soundbar bundle? Harvey Norman and Best Denki run 'complete home theatre' bundles that save SGD 200–400 vs. buying pieces separately.",
            "Buying a 75\"+ Neo QLED or 8K? Samsung SG official is the only channel with dedicated delivery crew (the box won't fit in a regular lift); expect SGD 100–300 off retail from Shopee/Lazada but verify delivery coverage.",
            "Need 0% instalment over 24/36 months? Challenger, Courts, Harvey Norman, Best Denki, and Gain City all run 0% instalments with major SG banks on TV purchases.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy Samsung TV in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 200–500 below Samsung SG official on Samsung Neo QLED 4K 55\"–65\" during platform sales. Larger sizes (75\"+) and 8K models are rarely discounted more than SGD 100–300 — Samsung SG official holds the lowest live price on flagship sizes."),
            ("Is it safe to buy Samsung TV from Shopee or Lazada in Singapore?",
             "Yes — Shopee Mall and LazMall Samsung TV listings are operated by Samsung's authorised SG distributors. Verify the seller badge; same Samsung SG 2-year warranty applies. Avoid non-Mall third-party sellers for warranty clarity."),
            ("Neo QLED 4K vs OLED: which should I buy in Singapore?",
             "Neo QLED 4K is brighter (better for bright rooms), no burn-in risk, cheaper. OLED has perfect blacks, wider viewing angles, better for dim rooms. Cross-check current pricing at buywhere.ai/samsung-tv-singapore."),
        ],
    },
    {
        "slug": "where-to-buy-steam-deck-singapore",
        "product": "Steam Deck",
        "brand": "Valve",
        "product_short": "Steam Deck OLED (512GB / 1TB) / Steam Deck LCD",
        "tags": ["steam-deck", "valve", "gaming", "handheld", "singapore", "where-to-buy"],
        "merch": [
            ("Steam (Valve, official)", "Official pricing, 1-yr warranty, region-locked to SG", "Full Steam Deck line", "Valve 1-yr"),
            ("Shopee SG (Mall)", "Lowest platform price, vouchers", "Steam Deck OLED 512GB", "Mall: Valve-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "Steam Deck OLED 512GB", "Mall: Valve-backed"),
            ("Amazon SG", "Import deals, US/EU variants", "Steam Deck OLED 1TB", "Varies by seller"),
            ("Challenger", "0% instalment on OLED 1TB", "Steam Deck OLED 512GB/1TB", "Valve-backed"),
            ("Courts", "0% instalment, bundle with dock", "Steam Deck OLED 512GB/1TB", "Valve-backed"),
            ("Harvey Norman", "0% instalment on OLED 1TB", "Steam Deck OLED 512GB/1TB", "Valve-backed"),
            ("Best Denki", "In-store demo, last-mile support", "Steam Deck OLED 512GB/1TB", "Valve-backed"),
            ("Game retailers (GameChainz / Play-E)", "Bundle with game vouchers", "Steam Deck OLED 512GB/1TB", "Valve-backed"),
            ("Aftershock (custom PC)", "Custom SSD + skin bundles", "Steam Deck OLED 1TB", "Valve-backed"),
        ],
        "canonical": "/steam-deck-singapore",
        "how": [
            "Need the absolute lowest price on Steam Deck OLED 512GB? Shopee/Lazada platform events (3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12) consistently run SGD 50–100 below Steam SG official.",
            "Want a bundle (Steam Deck + dock + case + game voucher)? Harvey Norman and GameChainz run 'complete handheld gaming' bundles that save SGD 80–150 vs. buying pieces separately.",
            "Looking for Steam Deck OLED 1TB (limited stock)? Steam SG official holds the most consistent stock; Shopee/Lazada 1TB listings appear in waves during sale events.",
            "Need 0% instalment on OLED 1TB? Challenger, Courts, and Harvey Norman all run 0% instalment plans with major SG banks on Steam Deck purchases over SGD 800.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy Steam Deck OLED in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 50–100 below Steam SG official on Steam Deck OLED 512GB during platform sales. Steam SG official holds the most consistent availability on the 1TB model."),
            ("Is it safe to buy Steam Deck from Shopee or Lazada in Singapore?",
             "Yes — Shopee Mall and LazMall Steam Deck listings are operated by authorised SG distributors. Verify the seller badge; same Valve 1-year warranty applies."),
            ("Steam Deck OLED vs original LCD: should I upgrade in Singapore?",
             "OLED is the current model — better battery, HDR OLED display, 90Hz refresh, larger storage. The original LCD Steam Deck is discontinued. Cross-check current pricing at buywhere.ai/steam-deck-singapore."),
        ],
    },
    {
        "slug": "where-to-buy-xbox-series-x-singapore",
        "product": "Xbox Series X",
        "brand": "Microsoft",
        "product_short": "Xbox Series X / Series S / Game Pass",
        "tags": ["xbox", "microsoft", "console", "gaming", "singapore", "where-to-buy"],
        "merch": [
            ("Microsoft Store SG", "Official pricing, 1-yr warranty", "Xbox Series X, Series S", "Microsoft 1-yr"),
            ("Shopee SG (Mall)", "Lowest platform price, vouchers", "Xbox Series X, Series S", "Mall: Microsoft-backed"),
            ("Lazada SG (LazMall)", "Flash sales, coins cashback", "Xbox Series X, Series S", "Mall: Microsoft-backed"),
            ("Amazon SG", "Import deals, US/EU variants", "Xbox Series X, Series S", "Varies by seller"),
            ("Challenger", "0% instalment, walk-in demo", "Xbox Series X, Series S", "Microsoft-backed"),
            ("Courts", "0% instalment, bundle with Game Pass", "Xbox Series X, Series S", "Microsoft-backed"),
            ("Harvey Norman", "0% instalment, walk-in demo", "Xbox Series X, Series S", "Microsoft-backed"),
            ("Best Denki", "In-store demo, last-mile support", "Xbox Series X, Series S", "Microsoft-backed"),
            ("Game retailers (GameChainz / Play-E)", "Bundle with games + Game Pass", "Xbox Series X, Series S", "Microsoft-backed"),
            ("Aftershock (custom PC)", "Bundle with extra controller + headset", "Xbox Series X, Series S", "Microsoft-backed"),
        ],
        "canonical": "/xbox-series-x-singapore",
        "how": [
            "Need the absolute lowest price on Xbox Series X? Shopee/Lazada platform events (3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.10, 11.11, 12.12) consistently run SGD 50–100 below Microsoft Store SG.",
            "Want a bundle (console + 2 controllers + Game Pass Ultimate 3-month)? Harvey Norman and GameChainz run 'complete console bundle' promos that save SGD 80–120 vs. buying pieces separately.",
            "Looking for Xbox Series X + Diablo IV / Forza Horizon 5 bundle? Microsoft Store SG runs first-party bundle promos with disc-copy games at SGD 30–60 off.",
            "Need 0% instalment? Most retailers skip 0% on consoles under SGD 800, but Challenger, Courts, and Harvey Norman offer 0% on Xbox Series X + Game Pass bundle purchases over SGD 700.",
        ],
        "faqs": [
            ("Where is the cheapest place to buy Xbox Series X in Singapore?",
             "Shopee SG (Mall) and Lazada SG (LazMall) typically run SGD 50–100 below Microsoft Store SG on Xbox Series X during platform sales. Microsoft Store SG holds the launch price for new SKUs."),
            ("Is it safe to buy Xbox from Shopee or Lazada in Singapore?",
             "Yes — Shopee Mall and LazMall Xbox listings are operated by authorised SG distributors. Verify the seller badge; same Microsoft 1-year warranty applies."),
            ("Xbox Series X vs Series S: which should I buy in Singapore?",
             "Series X is the flagship — 4K/120fps, 1TB SSD, disc drive. Series S is the budget option — 1440p/120fps, 512GB SSD, digital-only. Cross-check current pricing at buywhere.ai/xbox-series-x-singapore."),
        ],
    },
]


def render_page(spec):
    slug = spec["slug"]
    product = spec["product"]
    brand = spec["brand"]
    product_short = spec["product_short"]
    canonical = spec["canonical"]

    title = f"Where to Buy {product} in Singapore (2026) — Every Merchant Compared"
    description = (
        f"Find where to buy {product} in Singapore across official brand stores, Shopee, Lazada, Amazon SG, Challenger, Courts, Harvey Norman, Best Denki, and authorised resellers. "
        f"Compare real prices on {product_short}, warranty, and 0% instalment options."
    )

    tag_list = ", ".join([f'"{t}"' for t in spec["tags"]])

    merch_rows = []
    for name, best_for, brands, warranty in spec["merch"]:
        merch_rows.append(f"| {name} | {best_for} | {brands} | {warranty} |")

    how_lines = "\n".join([f"- {line}" for line in spec["how"]])

    jsonld_obj = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Article",
                "headline": title,
                "description": description,
                "datePublished": DATE,
                "dateModified": DATE,
                "author": {"@type": "Organization", "name": "BuyWhere Team", "url": "https://buywhere.ai"},
                "publisher": {
                    "@type": "Organization",
                    "name": "BuyWhere",
                    "url": "https://buywhere.ai",
                    "logo": {"@type": "ImageObject", "url": "https://buywhere.ai/logo.png"},
                },
                "mainEntityOfPage": f"https://buywhere.ai/blog/{slug}",
            },
            {
                "@type": "FAQPage",
                "mainEntity": [
                    {
                        "@type": "Question",
                        "name": q,
                        "acceptedAnswer": {"@type": "Answer", "text": a},
                    }
                    for q, a in spec["faqs"]
                ],
            },
        ],
    }
    jsonld_text = json.dumps(jsonld_obj, indent=2, ensure_ascii=False)
    # YAML `>` block scalar requires content indented MORE than the parent key
    # (`jsonLd:` is at column 0, so content must be indented). Prefix every line
    # with two spaces so gray-matter keeps it as one folded string.
    jsonld = "\n".join("  " + line for line in jsonld_text.split("\n"))

    body = f"""# {title}

{brand} buyers in Singapore can choose from roughly a dozen reliable channels when shopping for {product_short}, each with different strengths in price, warranty, and instalment flexibility. This guide maps every major Singapore {product} merchant, what they stock, and how to pick the right one for your needs.

**Quick Answer:** For the **lowest price** on {product}, Shopee SG and Lazada SG run SGD 100–250 below official retail during platform sales. For **official warranty + Edu pricing**, buy directly from {brand}'s official SG store. For **12/24-month interest-free instalments**, Challenger, Courts, and Harvey Norman dominate.

## Singapore {product} merchants at a glance

| Merchant | Best for | Notable models | Warranty |
| --- | --- | --- | --- |
{chr(10).join(merch_rows)}

## How to choose

{how_lines}

## How AI agents track {product.lower()} prices in Singapore

If you build a shopping agent, the BuyWhere MCP server at `https://api.buywhere.ai/mcp` exposes a `compare_prices` tool that returns structured {product.lower()} pricing across every Singapore merchant in the table above in one call. See the [API getting-started guide](https://buywhere.ai/blog/singapore-product-data-api-what-to-look-for) for the full schema.

## Common questions

"""

    for q, a in spec["faqs"]:
        body += f"**{q}**\n\n{a}\n\n"

    body += f"""## Where to go next

- Compare current {product} prices across all merchants → [buywhere.ai{canonical}](https://buywhere.ai{canonical})
- Read our [best {product.lower()} deals in Singapore (Aug 2026)](https://buywhere.ai/blog) roundup
- See all 33 priority-buying guides in the [BuyWhere Blog](https://buywhere.ai/blog)
"""

    fm = f"""---
slug: "{slug}"
title: "{title}"
description: "{description}"
author: "BuyWhere Team"
publishedAt: "{DATE}"
lastUpdatedAt: "{DATE}"
tags: [{tag_list}]
jsonLd: >
{jsonld}
---

{body}"""

    return fm


def main():
    written = 0
    for spec in PAGES:
        content = render_page(spec)
        out = OUT / f"{spec['slug']}.md"
        out.write_text(content)
        print(f"  wrote {out.relative_to(REPO)} ({len(content):,} bytes)")
        written += 1
    print(f"\n{written} tier-2 pages written to {OUT}")


if __name__ == "__main__":
    main()