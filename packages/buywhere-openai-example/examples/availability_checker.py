"""
Stock monitoring agent that checks product availability and price changes.

Usage:
  export BUYWHERE_API_KEY="bw_live_xxx"
  python availability_checker.py
"""

import os
import json
from openai import OpenAI
from buywhere_openai import BuyWhereTools, BuyWhereClient


def main():
    api_key = os.environ.get("BUYWHERE_API_KEY")
    if not api_key:
        raise RuntimeError("Set BUYWHERE_API_KEY environment variable")

    client = OpenAI()
    bw = BuyWhereClient(api_key=api_key)

    messages = [
        {
            "role": "system",
            "content": (
                "You are a product availability and price monitoring agent. "
                "Use the BuyWhere tools to check product details and current pricing. "
                "Report the current price, availability status, and any deals or discounts."
            ),
        },
        {
            "role": "user",
            "content": (
                "Check the current price and availability of Sony WH-1000XM5 "
                "headphones in Singapore. Also check if there are any current deals."
            ),
        },
    ]

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        tools=BuyWhereTools,
        tool_choice="auto",
    )

    msg = response.choices[0].message

    if msg.tool_calls:
        messages.append(msg)

        for tool_call in msg.tool_calls:
            result = bw.dispatch(tool_call.model_dump())
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result, indent=2),
            })

        final = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
        )
        print(final.choices[0].message.content)
    else:
        print(msg.content)


if __name__ == "__main__":
    main()
