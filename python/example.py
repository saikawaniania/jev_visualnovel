"""CLI sample: send a support-ticket-style message to Jev and print the
structured answers (Choice, Score, Noul) asked in a single request.

Usage:
    python example.py
    python example.py "some other message to evaluate"
"""

import sys

from jevkit import Choice, Noul, Score, get_client

DEFAULT_TICKET = (
    "Hi, I've been trying to connect my Stripe account for 3 days and the "
    "integration keeps failing. I'm losing sales. Please help ASAP."
)


def main() -> None:
    ticket = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TICKET

    client = get_client()

    response = client.system_one(
        state=ticket,
        questions={
            "department": Choice(
                instructions="Which team should handle this",
                criteria={
                    "billing": "Payment or subscription issues",
                    "technical": "Bugs or integration problems",
                    "sales": "Pricing or account questions",
                },
            ),
            "frustration": Score(
                instructions="How frustrated the customer appears",
                criteria=[
                    "Calm, just stating facts",
                    "Frustrated but civil",
                    "Very angry, strong language",
                ],
            ),
            "is_urgent": Noul(
                instructions="The message conveys urgency or time-sensitivity",
            ),
        },
    )

    print(f"state: {ticket}\n")

    department = response.answers["department"]
    print(f"department: {department.choice} (confidence={department.confidence:.2f})")
    print(f"  probabilities: {department.probabilities}")

    frustration = response.answers["frustration"]
    nearest_level = round(frustration.score)
    print(
        f"frustration: {frustration.legend[nearest_level]} "
        f"(score={frustration.score:.2f}, confidence={frustration.confidence:.2f})"
    )
    print(f"  probabilities: {frustration.probabilities}")

    is_urgent = response.answers["is_urgent"]
    print(f"is_urgent: {is_urgent.noul:.2f}")

    print(f"\nusage: {response.usage}")


if __name__ == "__main__":
    main()
