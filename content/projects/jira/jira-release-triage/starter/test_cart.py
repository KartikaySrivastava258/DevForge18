import unittest

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


if __name__ == "__main__":
    unittest.main()
