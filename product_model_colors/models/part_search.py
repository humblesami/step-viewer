from odoo import models, fields, api
from odoo.exceptions import ValidationError
from odoo.orm.decorators import ondelete


class PartSearch(models.Model):
    _name = 'part.search'
    _rec_name = 'term_group_name'

    search_term = fields.Char(unique=True)
    term_group_name = fields.Char()

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
    group_title = fields.Char()
    color_template_id = fields.Many2one('colors.template')
    part_count = fields.Integer(compute='_get_parts_count')
    part_ids = fields.One2many('glb.part', 'part_group_id')
    
    # part_search_id = fields.Many2one('part.search')
    # chosen_color = fields.Char()

    def _get_parts_count(self):
        for item in self:
            item.part_count = len(item.part_ids)

    def name_get(self):
        result = []
        for group in self:
            name = group.group_title or 'Unnamed Group'
            result.append((group.id, f"{name} ({group.part_count} parts)"))
        return result


class GlbParts(models.Model):
    _inherit = 'glb.part'
    part_group_id = fields.Many2one('parts.group', string='Group', ondelete='cascade')

