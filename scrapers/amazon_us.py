"""
Amazon US product scraper.

Scrapes product search results from Amazon.com and outputs structured JSON
matching the BuyWhere catalog schema for ingestion via /v1/ingest/products.

Usage:
    python -m scrapers.amazon_us --api-key <key> [--batch-size 100] [--delay 1.5]
    python -m scrapers.amazon_us --scrape-only [--session-file session.json]

Categories covered: Electronics, Computers, Cell Phones, Home, Kitchen, Tools,
Sports, Apparel (Men/Women), Beauty, Health, Baby, Toys, Video Games, Books,
Automotive, Pet Supplies, Office, Grocery, Arts & Crafts, Musical Instruments,
Appliances, Outdoor Living, Luggage, Jewelry, Movies & Music, Industrial.
Target: 500,000+ products
"""
import argparse
import asyncio
import json
import os
import re
import time
import urllib.parse
from typing import Any
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

from scrapers.scraper_registry import register

MERCHANT_ID = "amazon_us"
SOURCE = "amazon_us"
BASE_URL = "https://www.amazon.com"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/amazon_us"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.amazon.com/",
}

RATE_LIMIT_WAIT = 30
MAX_RETRIES = 5

CATEGORIES: list[dict[str, Any]] = [
    {
        "id": "electronics",
        "name": "Electronics",
        "keywords": [
            "laptop", "gaming laptop", "ultrabook", "Chromebook", "MacBook Air", "MacBook Pro",
            "smartphone", "iPhone", "Samsung Galaxy", "Google Pixel", "tablet", "iPad",
            "headphones", "wireless earbuds", "Bluetooth speaker", "soundbar",
            "smart watch", "Apple Watch", "Samsung Watch", "Fitbit",
            "monitor", "4K monitor", "gaming monitor", "ultrawide monitor",
            "keyboard", "mechanical keyboard", "wireless keyboard",
            "mouse", "gaming mouse", "wireless mouse",
            "webcam", "USB hub", "power bank", "wireless charger",
            "SSD", "external hard drive", "USB flash drive", "memory card",
            "WiFi router", "mesh WiFi", "network switch",
            "projector", "home theater", "streaming device", "Roku", "Fire TV",
            "digital camera", "DSLR", "mirrorless camera", "action camera", "GoPro",
            "drone", "camera lens", "tripod",
            "smart home", "smart speaker", "smart display", "smart plug",
            "smart light bulb", "smart thermostat", "smart lock", "video doorbell",
            "security camera", "baby monitor", "Echo Dot", "Nest Hub",
            "TV", "OLED TV", "QLED TV", "4K TV", "smart TV",
            "e-reader", "Kindle", "tablet case", "screen protector",
            "car electronics", "dash cam", "GPS navigator", "car charger",
            "VR headset", "Meta Quest", "Apple Vision Pro",
        ],
    },
    {
        "id": "computers",
        "name": "Computers & Accessories",
        "keywords": [
            "desktop computer", "all-in-one PC", "gaming PC", "mini PC", "workstation",
            "business laptop", "2-in-1 laptop", "iPad Pro", "Surface Pro", "Chromebook",
            "RAM", "DDR5", "graphics card", "RTX", "Radeon", "CPU", "Intel Core", "AMD Ryzen",
            "motherboard", "power supply", "PC case", "CPU cooler",
            "monitor arm", "laptop stand", "laptop bag", "laptop sleeve",
            "docking station", "USB-C hub", "HDMI cable", "DisplayPort cable",
            "printer", "laser printer", "inkjet printer", "all-in-one printer",
            "scanner", "label maker", "3D printer", "3D printer filament",
            "NAS", "server", "rack mount", "KVM switch",
            "tablet mount", "car mount", "desk mount",
            "ergonomic keyboard", "vertical mouse", "wrist rest",
            "laptop charger", "power adapter", "battery backup", "UPS",
            "drawing tablet", "pen display", "stylus",
            "blue light glasses", "computer glasses",
        ],
    },
    {
        "id": "cell_phones",
        "name": "Cell Phones & Accessories",
        "keywords": [
            "iPhone 16", "iPhone 15", "iPhone 14", "iPhone SE",
            "Samsung Galaxy S", "Samsung Galaxy Z Flip", "Samsung Galaxy Z Fold",
            "Google Pixel 9", "Google Pixel 8", "OnePlus", "Motorola",
            "phone case", "iPhone case", "Samsung case", "screen protector",
            "phone charger", "fast charger", "car charger", "wireless charger pad",
            "power bank", "phone stand", "pop socket", "phone grip",
            "Bluetooth headset", "earphone", "wired earbuds",
            "selfie stick", "phone tripod", "phone lens",
            "SIM card", "eSIM", "prepaid phone",
            "phone cable", "USB cable", "Lightning cable", "USB-C cable",
            "phone mount", "car phone mount", "magnetic phone mount",
            "phone wallet", "phone ring holder", "phone lanyard",
            "tablet case", "iPad case", "iPad keyboard case",
        ],
    },
    {
        "id": "home_kitchen",
        "name": "Home & Kitchen",
        "keywords": [
            "air fryer", "Instant Pot", "slow cooker", "rice cooker", "pressure cooker",
            "coffee maker", "espresso machine", "Keurig", "Nespresso", "French press",
            "toaster", "toaster oven", "air fryer oven", "microwave",
            "blender", "food processor", "stand mixer", "hand mixer", "immersion blender",
            "knife set", "cooking knife", "cutting board", "cookware set",
            "nonstick pan", "cast iron skillet", "stainless steel pan",
            "baking sheet", "cake pan", "muffin pan", "cooling rack",
            "kitchen towels", "oven mitt", "apron", "dish rack",
            "food storage", "meal prep container", "water bottle", "lunch box",
            "dinnerware set", "plate set", "glassware", "wine glass", "mug",
            "flatware set", "silverware", "utensil set",
            "bed sheets", "comforter", "duvet cover", "pillow", "pillowcase",
            "blanket", "throw blanket", "quilt", "bedspread",
            "mattress topper", "mattress pad", "mattress protector",
            "towel set", "bath towel", "hand towel", "washcloth", "bath mat",
            "shower curtain", "shower caddy", "toilet brush", "plunger",
            "curtains", "blackout curtains", "sheer curtains", "drapery",
            "rug", "area rug", "runner rug", "doormat",
            "lamp", "table lamp", "floor lamp", "desk lamp", "bedside lamp",
            "wall art", "canvas print", "poster", "wall decor", "wall clock",
            "vase", "candle holder", "decorative pillow", "throw pillow",
            "storage bin", "storage basket", "shelf", "closet organizer",
            "clothes hanger", "shoe rack", "jewelry box", "jewelry organizer",
            "desk organizer", "file cabinet", "letter tray",
            "trash can", "kitchen trash can", "bathroom trash can",
            "step stool", "folding stool", "utility cart",
            "ironing board", "clothes steamer", "iron", "garment rack",
        ],
    },
    {
        "id": "patio_garden",
        "name": "Patio, Lawn & Garden",
        "keywords": [
            "patio furniture set", "outdoor dining set", "patio chair", "Adirondack chair",
            "outdoor table", "patio umbrella", "market umbrella", "cantilever umbrella",
            "grill", "gas grill", "charcoal grill", "pellet grill", "smoker",
            "lawn mower", "push mower", "riding mower", "robot mower",
            "leaf blower", "string trimmer", "weed eater", "chainsaw",
            "pressure washer", "garden hose", "hose reel", "sprinkler",
            "flower pot", "planter", "garden bed", "raised bed",
            "seeds", "plant seeds", "fertilizer", "potting soil", "compost",
            "garden tool set", "shovel", "rake", "hoe", "pruning shears",
            "bird feeder", "bird bath", "bird house",
            "outdoor lighting", "solar lights", "string lights", "path lights",
            "fire pit", "outdoor heater", "chimenea", "campfire pit",
            "outdoor storage", "shed", "deck box", "storage bench",
            "pool float", "pool toy", "pool cleaner", "pool cover",
            "trampoline", "playset", "swing set", "sandbox",
            "pest control", "bug zapper", "mosquito repellent", "traps",
        ],
    },
    {
        "id": "tools",
        "name": "Tools & Home Improvement",
        "keywords": [
            "power drill", "cordless drill", "impact driver", "hammer drill",
            "circular saw", "miter saw", "table saw", "jigsaw", "reciprocating saw",
            "sander", "orbital sander", "belt sander", "angle grinder",
            "screwdriver set", "wrench set", "socket set", "ratchet set",
            "hammer", "tape measure", "level", "stud finder",
            "tool box", "tool bag", "tool chest", "tool cabinet",
            "workbench", "work table", "tool organizer",
            "ladder", "step ladder", "extension ladder", "multi-purpose ladder",
            "paint sprayer", "paint roller", "paint brush", "painter's tape",
            "paint", "wall paint", "wood stain", "primer",
            "plumbing", "pipe wrench", "plunger", "snake", "faucet",
            "electrical", "wire stripper", "voltage tester", "outlet", "switch",
            "door lock", "deadbolt", "smart lock", "door knob",
            "cabinet hardware", "drawer pull", "cabinet knob", "hinge",
            "wall shelf", "floating shelf", "wall bracket", "pegboard",
            "caulk gun", "utility knife", "glue gun", "clamp",
            "air compressor", "nail gun", "stapler", "generator",
            "safety glasses", "work gloves", "dust mask", "ear protection",
            "shop vacuum", "wet dry vacuum", "garage storage", "shelving unit",
        ],
    },
    {
        "id": "sports",
        "name": "Sports & Outdoors",
        "keywords": [
            "running shoes", "men running shoes", "women running shoes", "trail running",
            "yoga mat", "yoga block", "yoga strap", "exercise ball",
            "dumbbell set", "kettlebell", "barbell", "weight plate", "weight bench",
            "resistance band", "pull up bar", "push up stand", "ab roller",
            "treadmill", "exercise bike", "elliptical", "row machine",
            "stationary bike", "Peloton", "spin bike", "indoor cycle",
            "jump rope", "foam roller", "massage gun", "fitness tracker",
            "protein powder", "pre workout", "BCAA", "creatine", "protein bar",
            "bike", "mountain bike", "road bike", "hybrid bike", "electric bike",
            "bike helmet", "bike lock", "bike light", "bike pump",
            "scooter", "electric scooter", "hoverboard", "skateboard",
            "tent", "camping tent", "family tent", "backpacking tent",
            "sleeping bag", "camping pad", "camping pillow", "air mattress",
            "camping chair", "camping table", "camping stove", "camping lantern",
            "cooler", "ice chest", "portable cooler", "camping cooler",
            "backpack", "hiking backpack", "daypack", "hydration pack",
            "hiking boots", "hiking shoes", "hiking socks", "trekking poles",
            "fishing rod", "fishing reel", "fishing tackle", "fishing lure",
            "golf club set", "golf driver", "golf iron", "golf putter",
            "golf ball", "golf bag", "golf glove", "golf rangefinder",
            "tennis racket", "tennis ball", "pickleball paddle", "pickleball set",
            "soccer ball", "basketball", "football", "volleyball",
            "baseball bat", "baseball glove", "softball", "hockey stick",
            "swim goggles", "swim cap", "swim fins", "kickboard",
            "wetsuit", "rash guard", "board shorts",
            "ski goggles", "snowboard", "snowboard boots", "ski helmet",
            "boxing gloves", "boxing bag", "mma gloves", "shin guards",
        ],
    },
    {
        "id": "apparel_men",
        "name": "Men's Clothing",
        "keywords": [
            "men t shirt", "men polo shirt", "men button down", "men dress shirt",
            "men jeans", "men chinos", "men shorts", "men cargo shorts",
            "men suit", "men blazer", "men sport coat", "men vest",
            "men jacket", "men winter coat", "men rain jacket", "men puffer jacket",
            "men hoodie", "men sweatshirt", "men sweater", "men cardigan",
            "men activewear", "men gym shorts", "men joggers", "men compression shirt",
            "men underwear", "men boxers", "men briefs", "men undershirt",
            "men socks", "men dress socks", "men athletic socks",
            "men shoes", "men dress shoes", "men casual shoes", "men boots",
            "men sneakers", "men sandals", "men loafers", "men oxfords",
            "men hat", "men baseball cap", "men beanie", "men fedora",
            "men belt", "men wallet", "men watch", "men tie",
            "men swim trunks", "men swimwear", "men board shorts",
            "men pajama", "men robe", "men slippers",
            "men big and tall", "men plus size",
        ],
    },
    {
        "id": "apparel_women",
        "name": "Women's Clothing",
        "keywords": [
            "women dress", "women maxi dress", "women cocktail dress", "women sundress",
            "women top", "women blouse", "women tank top", "women crop top",
            "women jeans", "women skinny jeans", "women bootcut jeans", "women wide leg",
            "women leggings", "women yoga pants", "women shorts",
            "women skirt", "women maxi skirt", "women mini skirt", "women pencil skirt",
            "women jacket", "women blazer", "women winter coat", "women raincoat",
            "women hoodie", "women sweatshirt", "women sweater", "women cardigan",
            "women activewear", "women sports bra", "women gym leggings",
            "women swimsuit", "women bikini", "women one piece", "women cover up",
            "women lingerie", "women bra", "women panties", "women shapewear",
            "women socks", "women tights", "women hosiery",
            "women shoes", "women heels", "women flats", "women sandals",
            "women boots", "women sneakers", "women wedges", "women loafers",
            "women handbag", "women crossbody bag", "women tote bag", "women clutch",
            "women backpack", "women wallet", "women wristlet",
            "women jewelry", "women necklace", "women earring", "women bracelet",
            "women ring", "women watch", "women anklet",
            "women hat", "women scarf", "women belt", "women sunglasses",
            "women pajama", "women robe", "women slippers",
            "women plus size", "women petite", "women maternity",
        ],
    },
    {
        "id": "beauty",
        "name": "Beauty & Personal Care",
        "keywords": [
            "moisturizer", "face cream", "serum", "vitamin C serum", "retinol",
            "sunscreen", "face sunscreen", "body sunscreen", "SPF 50",
            "cleanser", "face wash", "makeup remover", "micellar water",
            "toner", "face mist", "essence", "face oil",
            "eye cream", "eye serum", "under eye patches",
            "foundation", "concealer", "powder", "blush", "bronzer",
            "eyeshadow", "eyeliner", "mascara", "eyebrow pencil",
            "lipstick", "lip gloss", "lip liner", "lip balm",
            "nail polish", "gel nail polish", "nail art", "nail file",
            "shampoo", "conditioner", "hair mask", "hair oil",
            "hair styling", "hairspray", "hair gel", "hair mousse",
            "hair dryer", "flat iron", "curling iron", "hair brush",
            "beard trimmer", "hair clipper", "electric shaver", "razor",
            "deodorant", "body wash", "body lotion", "body oil",
            "hand cream", "foot cream", "cologne", "perfume",
            "essential oil", "diffuser", "aromatherapy",
            "makeup brush set", "beauty sponge", "makeup bag",
            "manicure set", "pedicure set", "nail clipper",
            "toothbrush", "electric toothbrush", "toothpaste", "whitening",
            "mouthwash", "dental floss", "water flosser",
        ],
    },
    {
        "id": "health",
        "name": "Health & Household",
        "keywords": [
            "vitamins", "multivitamin", "vitamin D", "vitamin C", "omega 3",
            "supplements", "probiotic", "collagen", "magnesium", "zinc",
            "cold medicine", "allergy medicine", "pain relief", "ibuprofen",
            "first aid kit", "bandage", "thermometer", "blood pressure monitor",
            "pulse oximeter", "glucose monitor", "nebulizer",
            "heating pad", "ice pack", "massager", "neck massager",
            "face mask", "KN95", "N95", "surgical mask",
            "hand sanitizer", "disinfectant wipes", "disinfectant spray",
            "air purifier", "humidifier", "dehumidifier", "fan",
            "water filter", "water pitcher", "water bottle filter",
            "paper towel", "toilet paper", "tissue box", "napkin",
            "laundry detergent", "fabric softener", "stain remover",
            "dish soap", "dishwasher detergent", "sponge", "scrub brush",
            "all purpose cleaner", "glass cleaner", "bathroom cleaner",
            "trash bag", "ziploc bag", "aluminum foil", "plastic wrap",
            "batteries", "AA battery", "AAA battery", "rechargeable battery",
            "light bulb", "LED bulb", "smart bulb",
            "food storage container", "glass container", "lunch bag",
            "insect repellent", "mouse trap", "cockroach bait",
        ],
    },
    {
        "id": "baby",
        "name": "Baby",
        "keywords": [
            "baby diaper", "baby wipes", "diaper pail", "diaper cream",
            "baby formula", "baby food", "baby bottle", "baby sippy cup",
            "baby pacifier", "teether", "baby bib", "burp cloth",
            "baby clothes", "baby onesie", "baby sleeper", "baby swaddle",
            "baby shoes", "baby socks", "baby hat", "baby mittens",
            "baby car seat", "infant car seat", "convertible car seat", "booster seat",
            "baby stroller", "umbrella stroller", "double stroller", "jogging stroller",
            "baby carrier", "baby wrap", "baby sling", "backpack carrier",
            "baby monitor", "video baby monitor", "audio baby monitor",
            "crib", "baby bassinet", "playpen", "baby crib mattress",
            "baby bouncer", "baby swing", "baby rocker", "baby play mat",
            "baby gate", "baby proofing", "cabinet lock", "corner guard",
            "high chair", "baby booster seat", "baby feeding set",
            "baby bath tub", "baby towel", "baby wash", "baby lotion",
            "toddler bed", "toddler pillow", "toddler blanket",
            "potty training", "potty chair", "potty seat",
            "nursery decor", "baby mobile", "night light", "baby lamp",
        ],
    },
    {
        "id": "toys",
        "name": "Toys & Games",
        "keywords": [
            "LEGO set", "LEGO City", "LEGO Technic", "LEGO Star Wars",
            "building blocks", "magnetic tiles", "construction set",
            "action figure", "superhero figure", "doll", "Barbie", "dollhouse",
            "stuffed animal", "plush toy", "squishmallow", "teddy bear",
            "board game", "Monopoly", "Sorry", "Clue", "Scrabble",
            "card game", "Uno", "Phase 10", "Skip-Bo",
            "puzzle", "jigsaw puzzle", "floor puzzle", "wooden puzzle",
            "educational toy", "STEM toy", "science kit", "robot kit",
            "arts and crafts", "coloring book", "crayon", "paint set",
            "play dough", "slime kit", "modeling clay",
            "remote control car", "RC car", "RC truck", "RC helicopter",
            "train set", "wooden train", "toy train", "model train",
            "baby toy", "rattle", "activity toy", "stacking toy",
            "pretend play", "play kitchen", "tool set", "doctor kit",
            "outdoor toy", "bubble machine", "water gun", "kite",
            "kids bike", "balance bike", "tricycle", "scooter",
            "kids game", "kids craft", "party favor",
            "fidget toy", "pop it", "fidget spinner", "stress ball",
            "card game TCG", "Pokemon card", "Magic The Gathering", "Yu-Gi-Oh",
        ],
    },
    {
        "id": "video_games",
        "name": "Video Games",
        "keywords": [
            "PS5", "PlayStation 5", "PS5 controller", "PS5 headset",
            "Xbox Series X", "Xbox Series S", "Xbox controller", "Xbox headset",
            "Nintendo Switch", "Switch OLED", "Switch Lite", "Joy Con",
            "PS5 game", "PlayStation game", "Xbox game", "Nintendo Switch game",
            "PC game", "Steam card", "Xbox Game Pass", "PlayStation Plus",
            "gaming chair", "gaming desk", "gaming headset", "gaming keyboard",
            "gaming mouse", "mouse pad", "gaming monitor",
            "PC controller", "racing wheel", "flight stick", "arcade stick",
            "capture card", "streaming mic", "streaming camera",
            "VR", "Meta Quest 3", "PlayStation VR", "VR accessories",
            "Nintendo", "Mario", "Zelda", "Pokemon",
            "Call of Duty", "Madden", "FIFA", "NBA 2K",
            "Minecraft", "Fortnite", "Roblox", "GTA",
            "retro gaming", "Nintendo Classic", "Sega Genesis",
            "gaming laptop", "gaming PC", "gaming controller charger",
        ],
    },
    {
        "id": "books",
        "name": "Books",
        "keywords": [
            "fiction books", "fantasy books", "science fiction", "mystery novel", "romance novel",
            "thriller book", "horror book", "historical fiction", "literary fiction",
            "nonfiction", "biography", "memoir", "history book",
            "self help book", "business book", "personal finance", "investing",
            "cookbook", "recipe book", "baking cookbook",
            "children book", "picture book", "chapter book", "young adult",
            "textbook", "study guide", "test prep", "SAT prep",
            "science book", "technology book", "programming book",
            "art book", "photography book", "coffee table book",
            "religion book", "spirituality", "Bible", "Christian book",
            "travel guide", "travel book", "atlas", "map",
            "comic book", "graphic novel", "manga", "anime book",
            "audio book", "Kindle book", "ebook", "audible",
            "book set", "box set", "series collection",
            "language learning", "Spanish book", "French book",
            "craft book", "home improvement book", "gardening book",
            "health book", "diet book", "fitness book",
            "political book", "philosophy", "true crime",
        ],
    },
    {
        "id": "automotive",
        "name": "Automotive",
        "keywords": [
            "car seat cover", "car floor mat", "all weather floor mat", "cargo liner",
            "car phone mount", "car charger", "car USB adapter",
            "dash cam", "front dash cam", "rear dash cam",
            "car battery", "jump starter", "battery charger", "portable jump starter",
            "car cover", "car sun shade", "windshield cover",
            "car wax", "car polish", "car cleaner", "car detailing kit",
            "motor oil", "synthetic oil", "oil filter", "transmission fluid",
            "car tool set", "emergency kit", "roadside kit", "tow strap",
            "car jack", "jack stand", "ramp", "tire inflator",
            "roof rack", "roof box", "cargo carrier", "bike rack",
            "car interior accessory", "steering wheel cover", "gear shifter",
            "car lighting", "LED headlight", "fog light", "interior light",
            "car audio", "car stereo", "car speaker", "car subwoofer",
            "tire", "all season tire", "winter tire", "summer tire",
            "wheel cover", "hubcap", "lug nut", "wheel lock",
            "motorcycle helmet", "motorcycle cover", "motorcycle oil",
            "ATV accessory", "offroad accessory",
        ],
    },
    {
        "id": "pet_supplies",
        "name": "Pet Supplies",
        "keywords": [
            "dog food", "dry dog food", "wet dog food", "puppy food",
            "cat food", "dry cat food", "wet cat food", "kitten food",
            "dog treat", "dog chew", "dog bone", "dental chew",
            "cat treat", "catnip", "cat snack",
            "dog bed", "dog crate", "dog kennel", "dog house",
            "cat bed", "cat tree", "cat tower", "cat condo",
            "dog leash", "dog collar", "dog harness", "dog muzzle",
            "cat collar", "cat harness", "cat leash",
            "dog toy", "chew toy", "fetch toy", "puzzle toy",
            "cat toy", "cat wand", "laser toy", "cat tunnel",
            "dog bowl", "cat bowl", "automatic feeder", "water fountain",
            "litter box", "cat litter", "litter mat", "litter scoop",
            "dog shampoo", "dog brush", "nail clipper", "pet wipes",
            "dog waste bag", "poop bag", "poop bag dispenser",
            "pet carrier", "pet travel bag", "car seat cover for dogs",
            "aquarium", "fish tank", "aquarium filter", "fish food",
            "bird cage", "bird food", "bird toy", "bird perch",
            "hamster cage", "hamster wheel", "guinea pig cage",
            "reptile tank", "reptile light", "reptile heat lamp",
        ],
    },
    {
        "id": "office",
        "name": "Office Products",
        "keywords": [
            "office chair", "ergonomic chair", "executive chair", "task chair",
            "standing desk", "adjustable desk", "desk riser", "standing desk converter",
            "desk", "computer desk", "corner desk", "writing desk",
            "bookcase", "bookshelf", "storage cabinet", "filing cabinet",
            "desk lamp", "LED desk lamp", "architect lamp", "clamp lamp",
            "whiteboard", "dry erase board", "bulletin board", "cork board",
            "printer paper", "copy paper", "notebook", "legal pad",
            "pen", "pencil", "marker", "highlighter",
            "binder", "folder", "divider", "sheet protector",
            "stapler", "tape dispenser", "paper clip", "rubber band",
            "envelope", "shipping label", "mailing box", "packing tape",
            "shredder", "paper shredder", "laminator", "binding machine",
            "calculator", "scientific calculator", "printing calculator",
            "business card holder", "name badge", "badge holder",
            "fireproof safe", "security safe", "lock box", "cash box",
            "classroom supplies", "teacher supplies", "bulletin board decor",
            "planner", "calendar", "weekly planner", "daily planner",
            "post it note", "index card", "sticky flag", "tab divider",
        ],
    },
    {
        "id": "grocery",
        "name": "Grocery & Gourmet Food",
        "keywords": [
            "coffee beans", "ground coffee", "coffee pods", "Keurig pods",
            "tea", "green tea", "black tea", "herbal tea",
            "protein bar", "granola bar", "snack bar", "energy bar",
            "chocolate", "dark chocolate", "milk chocolate", "chocolate bar",
            "candy", "gummy candy", "hard candy", "lollipop",
            "chips", "potato chips", "tortilla chips", "pita chips",
            "crackers", "pretzels", "popcorn", "nuts",
            "granola", "oatmeal", "cereal", "breakfast bar",
            "pasta", "spaghetti", "penne", "linguine",
            "rice", "white rice", "brown rice", "jasmine rice",
            "olive oil", "vegetable oil", "coconut oil", "avocado oil",
            "vinegar", "soy sauce", "hot sauce", "ketchup",
            "salt", "pepper", "spice", "seasoning",
            "honey", "maple syrup", "peanut butter", "jam",
            "canned soup", "canned vegetable", "canned fruit", "canned fish",
            "broth", "stock", "bone broth", "tomato sauce",
            "baking mix", "flour", "sugar", "vanilla extract",
            "jerky", "beef jerky", "turkey jerky", "dried fruit",
            "trail mix", "seeds", "dried seaweed", "rice cake",
            "water", "sparkling water", "flavored water", "coconut water",
            "energy drink", "sports drink", "protein shake", "soda",
        ],
    },
    {
        "id": "arts_crafts",
        "name": "Arts, Crafts & Sewing",
        "keywords": [
            "yarn", "knitting yarn", "crochet yarn", "embroidery floss",
            "sewing machine", "serger", "sewing kit", "sewing scissors",
            "fabric", "cotton fabric", "quilt fabric", "felt fabric",
            "beads", "jewelry making", "beading kit", "bead organizer",
            "paint", "acrylic paint", "oil paint", "watercolor paint",
            "paint brush set", "canvas", "easel", "palette",
            "drawing pencil", "colored pencil", "charcoal", "pastel",
            "sketchbook", "drawing paper", "watercolor paper",
            "clay", "pottery clay", "polymer clay", "air dry clay",
            "embroidery kit", "cross stitch", "needlepoint",
            "quilting kit", "quilting fabric", "quilting ruler",
            "scrapbooking", "paper craft", "card making", "sticker",
            "cricut", "cutting machine", "vinyl", "heat press",
            "glue", "hot glue", "craft glue", "epoxy",
            "ribbon", "lace", "button", "zipper",
            "origami paper", "tissue paper", "wrapping paper",
            "party decoration", "balloon", "banner", "confetti",
            "wood burning", "leather craft", "resin mold", "candle making",
            "soap making", "soap mold", "mica powder", "fragrance oil",
        ],
    },
    {
        "id": "musical_instruments",
        "name": "Musical Instruments",
        "keywords": [
            "guitar", "acoustic guitar", "electric guitar", "classical guitar",
            "guitar amplifier", "guitar pedal", "guitar strings", "guitar pick",
            "bass guitar", "electric bass", "bass amplifier",
            "keyboard piano", "digital piano", "MIDI keyboard", "synthesizer",
            "drum set", "electronic drum", "snare drum", "cymbals",
            "violin", "fiddle", "viola", "cello", "double bass",
            "flute", "clarinet", "saxophone", "trumpet", "trombone",
            "microphone", "studio mic", "dynamic mic", "condenser mic",
            "studio monitor", "audio interface", "mixer", "headphone",
            "DJ equipment", "DJ controller", "turntable", "DJ mixer",
            "ukulele", "mandolin", "banjo", "harmonica",
            "accordion", "bagpipes", "pan flute",
            "sheet music", "music stand", "metronome", "tuner",
            "instrument case", "guitar case", "violin case",
            "guitar stand", "keyboard stand", "drum throne",
            "amplifier", "PA system", "power amplifier", "speaker",
            "recording equipment", "studio headphones",
            "effects pedal", "wah pedal", "distortion", "reverb",
        ],
    },
    {
        "id": "appliances",
        "name": "Major Appliances",
        "keywords": [
            "refrigerator", "French door refrigerator", "side by side refrigerator",
            "washer", "washing machine", "front load washer", "top load washer",
            "dryer", "electric dryer", "gas dryer", "washer dryer combo",
            "dishwasher", "built in dishwasher", "portable dishwasher",
            "range", "gas range", "electric range", "induction range",
            "oven", "wall oven", "double oven", "convection oven",
            "cooktop", "gas cooktop", "electric cooktop", "induction cooktop",
            "microwave", "over the range microwave", "countertop microwave",
            "freezer", "chest freezer", "upright freezer",
            "wine cooler", "wine refrigerator", "beverage cooler",
            "ice maker", "portable ice maker", "countertop ice maker",
            "water dispenser", "water cooler", "bottleless water cooler",
            "range hood", "vent hood", "downdraft vent",
            "trash compactor", "disposal", "garbage disposal",
            "humidifier", "dehumidifier", "air conditioner",
            "portable AC", "window AC", "heater", "space heater",
        ],
    },
    {
        "id": "luggage",
        "name": "Luggage & Travel Gear",
        "keywords": [
            "suitcase", "carry on luggage", "checked luggage", "hardside suitcase",
            "travel backpack", "hiking backpack", "laptop backpack",
            "duffel bag", "weekender bag", "gym bag",
            "travel tote", "travel crossbody", "travel wallet",
            "luggage set", "luggage 3 piece", "luggage 4 piece",
            "luggage cover", "luggage tag", "luggage strap",
            "travel pillow", "neck pillow", "eye mask", "travel blanket",
            "travel organizer", "packing cube", "toiletry bag", "shoe bag",
            "passport holder", "travel document organizer", "money belt",
            "garment bag", "garment suitcase", "suit bag",
            "kids luggage", "kids backpack", "kids travel bag",
            "travel adapter", "power adapter", "voltage converter",
            "travel scale", "luggage scale", "TSA lock",
            "umbrella", "travel umbrella", "compact umbrella",
            "travel towel", "quick dry towel", "microfiber towel",
        ],
    },
    {
        "id": "movies_music",
        "name": "Movies, Music & TV",
        "keywords": [
            "Blu-ray", "4K Blu-ray", "Blu-ray movie", "DVD movie",
            "Vinyl record", "LP record", "vinyl album",
            "CD album", "music CD", "box set music",
            "movie collection", "TV series DVD", "box set DVD",
            "documentary DVD", "concert DVD",
            "record player", "turntable", "vinyl player",
            "CD player", "Blu-ray player", "DVD player",
            "movie poster", "band poster", "music poster",
        ],
    },
]


