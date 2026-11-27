---
id: tf-dev-environment
track: terraform
title: Reproducible development environment
level: beginner
estimated_hours: 4
prerequisites: [terraform-first-configuration, terraform-variables-outputs-state, terraform-import-and-drift]
related_tracks: [docker, redis]
user_stories:
  - As a new developer on the campus API, I want one terraform apply to give me the same Redis, network and settings file as everyone else so that I can start coding on my first day.
  - As a team lead, I want the environment's versions pinned — providers and image — so that "works on my machine" means the same thing on every machine.
  - As a developer, I want bad input refused before anything is created so that a typo does not leave half an environment behind.
acceptance_criteria:
  - terraform fmt -check and terraform validate pass, and required_providers pins exact versions of kreuzwerker/docker and hashicorp/local.
  - The variables project and redis_port are validated; a plan with project=Campus_API or redis_port=80 is refused by validation, while valid values plan successfully.
  - terraform apply creates the network NAME-dev and the container NAME-redis (redis:7.4-alpine pinned by digest) attached to it, published on 127.0.0.1:redis_port only, and Redis answers PING there.
  - The outputs network_name, redis_container, redis_url and env_file have the expected values, and the generated dev.env contains PROJECT and the same REDIS_URL.
  - A second plan right after apply shows no changes.
  - terraform destroy removes the container, the network and the generated file, and keeps the Redis image (keep_locally).
rubric:
  - { criterion: "Reproducibility", excellent: "Exact provider versions, a committed lock file, the image pinned by digest, and a README that explains how to recreate and remove the environment in two commands.", good: "Providers and image pinned; apply and destroy work on a clean machine.", needs_work: "Unpinned providers or latest images; manual steps needed after apply." }
  - { criterion: "Inputs and outputs", excellent: "Every variable has a type, a description and validation with an error message that says how to fix the value; outputs are described and are exactly what the application needs.", good: "Both variables validated; all four outputs correct.", needs_work: "Hard-coded names and ports, or bad input only noticed by Docker halfway through apply." }
  - { criterion: "Safety", excellent: "Published on 127.0.0.1 only, every object prefixed with the project name, a second plan is empty, and destroy leaves shared images alone.", good: "Idempotent and cleans up after itself.", needs_work: "Ports open to the network, or a plan that always wants to change something." }
hints:
  - "terraform providers lists each provider with its version constraint — an empty constraint means \"whatever is newest\"."
  - "A validation block has a condition and an error_message; can(regex(\"^[a-z][a-z0-9-]{2,20}$\", var.project)) is true only for valid names."
  - In the docker_container resource, networks_advanced attaches the container to a network and the ports block's ip argument chooses the address it is published on.
  - "local_file writes the settings file; build its content from the same variables as the container, so the two can never disagree."
  - If a second plan wants to change something, read which attribute it names and compare it with your configuration.
stretch_goals:
  - Add a second service (for example PostgreSQL) on the same network and put its URL in dev.env.
  - Commit .terraform.lock.hcl with hashes for Linux, macOS and Windows (terraform providers lock -platform=…).
  - Import a Redis container someone created by hand, as in the lesson on import and drift, instead of creating a new one.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

New developers on the campus API spend their first day getting Redis running, and every laptop ends up a little
different. Describe the development environment with Terraform instead: a private Docker network, a Redis
container on it, and a generated `dev.env` file that tells the application where Redis is. `terraform apply`
creates it, `terraform destroy` removes it, and both work the same way on every machine.

The starter is a colleague's first attempt: unpinned providers and image, a hard-coded port open to the network,
no validation, no settings file and no outputs. `README.md` in the starter lists the names and values the check
relies on.

The check needs **Docker only**: it runs Terraform 1.15.6 from the official `hashicorp/terraform` image, pinned
by digest, against your machine's Docker engine, on a temporary copy of your folder and with a project name unique
to the run. It formats, initialises, validates, plans with good and bad input, applies, inspects the network,
container, port and settings file, plans again and destroys. It takes under a minute once the providers and the
Redis image are downloaded.

## Getting started

1. Copy the starter folder and read `README.md`. Use Terraform 1.15.6 installed as in the first Terraform
   lesson (the check runs the same version from its official image).

2. Pin the providers, add the variables and their validation, and try a bad value:

   ```bash
   terraform init
   terraform plan -var project=Campus_API
   ```

3. Finish the network, container and settings file, then apply, check and destroy:

   ```bash
   terraform apply -var project=campus
   cat dev.env && docker ps --filter name=campus-
   terraform plan -var project=campus      # should say: No changes
   terraform destroy -var project=campus
   ```

4. Run the check:

   ```bash
   bash check.sh path/to/your/project
   ```
