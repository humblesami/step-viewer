# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import ValidationError

class SaleOrderLine(models.Model):
    _inherit = 'sale.order.line'

    model_customization_json = fields.Text(
        string='Model Customization',
    )

    product_step_file_id = fields.Many2one(
        related='product_id.step_file_id',
        string="Product 3D Model",
    )

    def action_restore_original_model(self):
        for line in self:
            line.model_customization_json = False

    @api.model_create_multi
    def create(self, vals_list):
        lines = super(SaleOrderLine, self).create(vals_list)
        return lines

