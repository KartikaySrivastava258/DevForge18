import unittest
from decimal import Decimal

from cart import Cart


class CartTests(unittest.TestCase):
    def test_adds_up_lines(self):
        cart = Cart()
        cart.add("Masala dosa", 60, 2)
        cart.add("Chai", 15, 1)
        self.assertEqual(cart.total(), 135)

    def test_staff_discount(self):
        cart = Cart()
        cart.add("Thali", 100, 1)
        cart.apply_discount("STAFF10")
        self.assertEqual(cart.total(), 90)

    def test_same_discount_twice_counts_once(self):
        cart = Cart()
        cart.add("Thali", 100, 1)
        cart.apply_discount("STAFF10")
        cart.apply_discount("STAFF10")
        self.assertEqual(cart.total(), 90)

    def test_total_is_exact_to_the_paisa(self):
        cart = Cart()
        cart.add("Juice", 33.30, 3)
        self.assertEqual(cart.total(), Decimal("99.90"))

    def test_quantity_must_be_at_least_one(self):
        cart = Cart()
        with self.assertRaises(ValueError):
            cart.add("Chai", 15, 0)
        self.assertEqual(cart.lines, [])


if __name__ == "__main__":
    unittest.main()
