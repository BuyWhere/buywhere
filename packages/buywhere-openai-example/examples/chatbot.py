"""
Simple product search chatbot using OpenAI Chat Completions + BuyWhere.

Usage:
  export BUYWHERE_API_KEY="bw_live_xxx"
  python chatbot.py
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
                "You are a helpful shopping assistant. Use the BuyWhere tools to "
                "search for products, compare prices, and find deals. "
                "Always respond in natural language with the results."
            ),
        },
        {"role": "user", "content": "Find me the cheapest wireless headphones under $100 SGD"},
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
