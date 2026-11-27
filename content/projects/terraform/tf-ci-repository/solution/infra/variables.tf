variable "environment" {
  description = "Which environment the configuration is rendered for."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of dev, staging or prod."
  }
}

variable "services" {
  description = "Campus services to configure: the port each listens on and how many replicas it runs."
  type = map(object({
    port     = number
    replicas = number
  }))
  default = {
    timetable = { port = 8081, replicas = 2 }
    library   = { port = 8082, replicas = 1 }
  }

  validation {
    condition     = alltrue([for s in values(var.services) : s.port >= 1024 && s.port <= 65535])
    error_message = "every service port must be from 1024 to 65535."
  }

  validation {
    condition     = alltrue([for s in values(var.services) : s.replicas >= 1 && s.replicas <= 10])
    error_message = "every service needs 1 to 10 replicas."
  }
}
