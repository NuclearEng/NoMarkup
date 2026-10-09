variable "name_prefix" {
  type = string
}

variable "cluster_version" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "node_instance_types" {
  type = list(string)
}

variable "desired_capacity" {
  type = number
}

variable "tags" {
  type    = map(string)
  default = {}
}
