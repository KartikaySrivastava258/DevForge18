output "urls" {
  description = "URL of each site, keyed like var.sites."
  value       = { for key, site in module.site : key => site.url }
}

output "containers" {
  description = "Container name of each site."
  value       = { for key, site in module.site : key => site.container_name }
}
