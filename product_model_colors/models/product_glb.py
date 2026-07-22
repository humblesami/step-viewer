import json
from odoo import models, fields, api, _
from odoo.exceptions import ValidationError


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    step_file_id = fields.Many2one(
        'ir.attachment',
        help="Upload .step, .stp, or .glb files. STEP files >= 4MB will be automatically exported to GLB."
    )
    step_file_content = fields.Binary(string='3D Model File', compute='_compute_step_content', inverse='_inverse_step_content')
    step_file_name = fields.Char(string='File Name')
    model_part_ids = fields.One2many(related='step_file_id.glb_part_ids')
    parts_group_ids = fields.One2many('parts.group', 'product_tmpl_id')
    

    @api.depends('step_file_id', 'step_file_id.datas')
    def _compute_step_content(self):
        for rec in self:
            if rec.step_file_id:
                rec.step_file_content = rec.step_file_id.datas
                rec.step_file_name = rec.step_file_id.name
            else:
                rec.step_file_content = False
                rec.step_file_name = False

    def _inverse_step_content(self):
        for rec in self:
            if rec.step_file_content and rec.step_file_content != b'1':
                if rec.step_file_id:
                    rec.step_file_id.sudo().write({
                        'datas': rec.step_file_content,
                        'name': rec.step_file_name or 'model.step'
                    })
                else:
                    att = self.env['ir.attachment'].sudo().create({
                        'name': rec.step_file_name or 'model.step',
                        'type': 'binary',
                        'datas': rec.step_file_content,
                        'res_model': 'product.template',
                        'res_id': rec.id
                    })
                    rec.step_file_id = att.id
            elif not rec.step_file_content:
                if rec.step_file_id:
                    rec.step_file_id.sudo().unlink()
                    rec.step_file_id = False

    @api.model_create_multi
    def create(self, values):
        records = super().create(values)
        for item in records:
            if item.step_file_id:
                self.env['step.file.service'].process_attachment(self.step_file_id)
        return records

    def write(self, vals):
        if vals.get('step_file_content') or vals.get('step_file_id'):
            self.parts_group_ids.unlink()
            self.step_file_id.glb_part_ids.unlink()
        res = super().write(vals)
        if self.step_file_id and (vals.get('step_file_content') or vals.get('step_file_id')):
            self.env['step.file.service'].process_attachment(self.step_file_id)
        return res

    @api.constrains('step_file_id')
    def _check_step_file(self):
        msg = _('Only .step, .stp, .glb, or .gltf files are allowed.')
        for rec in self:
            if rec.step_file_id:
                ext = rec.step_file_id.name.rsplit('.', 1)[-1].lower()
                if ext not in ('step', 'stp', 'glb', 'gltf'):
                    raise ValidationError(msg)


    def action_auto_generate_glb_groups(self):
        default_template = self.env.ref('product_model_colors.demo_template_1', raise_if_not_found=False)
        for product in self:
            if not (product.step_file_id and product.step_file_id.glb_part_ids):
                continue
            
            part_names = product.step_file_id.glb_part_ids.mapped('part_name')

            if product.parts_group_ids:
                product.parts_group_ids.unlink()
            all_search_terms = self.env['part.search'].search([])
            for term in all_search_terms:
                matched_parts = [p for p in part_names if term.search_term.lower() in p.lower()]
                if not matched_parts:
                    continue
                values = {
                    'product_tmpl_id': product.id,
                    'group_title': term.term_group_name,
                    'part_count': len(matched_parts),
                    'color_template_id': default_template.id,
                }
                self.env['parts.group'].create(values)

    def fetch_product_colors(self):
        ref_tid = self.env.ref('product_model_colors.demo_template_1', raise_if_not_found=False)
        tid = self.color_template_id.id or (ref_tid.id if ref_tid else False)
        return []


