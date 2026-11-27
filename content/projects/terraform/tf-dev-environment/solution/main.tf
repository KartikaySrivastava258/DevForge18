# One private network per project, so its containers find each other by name.
resource "docker_network" "dev" {
  name = "${var.project}-dev"
}

# Pinned by tag and digest: every developer runs exactly the same Redis build.
resource "docker_image" "redis" {
  name = "redis:7.4-alpine@sha256:7f7d30b7fdd09467bac58198a1f166dd69789d348d4fe859cccb20e0cf287fbe"
  # Keep the image when the environment is destroyed: other projects on this machine may use it.
  keep_locally = true
}

resource "docker_container" "redis" {
  name    = "${var.project}-redis"
  image   = docker_image.redis.image_id
  restart = "unless-stopped"

  networks_advanced {
    name = docker_network.dev.name
  }

  # Published on the loopback address only: reachable from this machine, not from the network.
  ports {
    internal = 6379
    external = var.redis_port
    ip       = "127.0.0.1"
  }

  labels {
    label = "devforge.project"
    value = var.project
  }
}

# The settings the application reads; generated, so they always match the containers above.
resource "local_file" "env" {
  filename        = "${path.module}/dev.env"
  file_permission = "0644"
  content         = <<-EOT
    PROJECT=${var.project}
    REDIS_URL=redis://127.0.0.1:${var.redis_port}/0
  EOT
}
