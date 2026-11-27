"""Canteen pre-order cart: the part of the app that adds up an order."""


class Cart:
    def __init__(self):
        self.lines = []          # (item name, unit price in rupees, quantity)
        self.discounts = []      # discount codes applied, in order

    def add(self, name, price, quantity):
        self.lines.append((name, price, quantity))

    def apply_discount(self, code):
        """STAFF10 takes 10% off the whole order."""
        if code != "STAFF10":
            raise ValueError(f"unknown discount code {code}")
        self.discounts.append(code)

    def total(self):
        amount = sum(price * quantity for _, price, quantity in self.lines)
        for _ in self.discounts:
            amount = amount * 0.9
        return amount
