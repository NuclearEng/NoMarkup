variable "name_prefix" {
  type = string
}

variable "bucket_name" {
  type    = string
  default = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}
