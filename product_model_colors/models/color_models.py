import json
from odoo import models, fields, api


class ColorsTemplate(models.Model):
    _name = 'colors.template'

    name = fields.Char()

class ColorsTemplateValues(models.Model):
    _name = 'template.colors.values'
    _description = 'product_model_colors.product_model_colors'

    color_template_id = fields.Many2one('colors.template')
    color_value = fields.Char()


class ProductModelColors(models.Model):
    _name = 'product_model.colors'
    _description = 'product_model_colors.product_model_colors'

    product_tmpl_id = fields.Many2one('product.template')
    color_value = fields.Char()


class PartSearch(models.Model):
    _name = 'part.search'
    search_term = fields.Char(unique=True)
    group_title = fields.Char()

    @api.constrains('search_term')
    def _check_global_overlap(self):
        for record in self:
            if record.search_term:
                existing = self.env['part.search'].search([('id', '!=', record.id)])
                for term in existing:
                    if record.search_term in term.search_term or term.search_term in record.search_term:
                        from odoo.exceptions import ValidationError
                        raise ValidationError(
                            f"Strict Validation Failed: Cannot add '{record.search_term}' because it overlaps with existing global term '{term.search_term}'."
                        )

class PartsGroup(models.Model):
    _name = 'parts.group'
    
    product_tmpl_id = fields.Many2one('product.template')
    display_name = fields.Char()
    part_count = fields.Integer('Number of Parts', default=0)
    part_search_id = fields.Many2many('part.search')
    color_template_id = fields.Many2one('colors.template')
    chosen_color = fields.Char()


    def name_get(self):
        result = []
        for group in self:
            name = group.display_name or 'Unnamed Group'
            result.append((group.id, f"{name} ({group.part_count} parts)"))
        return result

class ProductTemplate(models.Model):
    _inherit = 'product.template'

    parts_groups = fields.One2many('parts.group', 'product_tmpl_id')

    def _auto_generate_parts_groups(self):
        
        for product in self:
            if not product.step_file_id or not product.step_file_id.part_names_json:
                continue
            
            try:
                part_json_names = json.loads(product.step_file_id.part_names_json)
            except Exception:
                continue
            if product.parts_groups:
                continue
            all_search_terms = self.env['part.search'].search([])
            for term in all_search_terms:
                matched_parts = [p for p in part_json_names if term.search_term in p]
                if matched_parts:
                    self.env['parts.group'].create({
                        'product_tmpl_id': product.id,
                        'display_name': term.group_title,
                        'part_count': len(matched_parts),
                        'part_search_id': [(4, term.id)]
                    })

    def fetch_product_colors(self):
        ref_tid = self.env.ref('product_model_colors.demo_template_1', raise_if_not_found=False)
        tid = self.color_template_id.id or (ref_tid.id if ref_tid else False)
        return []

