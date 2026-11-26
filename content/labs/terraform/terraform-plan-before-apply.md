---
id: terraform-plan-before-apply
title: Inspect a plan before applying
track: terraform
level: intermediate
mode: simulation
estimated_minutes: 25
prerequisites: [terraform-variables-outputs-state, terraform-modules-and-refactoring]
objectives:
  - Predict the plan symbols and the add, change and destroy counts before you change the configuration.
  - Rename a resource without destroying the real object, using a moved block.
  - Recognise drift — a change made outside Terraform — and decide how to resolve it.
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each experiment and compared it with the plan" }
  - { id: challenges, text: "The two challenges below show Done" }
simulation:
  id: terraform-plan-diff
  challenges: [rename-no-destroy, drift-fixed]
resources:
  - title: Refactoring modules (moved blocks)
    url: https://developer.hashicorp.com/terraform/language/modules/develop/refactoring
    publisher: HashiCorp
    type: documentation
    level: intermediate
    official: true
    why: Why a changed address means destroy-and-create by default, how moved blocks prevent it, and why to keep them.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model with one invented resource type. Its rules follow Terraform's documentation (a plan proposes changes that make the remote objects match the configuration; a changed address means destroy and create unless a moved block relocates the object; changes made outside Terraform are drift, which a normal plan would revert). Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the plan-diff simulation like a scientist: **predict** what the plan will say, **change** the configuration or the real world, and **compare** with the plan before you press apply. You finish when the server has verified both challenges.

This lab runs in your browser. It is a model of Terraform, not Terraform itself; the lessons *Variables, validation, outputs and state* and *Modules, reuse and safe refactoring* show real plans from the Terraform CLI.

## Steps

### 1. Rename without destroying

Choose the scenario **Rename a resource**. Two servers were applied earlier. Look at the three panels: **Configuration (main.tf)**, **State** and **Real world**. Before you touch anything, write down:

- Terraform tracks objects by address. If you rename `server.web` to `server.frontend` in the configuration, which address is new and which has disappeared?
- What will the plan line say: how many to add, to change and to destroy?

Use **Rename address**, **New address** and **Rename**, then read the plan. Do **not** apply yet.

- Was your prediction right? What would happen to the real server `srv-1` if you applied now?
- How can you tell Terraform that the object did not go away, it only changed its address?

Make your change, read the plan again, and apply only when the plan shows that nothing will be destroyed. Afterwards, compare the IDs in the **State** panel with the ones you started with.

### 2. Resolve the drift

Choose **Someone changed it by hand**. After the last apply, someone resized the database server in the cloud console.

- Before you look at the plan, which panel no longer agrees with the other two?
- What will a plan propose for `server.db`: an update, a replacement, or nothing?

Read the plan. Then decide who is right: the code or the person who made the change.

- If the code is right, what does **terraform apply** do to the real server?
- If the change was right, what must you change first, and why do you still need to apply afterwards to get a plan with no changes?

Try one way, then reset and try the other. You can also use **Resize by hand** and **Delete by hand** on the other server and predict each plan before you read it.

## Simulation

```simulation terraform-plan-diff
```

## Reset

Each scenario has a **Reset** button that restores its starting state. Your verified challenges stay recorded.

## What you practised

A plan compares the configuration, the state and the real objects, and it is the last safe moment to catch a mistake. A rename is a destroy and a create unless a `moved` block says where the object went, and drift is resolved either by applying the code again or by updating the code to match reality.
