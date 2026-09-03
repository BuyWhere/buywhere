# BUY-64341 — one-line apply for `.github/workflows/deploy-railway.yml`

GitHub `main` at `ebd73cf7c` still uses the crashing DID parser.
Contents API PUT of the workflow file is refused without `workflow` PAT scope.

Replace this line (Trigger Railway deploy of this SHA step):

```
DID=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['serviceInstanceDeployV2'])")
```

with (already live on `deploy-mcp-railway.yml` and `deploy-api.yml`):

```
DID=$(echo "$RESP" | python3 -c "import json,sys; resp=json.load(sys.stdin); errors=resp.get('errors') or []; deploy_id=(resp.get('data') or {}).get('serviceInstanceDeployV2'); [print('::error::Railway GraphQL errors: '+json.dumps(errors), file=sys.stderr) for _ in [0] if errors]; (print(deploy_id) if deploy_id else (print('::error::Railway serviceInstanceDeployV2 returned no deployment id', file=sys.stderr), sys.exit(1)))")
```

This is documentation only — applying it does not change runtime until pasted into the workflow file.

Verified 2026-08-30:
- GHA 33223205060 crashed on NoneType; rollback showed Not Authorized.
- MCP GHA 33247249778 succeeded later with the same RAILWAY_TOKEN + robust parser.
- Agent deployed buywhere-api SHA ebd73cf7c via Project-Access-Token → 036409ad SUCCESS.
