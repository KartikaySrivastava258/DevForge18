variable "environment" {
  type = string
}

variable "services" {
  type = map(object({
    port     = number
    replicas = number
  }))
  default = {
    timetable = { port = 8081, replicas = 2 }
    library   = { port = 8082, replicas = 1 }
  }
}
