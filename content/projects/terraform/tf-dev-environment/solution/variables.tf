variable "project" {
  description = "Short project name; prefixes every Docker object so several environments can live side by side."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,20}$", var.project))
    error_message = "project must be 3-21 characters: lower-case letters, digits and hyphens, starting with a letter."
  }
}

variable "redis_port" {
  description = "Port on 127.0.0.1 where Redis is published for the application on this machine."
  type        = number
  default     = 6380

  validation {
    condition     = var.redis_port >= 1024 && var.redis_port <= 65535 && floor(var.redis_port) == var.redis_port
    error_message = "redis_port must be a whole number from 1024 to 65535 (ports below 1024 need root)."
  }
}
