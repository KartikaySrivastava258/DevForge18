"""Canteen pre-order cart: the part of the app that adds up an order."""

from decimal import ROUND_HALF_UP, Decimal


class Cart:
    def __init__(self):
        self.lines = []          # (item name, unit price in rupees, quantity)
        self.discounts = []      # discount codes applied, in order

    def add(self, name, price, quantity):
        if not isinstance(quantity, int) or quantity < 1:
            raise ValueError("quantity must be a whole number of at least 1")
        self.lines.append((name, price, quantity))

    def apply_discount(self, code):
        """STAFF10 takes 10% off the whole order."""
        if code != "STAFF10":
            raise ValueError(f"unknown discount code {code}")
        if code not in self.discounts:  # applying the same code again (e.g. a page refresh) changes nothing
            self.discounts.append(code)

    def total(self):
        """The amount to pay, in rupees, rounded to the paisa. Decimal avoids binary floating-point error."""
        amount = sum(Decimal(str(price)) * quantity for _, price, quantity in self.lines)
        for _ in self.discounts:
            amount = amount * Decimal("0.9")
        return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
