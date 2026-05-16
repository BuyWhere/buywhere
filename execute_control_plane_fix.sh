#!/bin/bash
#
# Control-plane fix execution script for BUY-18048
# Run this script once the Paperclip API recovers
#

set -e

echo "Starting control-plane fix for BUY-18048..."

# Configuration
PAPERCLIP_API_URL="http://paperclipclean-production.up.railway.app:3100"
PAPERCLIP_API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5YzE3NTAxNy1jMDk3LTQ1NGUtOGYzYy04OGVjYjBkZjBhZTMiLCJjb21wYW55X2lkIjoiMTc3YmM4MDUtZTNjOC00MzM2LTg0Y2ItOGUxZTQ4MmQ1YTE3IiwiYWRhcHRlcl90eXBlIjoib3BlbmNvZGVfbG9jYWwiLCJydW5faWQiOiI4NDFhYzUwMy00YzhjLTRhNGYtODkyYS0yNTVjNDlkZmZkOTUiLCJpYXQiOjE3Nzg4NzIyMjYsImV4cCI6MTc3OTA0NTAyNiwiaXNzIjoicGFwZXJjbGlwIiwiYXVkIjoicGFwZXJjbGlwLWFwaSJ9.p9m-Qj225C1XRT-Ln7hm3z_adNgOsO5aXT6Mu_MT6x0"
PAPERCLIP_COMPANY_ID="177bc805-e3c8-4336-84cb-8e1e482d5a17"

# Check API availability
echo "Checking API availability..."
if ! curl -s --head "$PAPERCLIP_API_URL/api/agents/me" > /dev/null; then
    echo "Error: Paperclip API is not reachable"
    exit 1
fi

# Get issues with problematic states
echo "Retrieving issues..."
curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
     "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues?status=in_progress,blocked,done,cancelled" \
     > issues.json

# Process issues and apply fixes
echo "Processing issues and applying fixes..."
python3 << 'EOF'
import json
import sys
from recovery_fix_logic import RecoveryFixLogic

# Load issues
with open('issues.json', 'r') as f:
    issues_data = json.load(f)
    issues = issues_data.get('issues', [])

fixer = RecoveryFixLogic()

# Analyze and fix issues
successful_run_issues = fixer.analyze_successful_run_missing_state(issues)
stale_recovery_issues = fixer.analyze_stale_recovery_issues(issues)

# Apply fixes
for issue in successful_run_issues + stale_recovery_issues:
    payload = fixer.generate_fix_payload(issue)
    
    # Make API call to update issue
    import requests
    
    url = f"{sys.argv[1]}/api/issues/{issue['id']}"
    headers = {
        "Authorization": f"Bearer {sys.argv[2]}",
        "Content-Type": "application/json",
        "X-Paperclip-Run-Id": "BUY-18048-fix-execution"
    }
    
    response = requests.patch(url, headers=headers, json=payload)
    
    if response.status_code in [200, 201, 204]:
        print(f"✓ Fixed {issue['identifier']}: {payload.get('status', 'commented')}")
    else:
        print(f"✗ Failed to fix {issue['identifier']}: {response.status_code}")

# Generate report
report = fixer.create_implementation_report(successful_run_issues, stale_recovery_issues)
with open('fix_report.json', 'w') as f:
    json.dump(report, f, indent=2)

print(f"Fix completed. Report saved to fix_report.json")
EOF

# Generate final report
echo "Generating final report..."
python3 -c "
from recovery_fix_logic import RecoveryFixLogic
import json

# Load the fix results and create final report
with open('issues.json', 'r') as f:
    issues_data = json.load(f)
    issues = issues_data.get('issues', [])

fixer = RecoveryFixLogic()
successful_run_issues = fixer.analyze_successful_run_missing_state(issues)
stale_recovery_issues = fixer.analyze_stale_recovery_issues(issues)

report = fixer.create_implementation_report(successful_run_issues, stale_recovery_issues)

print('=== CONTROL-PLANE FIX REPORT ===')
print(json.dumps(report, indent=2))

with open('final_fix_report.json', 'w') as f:
    json.dump(report, f, indent=2)

echo 'Fix report saved to final_fix_report.json'
"

echo "Control-plane fix completed successfully!"
