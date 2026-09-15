# variables.tf
# Variables de entrada de la infraestructura. Los valores con default son razonables
# para el escenario de bajo costo; las variables sin default deben ser provistas por
# el usuario (ver terraform.tfvars) ya que dependen de su dominio, IP y credenciales.

variable "region" {
  description = "Region de AWS donde se crea la infraestructura."
  type        = string
  default     = "mx-central-1"
}

variable "aws_profile" {
  description = "Perfil local de AWS CLI usado por el provider (cuenta nueva de OnlySpace)."
  type        = string
  default     = "onlyspace"
}

variable "instance_type" {
  description = "Tipo de instancia EC2. Parametrizable para escalar (ej. t3.small) con un solo cambio."
  type        = string
  default     = "t3.micro"
}

variable "domain" {
  description = "Dominio del usuario (comprado en HostGator) que apuntara a la infraestructura."
  type        = string
}

variable "admin_ip" {
  description = "IP publica del administrador para acceso SSH, en formato CIDR (ej. \"1.2.3.4/32\")."
  type        = string
}

variable "budget_amount" {
  description = "Tope mensual de gasto en USD para AWS Budgets (~500 MXN)."
  type        = number
  default     = 30
}

variable "alert_email" {
  description = "Correo electronico que recibira las alertas de costo (AWS Budgets)."
  type        = string
}

variable "key_name" {
  description = "Nombre del key pair de EC2 usado para el acceso SSH a la instancia."
  type        = string
}

variable "project_name" {
  description = "Nombre del proyecto, usado como prefijo y en los tags de los recursos."
  type        = string
  default     = "onlyspace"
}
