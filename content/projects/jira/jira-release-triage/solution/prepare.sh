#!/usr/bin/env bash
# Replays the history of release 1.1.0 from the starter: import, three fixes whose commit messages start
# with the Jira key, release notes, annotated tag. DevForge's tests run it inside a copy of the solution
# folder, with STARTER_DIR pointing at the starter.
set -euo pipefail
: "${STARTER_DIR:?set STARTER_DIR to a copy of the starter folder}"
if git rev-parse --git-dir > /dev/null 2>&1; then
  echo "Run this in a fresh copy of the solution folder, outside any Git repository." >&2
  exit 1
fi
final="$(mktemp -d)"
trap 'rm -rf "$final"' EXIT
cp -a . "$final"
find . -mindepth 1 -delete
cp "$STARTER_DIR/cart.py" "$STARTER_DIR/test_cart.py" "$STARTER_DIR/export.py" .
cp "$final/README.md" README.md

git init -q -b main
git config user.name "Example Maintainer"
git config user.email "maintainer@example.edu"
git add -A
git commit -q -m "Import the canteen pre-order app"

git apply <<'PATCH'
diff --git a/cart.py b/cart.py
index 2d02d81..b3be9d9 100644
--- a/cart.py
+++ b/cart.py
@@ -13,7 +13,8 @@ class Cart:
         """STAFF10 takes 10% off the whole order."""
         if code != "STAFF10":
             raise ValueError(f"unknown discount code {code}")
-        self.discounts.append(code)
+        if code not in self.discounts:  # applying the same code again (e.g. a page refresh) changes nothing
+            self.discounts.append(code)
 
     def total(self):
         amount = sum(price * quantity for _, price, quantity in self.lines)
diff --git a/test_cart.py b/test_cart.py
index 2002551..1806ea6 100644
--- a/test_cart.py
+++ b/test_cart.py
@@ -16,6 +16,13 @@ class CartTests(unittest.TestCase):
         cart.apply_discount("STAFF10")
         self.assertEqual(cart.total(), 90)
 
+    def test_same_discount_twice_counts_once(self):
+        cart = Cart()
+        cart.add("Thali", 100, 1)
+        cart.apply_discount("STAFF10")
+        cart.apply_discount("STAFF10")
+        self.assertEqual(cart.total(), 90)
+
 
 if __name__ == "__main__":
     unittest.main()
PATCH
git commit -q -am "CAFE-1 Apply a discount code only once"

git apply <<'PATCH'
diff --git a/cart.py b/cart.py
index b3be9d9..6039f8b 100644
--- a/cart.py
+++ b/cart.py
@@ -1,5 +1,7 @@
 """Canteen pre-order cart: the part of the app that adds up an order."""
 
+from decimal import ROUND_HALF_UP, Decimal
+
 
 class Cart:
     def __init__(self):
@@ -17,7 +19,8 @@ class Cart:
             self.discounts.append(code)
 
     def total(self):
-        amount = sum(price * quantity for _, price, quantity in self.lines)
+        """The amount to pay, in rupees, rounded to the paisa. Decimal avoids binary floating-point error."""
+        amount = sum(Decimal(str(price)) * quantity for _, price, quantity in self.lines)
         for _ in self.discounts:
-            amount = amount * 0.9
-        return amount
+            amount = amount * Decimal("0.9")
+        return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
diff --git a/test_cart.py b/test_cart.py
index 1806ea6..d2a471b 100644
--- a/test_cart.py
+++ b/test_cart.py
@@ -1,4 +1,5 @@
 import unittest
+from decimal import Decimal
 
 from cart import Cart
 
@@ -23,6 +24,11 @@ class CartTests(unittest.TestCase):
         cart.apply_discount("STAFF10")
         self.assertEqual(cart.total(), 90)
 
+    def test_total_is_exact_to_the_paisa(self):
+        cart = Cart()
+        cart.add("Juice", 33.30, 3)
+        self.assertEqual(cart.total(), Decimal("99.90"))
+
 
 if __name__ == "__main__":
     unittest.main()
PATCH
git commit -q -am "CAFE-2 Compute totals in exact decimal rupees"

git apply <<'PATCH'
diff --git a/cart.py b/cart.py
index 6039f8b..b64a709 100644
--- a/cart.py
+++ b/cart.py
@@ -9,6 +9,8 @@ class Cart:
         self.discounts = []      # discount codes applied, in order
 
     def add(self, name, price, quantity):
+        if not isinstance(quantity, int) or quantity < 1:
+            raise ValueError("quantity must be a whole number of at least 1")
         self.lines.append((name, price, quantity))
 
     def apply_discount(self, code):
diff --git a/test_cart.py b/test_cart.py
index d2a471b..c700bd3 100644
--- a/test_cart.py
+++ b/test_cart.py
@@ -29,6 +29,12 @@ class CartTests(unittest.TestCase):
         cart.add("Juice", 33.30, 3)
         self.assertEqual(cart.total(), Decimal("99.90"))
 
+    def test_quantity_must_be_at_least_one(self):
+        cart = Cart()
+        with self.assertRaises(ValueError):
+            cart.add("Chai", 15, 0)
+        self.assertEqual(cart.lines, [])
+
 
 if __name__ == "__main__":
     unittest.main()
PATCH
git commit -q -am "CAFE-3 Refuse a quantity below one"

cp "$final/RELEASE_NOTES.md" "$final/export.json" .
git add RELEASE_NOTES.md export.json
git commit -q -m "Release notes and board export for 1.1.0"
git tag -a v1.1.0 -m "Release 1.1.0"

diff -r --exclude=.git "$final" . > /dev/null || { echo "replayed history does not match the solution files" >&2; diff -r --exclude=.git "$final" . >&2; exit 1; }
git log --oneline --decorate
