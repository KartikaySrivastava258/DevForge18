terraform {
  required_providers {
    # A child module names its providers' sources; the root module chooses their versions.
    docker = {
      source = "kreuzwerker/docker"
    }
  }
}

# TODO: one docker_container serving index.html.tftpl (rendered with templatefile) on 127.0.0.1:<port>.
# Inputs (variables.tf): name, port, title, image_id — validated. Outputs (outputs.tf): url, container_name.
