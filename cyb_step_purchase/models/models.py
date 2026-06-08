# from odoo import models, fields, api


# class cyb_step_purchase(models.Model):
#     _name = 'cyb_step_purchase.cyb_step_purchase'
#     _description = 'cyb_step_purchase.cyb_step_purchase'

#     name = fields.Char()
#     value = fields.Integer()
#     value2 = fields.Float(compute="_value_pc", store=True)
#     description = fields.Text()
#
#     @api.depends('value')
#     def _value_pc(self):
#         for record in self:
#             record.value2 = float(record.value) / 100

