# VidMee QA 4-Field Intake Gate — Implementation Guide

**Issue:** BUY-71466  
**Parent:** BUY-71048  
**RFC:** BUY-70779-qa-evidence-standard-rfc.md  
**Status:** Implementation delivered

---

## Background

The VidMee QA pipeline was reopening closed UX issues (BUY-70779) based on contrast/placeholder flags without providing sufficient evidence for independent verification. Each reopen was refuted with live WCAG AA PASS measurements, indicating false positives.

### Root Cause

The pipeline emitted flags with incomplete evidence:
- No DOM selector or rendered snippet
- No run timestamp or deploy SHA
- No batch row index for replay
- No computed color tokens

### Solution

A 4-field intake gate that:
1. **Validates** each flag contains all RFC-required fields
2. **Downgrades** incomplete flags to informational comments (no reopen)
3. **Passes through** non-contrast/placeholder/broken-image issues unchanged

---

## RFC-Required Fields

| Field | Purpose | Validation |
|-------|---------|------------|
| `renderedEvidence` | DOM snippet or CSS selector + screenshot region | Non-empty, not opaque hash |
| `runContext` | VidMee run timestamp + deploy SHA + deploy time | Valid timestamp + SHA format |
| `batchRowIndex` | Row index in QA batch for replay | Integer ≥ 0 |
| `computedTokens` | Text/bg color tokens or resolved hex pair | Non-empty object |

---

## Intake Gate Rule

```
IF issue.category ∈ {contrast, placeholder, broken-image} THEN
  IF ALL four fields present AND meaningful THEN
    → TRIGGER reopen
  ELSE
    → DOWNGRADE to informational comment (no reopen)
ELSE
  → PASS THROUGH (no gate applied)
END
```

### Meaningful Value Check

A field is considered meaningful if:
- Not `null`, `undefined`, or empty string
- Not a bare opaque hash (8-64 lowercase hex characters)

---

## Implementation

### Core Module

**Location:** `src/lib/vidmee-qa-intake.mjs`

```javascript
import { runIntakeGate } from './vidmee-qa-intake.mjs';

// Process VidMee output
const result = runIntakeGate(vidmeeOutputJson);

// result.reopen     → issues ready to reopen
// result.downgrade  → issues to comment only
// result.passThrough → non-gated issues
```

### Functions

| Function | Purpose |
|----------|---------|
| `validateIssueFields(issue)` | Check if all 4 RFC fields present |
| `classifyIssueCategory(issue)` | Map to contrast/placeholder/broken-image/other |
| `gateIssue(issue)` | Apply gate logic, return action |
| `runIntakeGate(vidmeeResult)` | Batch process full VidMee output |
| `enrichIssue(...)` | Build 4-field evidence block for an issue |

---

## Integration with Reopen Automation

The reopen automation script should:

1. **Parse** `vidmee inspect <url>` output
2. **Call** `runIntakeGate(vidmeeResult)`
3. **Branch** on result:
   ```javascript
   for (const issue of result.reopen) {
     await reopenIssue(issue.id, enrichedEvidence);
   }
   for (const issue of result.downgrade) {
     await postComment(issue.id, `⚠️ [INFORMATIONAL] ${issue.title}\n\nMissing: ${issue._gate.missingFields.join(', ')}`);
   }
   // result.passThrough → process normally
   ```

---

## BUY-70779 Re-run

**Selector set:** `data/eval/vidmee-buy70779-selectors.json`

Run the re-validation:

```bash
node scripts/run-vidmee-buy70779-rerun.mjs
```

Expected outcome: **Zero false auto-reopens** after 4-field gate is enforced.

---

## Flag Categories Subject to Gate

- **contrast** — `axe_rule: color-contrast` or `category: color`
- **placeholder** — titles containing "placeholder" or "empty"
- **broken-image** — titles containing "broken", "missing image", "404"

All other issue categories pass through unchanged.

---

## Acceptance Criteria

- [x] Module `vidmee-qa-intake.mjs` created with all gate functions
- [x] BUY-70779 selector set documented in `data/eval/vidmee-buy70779-selectors.json`
- [x] Reopen automation guard module available via `runIntakeGate()`
- [x] Re-run BUY-70779 selectors → 0 false reopens (`data/eval/vidmee-buy70779-rerun/vidmee-buy70779-rerun-2026-08-18T18-14-41.json`)
- [x] Document this intake filter for contrast/placeholder/broken-image flags

---

## References

- BUY-70779 — Original contrast issue (reopened 4×)
- BUY-71048 — Parent: Reconfigure VidMee pipeline
- BUY-71032 — Escalation: False positives violation
- BUY-71466 — This implementation issue
