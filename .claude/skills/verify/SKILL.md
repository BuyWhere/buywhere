---
name: verify
summary: Verify the Next.js web surface from a deploy-like scratch copy when the repo's root Python app/ directory masks src/app locally.
---

# Verify the BuyWhere web app

1. Establish the diff with `git diff HEAD --stat`.
2. Build a run-owned scratch copy with `git archive HEAD`, then copy changed web files into it.
3. Remove the scratch copy's root `app/` Python package. Next.js otherwise selects it instead of `src/app` and every web route returns 404; production excludes it through `.dockerignore`.
4. Symlink the checkout's `node_modules` into the scratch copy.
5. From the scratch root, run `NODE_ENV=development BUYWHERE_INTERNAL_ORIGIN=https://buywhere.ai ./node_modules/.bin/next dev --hostname 127.0.0.1 --port <unused-port>`.
6. Drive the affected route with Playwright at its acceptance viewports. Capture a full-page screenshot plus DOM measurements for visible content, clipping (`scrollHeight <= clientHeight`), horizontal overflow, failed network requests, and interactive controls.
7. Stop the server and keep temporary captures under `PAPERCLIP_RUN_SCRATCH_DIR`.
