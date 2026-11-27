---
id: tf-reusable-module
track: terraform
title: Reusable infrastructure module
level: intermediate
estimated_hours: 5
prerequisites: [terraform-modules-and-refactoring, terraform-variables-outputs-state, terraform-first-configuration]
related_tracks: [docker, nginx]
user_stories:
  - As an infrastructure developer, I want one module for "a small static site" so that a fix made once reaches every site instead of being copied into each.
  - As a colleague adding the exams site, I want to add one entry to a map so that I cannot break the existing sites while doing it.
  - As a module user, I want the module to refuse bad input with a clear message so that mistakes surface in the plan, not halfway through an apply.
acceptance_criteria:
  - terraform fmt -check -recursive and terraform validate pass, and the root module pins kreuzwerker/docker to 4.6.0.
  - "The module modules/static-site, called on its own, takes name, port, title and image_id and outputs url (http://127.0.0.1:port) and container_name."
  - The module's validation refuses a name with capitals or spaces, a port below 1024 and an empty title.
  - Applying the root configuration with two sites creates one container per site, named prefix-key, each serving its own page on 127.0.0.1:port only, and the output urls maps each site to its URL.
  - A second plan shows no changes; adding a third site plans exactly 1 to add, and removing a site plans exactly 1 to destroy.
  - terraform destroy removes the containers and keeps the shared nginx image.
rubric:
  - { criterion: "Module interface", excellent: "A few meaningful inputs with types, descriptions and validation; outputs that callers need; nothing hard-coded that a caller might change; a short README for the module.", good: "The documented inputs and outputs work and bad input is refused.", needs_work: "Every resource argument passed through, or values callers need hard-coded inside the module." }
  - { criterion: "Reuse", excellent: "for_each over a map, names derived from keys, one image shared by all sites, and the plan for a new site touches nothing else.", good: "One module block creates every site.", needs_work: "Copy and paste, or count, so that adding a site renumbers and replaces the others." }
  - { criterion: "Change safety", excellent: "moved blocks map the starter's resource addresses into the module, and the learner explains from the plan what is still replaced and why.", good: "Plans are read before every apply; a second plan is empty.", needs_work: "Applies without reading the plan; surprised by replacements." }
hints:
  - "Start with the module's variables.tf and outputs.tf — the interface — before writing its resource."
  - "for_each = var.sites gives each module instance the address module.site[\"timetable\"]; with count it would be module.site[0], and removing the first site would shift every other index."
  - "templatefile(\"${path.module}/index.html.tftpl\", { title = var.title, name = var.name }) renders the page; path.module keeps the path right whoever calls the module."
  - Run terraform init again after adding a module block — Terraform cannot plan with a module it has not installed.
  - "Test the module the way the check does: a tiny configuration in another folder with module \"x\" { source = \"../your-project/modules/static-site\" … } and terraform plan."
stretch_goals:
  - Add moved blocks from the starter's addresses (docker_container.timetable …) to the module instances, as in the lesson on modules and refactoring, apply the starter first, and read the plan — which changes are address moves and what is still replaced, and why?
  - Write a terraform test for the module (tests/*.tftest.hcl) with a run that expects the port validation to fail.
  - Add an optional input for extra container labels with a sensible default.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The campus runs small static sites — timetable, library and, from next week, exams — each as an nginx container
created by Terraform. Today every site is a copied resource block with its own small differences and mistakes.
Turn the copies into a **module**, `modules/static-site`, with a small validated interface, and create every
site from one `module` block driven by a map.

The starter's `README.md` lists the inputs, outputs and names the check relies on. The page template is provided.

The check needs **Docker only**: it runs Terraform 1.15.6 from the official `hashicorp/terraform` image, pinned
by digest, against your machine's Docker engine, on a temporary copy of your folder. It first calls your module
from a small configuration of its own — exactly as another team would — to test its inputs, outputs and
validation. Then it applies your root configuration with two sites on free ports, requests each page, plans
again, plans the addition and the removal of a site, and destroys everything.

## Getting started

1. Copy the starter folder and read `README.md` and `main.tf`.
2. Write the module's `variables.tf`, `main.tf` and `outputs.tf`, then replace the two copied containers with
   one `module "site"` block using `for_each`.
3. Try it:

   ```bash
   terraform init
   terraform plan
   terraform apply
   terraform output urls
   terraform plan -var 'sites={ timetable = { port = 8081, title = "Timetable" } }'   # what would be destroyed?
   terraform destroy
   ```

4. Run the check:

   ```bash
   bash check.sh path/to/your/project
   ```
