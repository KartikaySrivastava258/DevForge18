# One rendered configuration file per service and environment, e.g. out/staging/timetable.json.
resource "local_file" "service" {
  for_each = var.services

  filename        = "${path.module}/out/${var.environment}/${each.key}.json"
  file_permission = "0644"
  content = jsonencode({
    service     = each.key
    environment = var.environment
    port        = each.value.port
    replicas    = each.value.replicas
  })
}
