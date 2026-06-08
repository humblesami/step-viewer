from odoo import models, fields, api


class StepPurchase(models.Model):
    _inherit = 'purchase.order.line'

    finished_client_model = fields.Many2one(
        'ir.attachment',
        string='Client Demanded Model Data',
    )