terraform {
  required_version = ">= 1.6"

  # Exact versions: every developer gets the same provider builds (the lock file records their checksums).
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "4.6.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "2.9.1"
    }
  }
}

# Talks to the Docker engine on this machine (unix:///var/run/docker.sock by default).
provider "docker" {}
