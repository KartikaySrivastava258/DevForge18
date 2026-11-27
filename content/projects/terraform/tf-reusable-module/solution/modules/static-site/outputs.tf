output "url" {
  description = "Where the site answers on this machine."
  value       = "http://127.0.0.1:${var.port}"
}

output "container_name" {
  description = "Name of the container that serves the site."
  value       = docker_container.site.name
}
