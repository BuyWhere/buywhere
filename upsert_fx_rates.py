import json

with open("fx_rates_combined.json") as f:
    rates = json.load(f)
    # Logic to upsert rates into roundhouse
    print("Upserting the following rates:", rates)
