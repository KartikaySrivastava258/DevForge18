output "network_name" {
  description = "Docker network the project's containers share."
  value       = docker_network.dev.name
}

output "redis_container" {
  description = "Name of the Redis container."
  value       = docker_container.redis.name
}

output "redis_url" {
  description = "Connection URL for the application on this machine."
  value       = "redis://127.0.0.1:${var.redis_port}/0"
}

output "env_file" {
  description = "Path of the generated settings file."
  value       = local_file.env.filename
}
