from odoo import models, fields, api


class ColorsTemplate(models.Model):
    _name = 'colors.template'

    name = fields.Char()

class ColorsTemplateValues(models.Model):
    _name = 'template.colors.values'
    _description = 'product_model_colors.product_model_colors'

    template_id = fields.Many2one('colors.template')
    color_value = fields.Char()


class ProductModelColors(models.Model):
    _name = 'product_model.colors'
    _description = 'product_model_colors.product_model_colors'

    product_tmpl_id = fields.Many2one('product.template')
    color_value = fields.Char()

class ProductTemplate(models.Model):
    _inherit = 'product.template'

    color_template_id = fields.Many2one('colors.template')
    model_colors = fields.One2many('product_model.colors', 'product_tmpl_id')

    @api.constrains('color_template_id')
    def color_template_changed(self):
        for item in self:
            if item.color_template_id:
                self.create_product_colors(item.id, item.color_template_id.id)

    def create_product_colors(self, pid, tmpl_id):
        color_vals = self.env['template.colors.values'].search_read([('template_id', '=',tmpl_id)],
                                                                    fields=['color_value'])
        values = []
        for cv in color_vals:
            values.push({'product_tmpl_id': pid, 'color_value': cv['color_value']})
        self.env['product_model.colors'].create(values)

    def fetch_product_colors(self):
        if not self.model_colors:
            tid = self.color_template_id.id or self.env.ref('demo_template').id
            self.create_product_colors(self.id, tid)
        return self.model_colors
