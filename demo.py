"""
<ai-context>
    requirement: DEMO-001 (github)
    reason: Demo script to test the provenance annotation convention
</ai-context>
"""

TAX_RATES = {
    "standard": 0.20,
    "reduced": 0.05,
    "zero": 0.00,
}


def calculate_tax(order: dict) -> float:
    """
    <ai-context>
        requirement: DEMO-002 (github)
        invariant: Result must never be negative
        reason: Core tax calculation — applies rate based on order category
    </ai-context>
    """
    total = order.get("total", 0)
    rate = TAX_RATES.get(order.get("tax_band", "standard"), 0.20)
    tax = total * rate

    """
    <ai-context>
        requirement: DEMO-003 (github, 2024-Q1)
        reason: HMRC food exemptions introduced — basic food is zero-rated
    </ai-context>
    <ai-context>
        requirement: DEMO-004 (github, 2025-Q3)
        reason: Sugar content threshold added — high-sugar foods excluded from exemption
        do-not-change: HMRC compliance — do not simplify this condition
    </ai-context>
    """
    if order.get("category") == "food" and order.get("sugar_content", 0) <= 2:
        tax = 0.0

    return max(tax, 0.0)  # invariant: never negative


def print_receipt(order: dict) -> None:
    """
    <ai-context>
        requirement: DEMO-005 (github)
        reason: Simple console receipt for demo purposes
    </ai-context>
    """
    tax = calculate_tax(order)
    total = order.get("total", 0)
    print(f"  Item     : {order.get('name', 'Unknown')}")
    print(f"  Category : {order.get('category', 'N/A')}")
    print(f"  Total    : £{total:.2f}")
    print(f"  Tax      : £{tax:.2f}")
    print(f"  To pay   : £{total + tax:.2f}")
    print()


if __name__ == "__main__":
    orders = [
        {"name": "Laptop",       "total": 1000.00, "tax_band": "standard", "category": "electronics"},
        {"name": "Plain bread",  "total": 2.50,    "tax_band": "zero",     "category": "food",        "sugar_content": 1},
        {"name": "Energy drink", "total": 3.00,    "tax_band": "reduced",  "category": "food",        "sugar_content": 8},
        {"name": "Olive oil",    "total": 6.00,    "tax_band": "zero",     "category": "food",        "sugar_content": 0},
    ]

    print("=== Provenance Demo — Tax Calculator ===\n")
    for order in orders:
        print_receipt(order)
