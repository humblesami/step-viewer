# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import ValidationError

class SaleOrderLine(models.Model):
    _inherit = 'sale.order.line'

    model_customization_json = fields.Text(
        string='Model Customization',
    )

    product_step_file_id = fields.Many2one(
        related='product_id.step_file_id',
        string="Product 3D Model",
    )

    def action_restore_original_model(self):
        for line in self:
            line.model_customization_json = False

    @api.model_create_multi
    def create(self, vals_list):
        lines = super(SaleOrderLine, self).create(vals_list)
        return lines

class ProductTemplate(models.Model):
    _inherit = 'product.template'

    step_file_id = fields.Many2one(
        'ir.attachment',
        help="Upload .step, .stp, or .glb files. STEP files >= 4MB will be automatically exported to GLB."
    )
    
    # Proxy fields for better upload UX in the form view
    step_file_content = fields.Binary(string='3D Model File', compute='_compute_step_content', inverse='_inverse_step_content')
    step_file_name = fields.Char(string='File Name')

    @api.depends('step_file_id')
    def _compute_step_content(self):
        for rec in self:
            if rec.step_file_id:
                # We do not load the actual binary data into the form view for performance, 
                # we just need the field to appear "truthy" so the widget shows the file is attached.
                # Odoo's binary widget will fetch it via the download route if needed.
                # Actually, returning a dummy value works, but returning datas is standard if size isn't huge.
                # For safety, let's just return a placeholder or the actual data.
                rec.step_file_content = b'1' # Placeholder so the widget knows it exists without lagging the page
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
