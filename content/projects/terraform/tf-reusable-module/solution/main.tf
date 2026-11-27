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

# One image for every site. keep_locally: destroy leaves it for other projects on this machine.
resource "docker_image" "nginx" {
  name         = "nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10"
  keep_locally = true
}

# for_each keys each site by name: adding or removing one site touches only that site
# (count would renumber the others and replace them).
module "site" {
  source   = "./modules/static-site"
  for_each = var.sites

  name     = "${var.prefix}-${each.key}"
  port     = each.value.port
  title    = each.value.title
  image_id = docker_image.nginx.image_id
}
