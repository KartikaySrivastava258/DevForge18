# First attempt, copied from a colleague's laptop. It works for them — sometimes.

resource "docker_network" "dev" {
  name = "${var.project}-dev"
}

resource "docker_image" "redis" {
  name         = "redis:7.4-alpine"
  keep_locally = true # keep the image on destroy: other projects may use it
}

resource "docker_container" "redis" {
  name  = "${var.project}-redis"
  image = docker_image.redis.image_id

  ports {
    internal = 6379
    external = 6380
  }
}

# TODO: attach the container to the network, publish it on 127.0.0.1 and var.redis_port, and generate dev.env.
