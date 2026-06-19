import json

def update_fx_rates(rates):
    # Logic to update the application with new rates
    print("Exchange rates updated:", rates)

with open("fx_rates.json") as f:
    fx_rates = json.load(f)
update_fx_rates(fx_rates)
