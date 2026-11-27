# Release 1.1.0

Released 2026-02-06. Bug fixes for the canteen pre-order cart.

## Fixed

- CAFE-1 Applying the same discount code twice (for example by refreshing the page) no longer takes the
  discount twice. **Critical:** each refresh had taken another 10% off.
- CAFE-2 Totals are calculated in exact decimal rupees and rounded to the paisa (99.90, not 99.89999999999999).
- CAFE-3 A quantity below 1 is refused instead of sending an empty line to the kitchen.

## Known issues

Two bugs are triaged for later releases; see the project board.
