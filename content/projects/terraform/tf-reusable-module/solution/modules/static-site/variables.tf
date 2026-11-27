variable "name" {
  description = "Container name; also shown on the page. Lower-case letters, digits and hyphens."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,40}$", var.name))
    error_message = "name must be 3-41 characters: lower-case letters, digits and hyphens, starting with a letter."
  }
}

variable "port" {
  description = "Port on 127.0.0.1 where the site is published."
  type        = number

  validation {
    condition     = var.port >= 1024 && var.port <= 65535 && floor(var.port) == var.port
    error_message = "port must be a whole number from 1024 to 65535."
  }
}

variable "title" {
  description = "Page title and heading."
  type        = string

  validation {
    condition     = length(trimspace(var.title)) > 0 && length(var.title) <= 80
    error_message = "title must not be empty and at most 80 characters long."
  }
}

variable "image_id" {
  description = "ID of the nginx image to run (from a docker_image resource in the calling module)."
  type        = string
}
