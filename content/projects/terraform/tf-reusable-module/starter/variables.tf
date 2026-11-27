variable "prefix" {
  description = "Prefix for every container name, e.g. campus."
  type        = string
  default     = "campus"
}

# TODO: a variable "sites" — a map keyed by site name, each with a port and a title.
