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
        self.env['product_model.colors'].search([('product_tmpl_id', '=', pid)]).unlink()
        values = []
        for cv in color_vals:
            values.append({'product_tmpl_id': pid, 'color_value': cv['color_value']})
        self.env['product_model.colors'].create(values)

    def fetch_product_colors(self):
        import logging
        _logger = logging.getLogger(__name__)
        _logger.info(f"Fetching colors for product.template ID: {self.id}")
        
        # Invalidate cache to ensure we get the latest DB values
        self.invalidate_recordset(['model_colors'])
        
        _logger.info(f"Current model_colors count: {len(self.model_colors)}")
        
        if not self.model_colors:
            _logger.info("model_colors is empty, generating defaults...")
            ref_tid = self.env.ref('product_model_colors.demo_template_1', raise_if_not_found=False)
            tid = self.color_template_id.id or (ref_tid.id if ref_tid else False)
            if tid:
                self.create_product_colors(self.id, tid)
                self.invalidate_recordset(['model_colors'])
                _logger.info(f"Generated colors count: {len(self.model_colors)}")
                
        colors = [c.color_value for c in self.model_colors] if self.model_colors else []
        _logger.info(f"Returning {len(colors)} colors: {colors}")
        return colors
