=== Live MCP probe reproduction (BUY-66684) at 2026-08-06T15:35Z ===

Endpoint: https://api.buywhere.ai/mcp
Auth: Bearer $BUYWHERE_API_KEY

### A. Pre-fix evidence (Tune probe #367 reproduction, cc only, q='coffee grinder')

| cc requested | total | first.id | region | country_code | currency |
|---|---|---|---|---|---|
| SG | 1001 | 54544779 | sg | SG | SGD |
| US | 1001 | 54544779 | sg | SG | SGD |
| TH | 1001 | 54544779 | sg | SG | SGD |
| MY | 1001 | 54544779 | sg | SG | SGD |
| VN | 1001 | 54544779 | sg | SG | SGD |

### B. country_code works correctly (control test)

| country_code | first.id | region | country_code | currency |
|---|---|---|---|---|
| SG | 54544779 | sg | SG | SGD |
| US | 54397532 | US | US | USD |
| TH | 635007714 | TH | TH | THB |
| MY | 53194063 | my | MY | MYR |
| VN | 61409157 | vn | VN | VND |
