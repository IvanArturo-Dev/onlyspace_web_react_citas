# budget.tf
# Control de costos con AWS Budgets (Tarea 2.5).
# Se define un presupuesto mensual de tipo COST con tope var.budget_amount USD.
# Las alertas se envian directamente por email al var.alert_email usando el campo
# subscriber_email_addresses de cada notificacion; AWS Budgets entrega el correo sin
# necesidad de un topic SNS, lo que simplifica la configuracion.

resource "aws_budgets_budget" "monthly" {
  name         = "${var.project_name}-monthly-budget"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_amount)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # 50% del tope: aviso temprano sobre gasto real acumulado.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  # 80% del tope: aviso de que el gasto real se acerca al limite.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  # 100% del tope: se usa FORECASTED para avisar cuando la proyeccion del mes
  # alcanzara el 100%, dando margen de reaccion antes de superar el presupuesto real.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}
