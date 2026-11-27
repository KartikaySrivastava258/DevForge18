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


class CompleteTests(unittest.TestCase):
    def test_marks_only_that_task_done(self):
        items = [{"id": 1, "title": "A", "done": False}, {"id": 2, "title": "B", "done": False}]
        tasks.complete(items, 2)
        self.assertEqual([t["done"] for t in items], [False, True])

    def test_unknown_id_is_an_error(self):
        with self.assertRaises(KeyError):
            tasks.complete([{"id": 1, "title": "A", "done": False}], 7)


class OpenTasksTests(unittest.TestCase):
    def test_keeps_only_tasks_not_done(self):
        items = [{"id": 1, "title": "A", "done": True}, {"id": 2, "title": "B", "done": False}]
        self.assertEqual([t["id"] for t in tasks.open_tasks(items)], [2])


if __name__ == "__main__":
    unittest.main()
