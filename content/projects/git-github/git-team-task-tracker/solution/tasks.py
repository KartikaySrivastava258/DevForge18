"""A small command-line task tracker for a study group or a project team.

Usage:
    python3 tasks.py add "Write the report outline"
    python3 tasks.py list
    python3 tasks.py list --open
    python3 tasks.py done 2

Tasks are stored as JSON in tasks.json in the current folder, or in the file named by the
TASKS_FILE environment variable.
"""

import json
import os
import sys


def data_file():
    return os.environ.get("TASKS_FILE", "tasks.json")


def load():
    try:
        with open(data_file(), encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return []


def save(tasks):
    with open(data_file(), "w", encoding="utf-8") as f:
        json.dump(tasks, f, indent=2)


def add(tasks, title):
    title = title.strip()
    if not title:
        raise ValueError("a task needs a title")
    next_id = max((t["id"] for t in tasks), default=0) + 1
    tasks.append({"id": next_id, "title": title, "done": False})
    return next_id


def complete(tasks, task_id):
    for task in tasks:
        if task["id"] == task_id:
            task["done"] = True
            return task
    raise KeyError(task_id)


def open_tasks(tasks):
    return [task for task in tasks if not task["done"]]


def format_task(task):
    mark = "x" if task["done"] else " "
    return f"[{mark}] {task['id']}. {task['title']}"


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip())
        return 2
    command, args = argv[1], argv[2:]
    tasks = load()
    if command == "add" and len(args) == 1:
        task_id = add(tasks, args[0])
        save(tasks)
        print(f"Added task {task_id}.")
        return 0
    if command == "list" and args in ([], ["--open"]):
        for task in open_tasks(tasks) if args else tasks:
            print(format_task(task))
        return 0
    if command == "done" and len(args) == 1 and args[0].isdigit():
        try:
            complete(tasks, int(args[0]))
        except KeyError:
            print(f"No task with id {args[0]}.", file=sys.stderr)
            return 1
        save(tasks)
        print(f"Completed task {args[0]}.")
        return 0
    print(f"Unknown command: {' '.join(argv[1:])}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
