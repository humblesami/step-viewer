from odoo import models, fields, api

class ColorsTemplate(models.Model):
    _name = 'colors.template'
    name = fields.Char()
    color_ids = fields.One2many('template.colors.values', 'color_template_id', string="Colors")

class ColorsTemplateValues(models.Model):
    _name = 'template.colors.values'
    _description = 'product_model_colors.product_model_colors'

    color_name = fields.Char()
    color_value = fields.Char(required=True)
    color_image = fields.Image()
    color_template_id = fields.Many2one('colors.template')


class ProductModelColors(models.Model):
    _name = 'product_model.colors'
    _description = 'product_model_colors.product_model_colors'

    product_tmpl_id = fields.Many2one('product.template')
    color_value = fields.Char()
