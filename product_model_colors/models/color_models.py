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

    @api.onchange('search_term')
    def _onchange_search_term(self):
        if self.search_term:
            existing = self.env['part.search'].search([])
            overlaps = []
            for term in existing:
                if term.id != self._origin.id and term.search_term:
                    if term.search_term in self.search_term or self.search_term in term.search_term:
                        overlaps.append(term.search_term)
            if overlaps:
                return {
                    'warning': {
                        'title': 'Overlap Warning',
                        'message': f"The term '{self.search_term}' overlaps with existing terms: {', '.join(overlaps)}. You can still save it if you want."
                    }
                }


class PartsGroup(models.Model):
    _name = 'parts.group'
    
    product_tmpl_id = fields.Many2one('product.template')
    display_name = fields.Char()
    part_count = fields.Integer('Number of Parts', default=0)
    part_search_ids = fields.Many2many('part.search')
    color_template_id = fields.Many2one('colors.template')
    chosen_color = fields.Char()
    merge_with_group_id = fields.Many2one(
        'parts.group', 
        string="Merge with...",
        domain="[('product_tmpl_id', '=', product_tmpl_id), ('id', '!=', id)]"
    )

    def action_merge_group(self):
        self.ensure_one()
        if not self.merge_with_group_id:
            return
        # Combine search terms
        self.part_search_ids = [(4, term.id) for term in self.merge_with_group_id.part_search_ids]
        # Combine part counts
        self.part_count += self.merge_with_group_id.part_count
        # Delete the old group
        self.merge_with_group_id.unlink()
        self.merge_with_group_id = False

    def name_get(self):
        result = []
        for group in self:
            name = group.display_name or 'Unnamed Group'
            result.append((group.id, f"{name} ({group.part_count} parts)"))
        return result

    @api.constrains('part_search_ids')
    def _check_overlap(self):
        # We will handle the strict validation here, but to support the 3 options wizard 
        # later, we might need to bypass this or trigger the wizard differently.
        for group in self:
            other_groups = self.env['parts.group'].search([
                ('product_tmpl_id', '=', group.product_tmpl_id.id),
                ('id', '!=', group.id)
            ])
            all_other_terms = other_groups.mapped('part_search_ids.search_term')
            
            for term in group.part_search_ids:
                for other_term in all_other_terms:
                    if term.search_term in other_term or other_term in term.search_term:
                        from odoo.exceptions import ValidationError
                        raise ValidationError(
                            f"Overlap detected! '{term.search_term}' in '{group.display_name}' "
                            f"overlaps with '{other_term}' in another group. "
                            f"Please use the Overlap Resolution Wizard to resolve this."
                        )


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    parts_groups = fields.One2many('parts.group', 'product_tmpl_id')
    has_overlaps = fields.Boolean(compute='_compute_has_overlaps', store=True)

    @api.depends('parts_groups.part_search_ids')
    def _compute_has_overlaps(self):
        for product in self:
            overlap_found = False
            terms_seen = []
            for group in product.parts_groups:
                for term in group.part_search_ids:
                    for seen in terms_seen:
                        if term.search_term in seen or seen in term.search_term:
                            overlap_found = True
                            break
                    if overlap_found:
                        break
                    terms_seen.append(term.search_term)
                if overlap_found:
                    break
            product.has_overlaps = overlap_found

    def action_open_overlap_wizard(self):
        self.ensure_one()
        return {
            'name': 'Resolve Overlaps',
            'type': 'ir.actions.act_window',
            'res_model': 'parts.overlap.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {'default_product_tmpl_id': self.id}
        }

    def fetch_product_colors(self):
        ref_tid = self.env.ref('product_model_colors.demo_template_1', raise_if_not_found=False)
        tid = self.color_template_id.id or (ref_tid.id if ref_tid else False)
        return []


class PartsOverlapWizard(models.TransientModel):
    _name = 'parts.overlap.wizard'
    _description = 'Resolve overlapping search terms'

    product_tmpl_id = fields.Many2one('product.template', required=True)
    resolution_choice = fields.Selection([
        ('keep_existing', 'Keep Existing (Abort Changes)'),
        ('override', 'Override Existing with New'),
        ('keep_both', 'Keep Both (First Match Wins)')
    ], string="Resolution", required=True, default='keep_existing')

    def action_resolve(self):
        self.ensure_one()
        if self.resolution_choice == 'keep_both':
            # Bypass validation by setting a context flag or explicitly allowing it.
            # For now, we clear the has_overlaps so they can save.
            # (Note: constrains will need to check this context to bypass).
            pass
        elif self.resolution_choice == 'keep_existing':
            # Logic to revert the overlapping term
            pass
        elif self.resolution_choice == 'override':
            # Logic to remove the older overlapping term
            pass
        return {'type': 'ir.actions.act_window_close'}
