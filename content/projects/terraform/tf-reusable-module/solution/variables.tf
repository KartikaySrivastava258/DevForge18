variable "prefix" {
  description = "Prefix for every container name, e.g. campus."
  type        = string
  default     = "campus"
}

variable "sites" {
  description = "Sites to run, keyed by short name: the port on 127.0.0.1 and the page title."
  type = map(object({
    port  = number
    title = string
  }))
  default = {
    timetable = { port = 8081, title = "Timetable" }
    library   = { port = 8082, title = "Library" }
  }
}
