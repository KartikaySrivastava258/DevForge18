output "config_files" {
  description = "Path of each service's rendered configuration file."
  value       = { for name, f in local_file.service : name => f.filename }
}
