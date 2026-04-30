#!/usr/bin/env python3
"""
Remove email addresses from AWS SES suppression list.

Usage:
    AWS_REGION=us-east-1 python3 scripts/ses_remove_suppression.py

Requires AWS credentials with ses:DeleteSuppressedDestination and
ses:GetSuppressedDestination IAM permissions.
"""
import os
import boto3
from botocore.exceptions import ClientError as ClientException

REGION = os.getenv("AWS_REGION", "us-east-1")
EMAILS = [
    "pete@theneurondaily.com",
    "hello@aitoolreport.com",
]

def main():
    client = boto3.client("sesv2", region_name=REGION)
    print(f"Removing suppressed destinations from SES in region: {REGION}")
    print(f"Emails to process: {EMAILS}")

    success = 0
    failed = 0
    for email in EMAILS:
        try:
            client.delete_suppressed_destination(EmailAddress=email)
            print(f"✓ Removed {email}")
            success += 1
        except ClientException as e:
            print(f"Error removing {email}: {e}")
            failed += 1

    print(f"Successfully processed {success}/{len(EMAILS)} email addresses")
    if failed > 0:
        print("Some email addresses failed to process")
        exit(1)

if __name__ == "__main__":
    main()
