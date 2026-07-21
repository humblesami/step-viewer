from odoo import models, fields, api
from odoo.exceptions import ValidationError

class PartSearch(models.Model):
    _name = 'part.search'
    search_term = fields.Char(unique=True)
    group_title = fields.Char()

    @api.constrains('search_term')
    def _check_global_overlap(self):
        for record in self:
            if not record.search_term:
                continue
            existing = self.env['part.search'].search([('id', '!=', record.id)])
            for term in existing:
                if not (record.search_term in term.search_term or term.search_term in record.search_term):
                    continue

                raise ValidationError(
                    f"Strict Validation Failed: Cannot add '{record.search_term}' because it overlaps with existing global term '{term.search_term}'."
                )

class PartsGroup(models.Model):
    _name = 'parts.group'
    
    product_tmpl_id = fields.Many2one('product.template')
    display_name = fields.Char()
    part_count = fields.Integer('Number of Parts', default=0)
    part_search_id = fields.Many2one('part.search')
    color_template_id = fields.Many2one('colors.template')
    chosen_color = fields.Char()

    def name_get(self):
        result = []
        for group in self:
            name = group.display_name or 'Unnamed Group'
            result.append((group.id, f"{name} ({group.part_count} parts)"))
        return result
