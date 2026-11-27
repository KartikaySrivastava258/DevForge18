terraform {
  required_version = ">= 1.6"

  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "4.6.0"
    }
  }
}

provider "docker" {}

resource "docker_image" "nginx" {
  name         = "nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10"
  keep_locally = true # destroy leaves the image for other projects on this machine
}

# Copied and pasted for every new site. The third copy is due next week.

resource "docker_container" "timetable" {
  name  = "${var.prefix}-timetable"
  image = docker_image.nginx.image_id

  ports {
    internal = 80
    external = 8081
  }

  upload {
    file    = "/usr/share/nginx/html/index.html"
    content = "<h1>Timetable</h1>"
  }
}

resource "docker_container" "library" {
  name  = "${var.prefix}-library"
  image = docker_image.nginx.image_id

  ports {
    internal = 80
    external = 8082
  }

  upload {
    file    = "/usr/share/nginx/html/index.html"
    content = "<h1>Library</h1>"
  }
}
