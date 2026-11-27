# terraform test runs every run block in order. command = plan: nothing is written, the logic is checked.

variables {
  environment = "staging"
}

run "one_file_per_service" {
  command = plan

  assert {
    condition     = length(local_file.service) == 2
    error_message = "expected one file per default service"
  }

  assert {
    condition     = local_file.service["timetable"].filename == "./out/staging/timetable.json"
    error_message = "files must be written to out/<environment>/<service>.json"
  }

  assert {
    condition     = jsondecode(local_file.service["library"].content).port == 8082
    error_message = "the rendered file must contain the service's port"
  }
}

run "rejects_unknown_environment" {
  command = plan

  variables {
    environment = "qa"
  }

  expect_failures = [var.environment]
}

run "rejects_privileged_port" {
  command = plan

  variables {
    services = { web = { port = 80, replicas = 1 } }
  }

  expect_failures = [var.services]
}
