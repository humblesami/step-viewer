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
    glb_part_names_json = fields.Text(related="step_file_id.glb_part_names_json")
    
    has_glb_parts = fields.Boolean(compute="_compute_has_glb_parts")
    parts_groups = fields.One2many('parts.group', 'product_tmpl_id')
    

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
        res = super().write(vals)
        if vals.get('step_file_content') or vals.get('step_file_id'):
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

    @api.depends('glb_part_names_json')
    def _compute_has_glb_parts(self):
        for product in self:
            product.has_glb_parts = bool(product.glb_part_names_json)

    def action_generate_part_names_json(self):
        for product in self:
            if product.step_file_id:
                self.env['step.file.service'].make_part_groups(product.step_file_id.id, product.step_file_id)

    def action_view_glb_parts(self):
        self.ensure_one()
        return {
            'name': 'GLB Parts List',
            'type': 'ir.actions.act_window',
            'res_model': 'glb.parts.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {'default_product_tmpl_id': self.id}
        }

    def action_auto_generate_parts_groups(self):
        default_template = self.env.ref('product_model_colors.demo_template_1', raise_if_not_found=False)
        for product in self:
            if not product.step_file_id or not product.step_file_id.glb_part_names_json:
                continue
            
            try:
                part_json_names = json.loads(product.step_file_id.glb_part_names_json)
            except Exception:
                continue
            if product.parts_groups:
                product.parts_groups.unlink()
            all_search_terms = self.env['part.search'].search([])
            for term in all_search_terms:
                matched_parts = [p for p in part_json_names if term.search_term.lower() in p.lower()]
                if not matched_parts:
                    continue
                values = {
                    'product_tmpl_id': product.id,
                    'group_title': term.term_group_name,
                    'part_count': len(matched_parts),
                    'color_template_id': default_template.id,
                    'part_search_id': term.id
                }
                self.env['parts.group'].create(values)

    def fetch_product_colors(self):
        ref_tid = self.env.ref('product_model_colors.demo_template_1', raise_if_not_found=False)
        tid = self.color_template_id.id or (ref_tid.id if ref_tid else False)
        return []


class StepService(models.TransientModel):
    _inherit = 'step.file.service'

    def make_part_groups(self, att_id, att_obj=None):
        super().make_part_groups(att_id, att_obj)
        if att_obj:
            att_id = att_obj.id
        products = self.env['product.template'].search([('step_file_id', '=', att_id)])
        for product in products:
            product.action_auto_generate_parts_groups()


class GlbPartsWizard(models.TransientModel):
    _name = 'glb.parts.wizard'
    _description = 'GLB Parts Viewer'

    product_tmpl_id = fields.Many2one('product.template')
    parts_list = fields.Text(compute='_compute_parts_list', string="Part Names")

    @api.depends('product_tmpl_id')
    def _compute_parts_list(self):
        import json
        for wiz in self:
            if wiz.product_tmpl_id and wiz.product_tmpl_id.glb_part_names_json:
                try:
                    names = json.loads(wiz.product_tmpl_id.glb_part_names_json)
                    wiz.parts_list = "\n".join(f"- {name}" for name in names)
                except Exception:
                    wiz.parts_list = "Error parsing parts JSON."
            else:
                wiz.parts_list = "No parts found or file not processed."
