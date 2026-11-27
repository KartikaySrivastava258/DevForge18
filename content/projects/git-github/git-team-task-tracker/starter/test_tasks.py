import unittest

import tasks


class AddTests(unittest.TestCase):
    def test_ids_increase_from_one(self):
        items = []
        self.assertEqual(tasks.add(items, "First"), 1)
        self.assertEqual(tasks.add(items, "Second"), 2)
        self.assertEqual([t["title"] for t in items], ["First", "Second"])

    def test_title_is_required(self):
        with self.assertRaises(ValueError):
            tasks.add([], "   ")


class FormatTests(unittest.TestCase):
    def test_open_and_done_tasks(self):
        self.assertEqual(tasks.format_task({"id": 3, "title": "Book a room", "done": False}), "[ ] 3. Book a room")
        self.assertEqual(tasks.format_task({"id": 4, "title": "Send slides", "done": True}), "[x] 4. Send slides")


if __name__ == "__main__":
    unittest.main()