@register("amazon_us")
class AmazonUSScraper:
    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 2.0,
        scrape_only: bool = False,
        output_dir: str | None = None,
        max_pages_per_keyword: int = 25,
        proxies: list[str] | None = None,
        session_file: str | None = None,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.output_dir = output_dir or OUTPUT_DIR
        self.max_pages_per_keyword = max_pages_per_keyword
        self.proxies = proxies or []
        self._proxy_index = 0
        self.session_file = session_file
        self.client = httpx.AsyncClient(timeout=30.0, headers=HEADERS, follow_redirects=True)
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.seen_asins: set[str] = set()
        self._load_session()
        self._ensure_output_dir()

    def _load_session(self) -> None:
        if self.session_file and os.path.exists(self.session_file):
            try:
                with open(self.session_file, "r") as f:
                    data = json.load(f)
                    self.seen_asins = set(data.get("seen_asins", []))
                    print(f"Loaded session with {len(self.seen_asins)} previously scraped ASINs")
            except Exception:
                pass

    def _save_session(self) -> None:
        if self.session_file:
            try:
                with open(self.session_file, "w") as f:
                    json.dump({"seen_asins": list(self.seen_asins)}, f)
            except Exception:
                pass

    def _get_proxy(self) -> str | None:
        all_proxies = self.proxies.copy()
        scraperapi_key = os.environ.get("SCRAPERAPI_KEY")
        if scraperapi_key:
            all_proxies.append(f"http://scraperapi:{scraperapi_key}@proxy-server.scraperapi.com:8001")
        if not all_proxies:
            return None
        proxy = all_proxies[self._proxy_index % len(all_proxies)]
        self._proxy_index += 1
        return proxy

    async def _fetch_with_playwright(self, url: str) -> str | None:
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            return None
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-blink-features=AutomationControlled",
                        "--disable-dev-shm-usage",
                    ],
                )
                context = await browser.new_context(
                    user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    viewport={"width": 1920, "height": 1080},
                    locale="en-US",
                )
                await context.add_init_script("""
                    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
                    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                """)
                page = await context.new_page()
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    await page.wait_for_timeout(3000)
                    html = await page.content()
                    return html
                except Exception as e:
                    print(f"  Playwright error: {e}")
                    return None
                finally:
                    await browser.close()
        except Exception as e:
            print(f"  Playwright launch error: {e}")
            return None

    def _ensure_output_dir(self) -> None:
        os.makedirs(self.output_dir, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        self.products_outfile = os.path.join(self.output_dir, f"products_{ts}.jsonl")

    async def close(self) -> None:
        await self.client.aclose()

    async def _get_with_retry(
        self, url: str, params: dict[str, Any] | None = None, retries: int = MAX_RETRIES
    ) -> str | None:
        full_url = url
        if params:
            query = urllib.parse.urlencode(params)
            full_url = f"{url}?{query}"

        scraperapi_key = os.environ.get("SCRAPERAPI_KEY")
        if scraperapi_key:
            for attempt in range(retries):
                try:
                    resp = await self.client.get(
                        "http://api.scraperapi.com",
                        params={
                            "api_key": scraperapi_key,
                            "url": full_url,
                            "render": "true",
                        },
                    )
                    if resp.status_code == 429:
                        await asyncio.sleep(RATE_LIMIT_WAIT * (attempt + 1))
                        continue
                    resp.raise_for_status()
                    return resp.text
                except httpx.HTTPStatusError as e:
                    if e.response.status_code == 429:
                        await asyncio.sleep(RATE_LIMIT_WAIT * (attempt + 1))
                        continue
                    if "credits" in (e.response.text or "").lower():
                        print("  ScraperAPI credits exhausted, falling back to Playwright...")
                        break
                    if attempt < retries - 1:
                        await asyncio.sleep((2 ** attempt) * self.delay)
                    else:
                        return None
                except Exception:
                    if attempt < retries - 1:
                        await asyncio.sleep((2 ** attempt) * self.delay)
                    else:
                        return None

        print("  Using Playwright...")
        return await self._fetch_with_playwright(full_url)

    def _write_products_to_file(self, products: list[dict[str, Any]]) -> None:
        if not products:
            return
        with open(self.products_outfile, "a", encoding="utf-8") as f:
            for product in products:
                f.write(json.dumps(product, ensure_ascii=False) + "\n")

    def _parse_price(self, value: str | None) -> float:
        if not value:
            return 0.0
        cleaned = value.replace("$", "").replace(",", "").strip()
        match = re.search(r"\d+(?:\.\d+)?", cleaned)
        if not match:
            return 0.0
        try:
            return float(match.group(0))
        except ValueError:
            return 0.0

    def _parse_int(self, value: str | None) -> int:
        if not value:
            return 0
        digits = re.sub(r"[^\d]", "", value)
        return int(digits) if digits else 0

    def _extract_brand(self, title: str) -> str:
        if not title:
            return ""
        first_token = title.split()[0].strip("()[],:")
        if not first_token:
            return ""
        if any(char.isdigit() for char in first_token):
            return ""
        return first_token[:80]

    def transform_product(
        self, raw: dict[str, Any], category_name: str, keyword: str
    ) -> dict[str, Any] | None:
        try:
            asin = str(raw.get("asin", "") or raw.get("sku", "")).strip()
            if not asin:
                return None

            title = (raw.get("title") or "").strip()
            if not title:
                return None

            url = raw.get("url") or f"{BASE_URL}/dp/{asin}"
            if not url.startswith("http"):
                url = urljoin(BASE_URL, url)

            price = self._parse_price(raw.get("price"))
            original_price = self._parse_price(raw.get("original_price")) or price
            review_count = self._parse_int(raw.get("review_count"))

            rating = 0.0
            rating_text = raw.get("rating") or ""
            rating_match = re.search(r"(\d+(?:\.\d+)?)", rating_text)
            if rating_match:
                rating = float(rating_match.group(1))

            category_path = [category_name]
            if keyword and keyword.lower() != category_name.lower():
                category_path.append(keyword)

            is_prime = bool(raw.get("is_prime", False))

            brand = raw.get("brand")
            if not brand or not brand.strip():
                brand = self._extract_brand(title)

            return {
                "sku": asin,
                "merchant_id": MERCHANT_ID,
                "title": title,
                "description": raw.get("description") or "",
                "price": price,
                "currency": "USD",
                "url": url,
                "image_url": raw.get("image_url") or "",
                "category": category_name,
                "category_path": category_path,
                "brand": brand,
                "is_active": True,
                "metadata": {
                    "keyword": keyword,
                    "original_price": original_price,
                    "rating": rating,
                    "review_count": review_count,
                    "is_sponsored": bool(raw.get("is_sponsored", False)),
                    "is_prime": is_prime,
                    "country_code": "US",
                    "region": "us",
                },
            }
        except Exception:
            return None

    def parse_search_results(
        self, html: str, category_name: str, keyword: str
    ) -> tuple[list[dict[str, Any]], bool]:
        soup = BeautifulSoup(html, "html.parser")
        products: list[dict[str, Any]] = []

        for card in soup.select('[data-component-type="s-search-result"][data-asin]'):
            asin = (card.get("data-asin") or "").strip()
            if not asin:
                continue

            title_el = card.select_one("h2 span")
            if not title_el:
                continue

            link_el = card.select_one("h2 a")
            price_el = card.select_one(".a-price .a-offscreen")
            original_price_el = card.select_one(".a-text-price .a-offscreen")
            image_el = card.select_one("img.s-image")
            rating_el = card.select_one(".a-icon-alt")
            review_el = card.select_one('a[href*="#customerReviews"] span, a[href*="#customerReviews"]:not(span)')
            sponsored_el = card.select_one('[aria-label="Sponsored"], .puis-sponsored-label-text')
            prime_el = card.select_one('.a-icon-prime, [aria-label*="Prime"], .prime-badge')

            raw_product = {
                "asin": asin,
                "title": title_el.get_text(" ", strip=True),
                "url": link_el.get("href", "") if link_el else "",
                "price": price_el.get_text(strip=True) if price_el else "",
                "original_price": (
                    original_price_el.get_text(strip=True) if original_price_el else ""
                ),
                "image_url": image_el.get("src", "") if image_el else "",
                "rating": rating_el.get_text(" ", strip=True) if rating_el else "",
                "review_count": review_el.get_text(" ", strip=True) if review_el else "",
                "is_sponsored": sponsored_el is not None,
                "is_prime": prime_el is not None,
            }

            transformed = self.transform_product(raw_product, category_name, keyword)
            if transformed:
                products.append(transformed)

        has_next_page = soup.select_one(".s-pagination-next:not(.s-pagination-disabled)") is not None
        return products, has_next_page

    async def ingest_batch(self, products: list[dict[str, Any]]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0

        if self.scrape_only:
            self._write_products_to_file(products)
            return len(products), 0, 0

        url = f"{self.api_base}/v1/ingest/products"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {"source": SOURCE, "products": products}

        try:
            resp = await self.client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            result = resp.json()
            return (
                result.get("rows_inserted", 0),
                result.get("rows_updated", 0),
                result.get("rows_failed", 0),
            )
        except Exception as e:
            print(f"  Ingestion error: {e}")
            return 0, 0, len(products)

    async def scrape_keyword(
        self, category: dict[str, Any], keyword: str
    ) -> dict[str, int]:
        category_name = category["name"]
        print(f"\n[{category_name}] keyword='{keyword}'")
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}
        batch: list[dict[str, Any]] = []

        for page in range(1, self.max_pages_per_keyword + 1):
            params = {"k": keyword, "page": page}
            html = await self._get_with_retry(f"{BASE_URL}/s", params=params)
            if not html:
                print(f"  Page {page}: request failed")
                break

            parsed_products, has_next_page = self.parse_search_results(html, category_name, keyword)

            fresh_products = []
            for product in parsed_products:
                if product["sku"] in self.seen_asins:
                    continue
                self.seen_asins.add(product["sku"])
                fresh_products.append(product)

            if not fresh_products:
                print(f"  Page {page}: no new products")
                if not has_next_page:
                    break
                await asyncio.sleep(self.delay)
                continue

            for product in fresh_products:
                batch.append(product)
                counts["scraped"] += 1

                if len(batch) >= self.batch_size:
                    i, u, f = await self.ingest_batch(batch)
                    counts["ingested"] += i
                    counts["updated"] += u
                    counts["failed"] += f
                    self.total_ingested += i
                    self.total_updated += u
                    self.total_failed += f
                    batch = []
                    await asyncio.sleep(self.delay)

            print(f"  Page {page}: parsed={len(parsed_products)} new={len(fresh_products)} total={counts['scraped']}")

            if page % 5 == 0:
                self._save_session()

            if not has_next_page:
                break

            await asyncio.sleep(self.delay)

        if batch:
            i, u, f = await self.ingest_batch(batch)
            counts["ingested"] += i
            counts["updated"] += u
            counts["failed"] += f
            self.total_ingested += i
            self.total_updated += u
            self.total_failed += f

        self.total_scraped += counts["scraped"]
        self._save_session()
        return counts

    async def run(self) -> dict[str, Any]:
        mode = "scrape only" if self.scrape_only else f"API: {self.api_base}"
        print("Amazon US Scraper starting...")
        print(f"Mode: {mode}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Max pages per keyword: {self.max_pages_per_keyword}")
        print(f"Output: {self.products_outfile}")

        total_keywords = sum(len(c["keywords"]) for c in CATEGORIES)
        print(f"Categories: {len(CATEGORIES)}, Keywords: {total_keywords}")
        print(f"Target: 500,000+ products")

        start = time.time()

        for category in CATEGORIES:
            for keyword in category["keywords"]:
                counts = await self.scrape_keyword(category, keyword)
                print(f"  [{category['name']} / {keyword}] Done: {counts}")
                await asyncio.sleep(self.delay)

        elapsed = time.time() - start
        self._save_session()
        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "output_file": self.products_outfile,
            "unique_asins": len(self.seen_asins),
        }
        print(f"\nScraper complete: {summary}")
        return summary


async def main() -> None:
    parser = argparse.ArgumentParser(description="Amazon US Scraper")
    parser.add_argument("--api-key", help="BuyWhere API key")
    parser.add_argument("--api-base", default="http://localhost:8000", help="BuyWhere API base URL")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=2.0, help="Delay between requests/batches (seconds)")
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
    parser.add_argument("--output-dir", help="Override output directory")
    parser.add_argument("--max-pages-per-keyword", type=int, default=25)
    parser.add_argument("--pages", type=int, help="Shorthand for --max-pages-per-keyword")
    parser.add_argument("--session-file", help="Path to session file for resume support")
    parser.add_argument("--proxies", nargs="*", help="List of proxy URLs to rotate through")
    args = parser.parse_args()

    if args.pages:
        args.max_pages_per_keyword = args.pages

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is used")

    scraper = AmazonUSScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        output_dir=args.output_dir,
        max_pages_per_keyword=args.max_pages_per_keyword,
        proxies=args.proxies,
        session_file=args.session_file,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
