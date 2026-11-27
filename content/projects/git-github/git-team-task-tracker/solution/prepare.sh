#!/usr/bin/env bash
# Replays the history a team would create for this reference solution, starting from the starter:
# every change is made on its own branch and merged into main with a merge commit (as GitHub's
# "Create a merge commit" button does when a pull request is merged).
# DevForge's tests run it inside a copy of the solution folder, with STARTER_DIR pointing at the starter.
set -euo pipefail
: "${STARTER_DIR:?set STARTER_DIR to a copy of the starter folder}"
if git rev-parse --git-dir > /dev/null 2>&1; then
  echo "Run this in a fresh copy of the solution folder, outside any Git repository." >&2
  exit 1
fi
final="$(mktemp -d)"
trap 'rm -rf "$final"' EXIT
cp -a . "$final"                                   # the finished files, to compare at the end
find . -mindepth 1 -delete
cp -a "$STARTER_DIR"/. .

git init -q -b main
git config user.name "Example Student"
git config user.email "student@example.edu"
git add -A
git commit -q -m "Import the starter task tracker"

# Backlog item 1, on its own branch (in a team: push it and open a pull request).
git switch -q -c feature/done-command
git apply <<'PATCH'
diff --git a/tasks.py b/tasks.py
index cbe0ad7..515375d 100644
--- a/tasks.py
+++ b/tasks.py
@@ -3,6 +3,7 @@
 Usage:
     python3 tasks.py add "Write the report outline"
     python3 tasks.py list
+    python3 tasks.py done 2
 
 Tasks are stored as JSON in tasks.json in the current folder, or in the file named by the
 TASKS_FILE environment variable.
@@ -39,6 +40,14 @@ def add(tasks, title):
     return next_id
 
 
+def complete(tasks, task_id):
+    for task in tasks:
+        if task["id"] == task_id:
+            task["done"] = True
+            return task
+    raise KeyError(task_id)
+
+
 def format_task(task):
     mark = "x" if task["done"] else " "
     return f"[{mark}] {task['id']}. {task['title']}"
@@ -59,6 +68,15 @@ def main(argv):
         for task in tasks:
             print(format_task(task))
         return 0
+    if command == "done" and len(args) == 1 and args[0].isdigit():
+        try:
+            complete(tasks, int(args[0]))
+        except KeyError:
+            print(f"No task with id {args[0]}.", file=sys.stderr)
+            return 1
+        save(tasks)
+        print(f"Completed task {args[0]}.")
+        return 0
     print(f"Unknown command: {' '.join(argv[1:])}", file=sys.stderr)
     return 2
 
diff --git a/test_tasks.py b/test_tasks.py
index 18aedac..2af67dd 100644
--- a/test_tasks.py
+++ b/test_tasks.py
@@ -21,5 +21,16 @@ class FormatTests(unittest.TestCase):
         self.assertEqual(tasks.format_task({"id": 4, "title": "Send slides", "done": True}), "[x] 4. Send slides")
 
 
+class CompleteTests(unittest.TestCase):
+    def test_marks_only_that_task_done(self):
+        items = [{"id": 1, "title": "A", "done": False}, {"id": 2, "title": "B", "done": False}]
+        tasks.complete(items, 2)
+        self.assertEqual([t["done"] for t in items], [False, True])
+
+    def test_unknown_id_is_an_error(self):
+        with self.assertRaises(KeyError):
+            tasks.complete([{"id": 1, "title": "A", "done": False}], 7)
+
+
 if __name__ == "__main__":
     unittest.main()
PATCH
git commit -q -am "Add a done command that marks a task complete"
git switch -q main
git merge -q --no-ff --no-edit feature/done-command

# Backlog item 2.
git switch -q -c feature/list-open
git apply <<'PATCH'
diff --git a/tasks.py b/tasks.py
index 515375d..acc3ffb 100644
--- a/tasks.py
+++ b/tasks.py
@@ -3,6 +3,7 @@
 Usage:
     python3 tasks.py add "Write the report outline"
     python3 tasks.py list
+    python3 tasks.py list --open
     python3 tasks.py done 2
 
 Tasks are stored as JSON in tasks.json in the current folder, or in the file named by the
@@ -48,6 +49,10 @@ def complete(tasks, task_id):
     raise KeyError(task_id)
 
 
+def open_tasks(tasks):
+    return [task for task in tasks if not task["done"]]
+
+
 def format_task(task):
     mark = "x" if task["done"] else " "
     return f"[{mark}] {task['id']}. {task['title']}"
@@ -64,8 +69,8 @@ def main(argv):
         save(tasks)
         print(f"Added task {task_id}.")
         return 0
-    if command == "list" and not args:
-        for task in tasks:
+    if command == "list" and args in ([], ["--open"]):
+        for task in open_tasks(tasks) if args else tasks:
             print(format_task(task))
         return 0
     if command == "done" and len(args) == 1 and args[0].isdigit():
diff --git a/test_tasks.py b/test_tasks.py
index 2af67dd..ceda8bc 100644
--- a/test_tasks.py
+++ b/test_tasks.py
@@ -32,5 +32,11 @@ class CompleteTests(unittest.TestCase):
             tasks.complete([{"id": 1, "title": "A", "done": False}], 7)
 
 
+class OpenTasksTests(unittest.TestCase):
+    def test_keeps_only_tasks_not_done(self):
+        items = [{"id": 1, "title": "A", "done": True}, {"id": 2, "title": "B", "done": False}]
+        self.assertEqual([t["id"] for t in tasks.open_tasks(items)], [2])
+
+
 if __name__ == "__main__":
     unittest.main()
PATCH
git commit -q -am "Add list --open to show only unfinished tasks"
git switch -q main
git merge -q --no-ff --no-edit feature/list-open

# Backlog items 3 and 4.
git switch -q -c chore/review-setup
cp -a "$final/.github" .
cp "$final/.gitignore" .gitignore
git add .github .gitignore
git commit -q -m "Add a pull request template and CODEOWNERS, ignore task data"
cp "$final/README.md" README.md
git commit -q -am "Document the commands and how the team works"
git switch -q main
git merge -q --no-ff --no-edit chore/review-setup
git branch -q -d feature/done-command feature/list-open chore/review-setup

# The replayed history must end exactly at the reference files.
diff -r --exclude=.git "$final" . > /dev/null || { echo "replayed history does not match the solution files" >&2; diff -r --exclude=.git "$final" . >&2; exit 1; }

python3 tasks.py add "Try the tracker" > /dev/null   # creates tasks.json, which .gitignore keeps out
git log --oneline --graph
