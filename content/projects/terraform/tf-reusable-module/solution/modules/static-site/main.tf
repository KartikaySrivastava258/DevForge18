terraform {
  required_providers {
    # A child module names its providers' sources; the root module chooses their versions.
    docker = {
      source = "kreuzwerker/docker"
    }
  }
}

# One small nginx container serving a single generated page, published on 127.0.0.1 only.
resource "docker_container" "site" {
  name    = var.name
  image   = var.image_id
  restart = "unless-stopped"

  ports {
    internal = 80
    external = var.port
    ip       = "127.0.0.1"
  }

  # The page is uploaded into the container when it is created; changing it replaces the container.
  upload {
    file    = "/usr/share/nginx/html/index.html"
    content = templatefile("${path.module}/index.html.tftpl", { title = var.title, name = var.name })
  }

  labels {
    label = "devforge.site"
    value = var.name
  }
}
