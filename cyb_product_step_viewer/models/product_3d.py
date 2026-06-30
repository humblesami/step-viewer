# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import ValidationError

class SaleOrderLine(models.Model):
    _inherit = 'sale.order.line'

    finished_client_model = fields.Many2one(
        'ir.attachment',
        string='Client Demanded Model Data',
    )

    is_model_modified = fields.Boolean(
        string="Is Model Modified",
        compute="_compute_is_model_modified",
        store=False,
    )
    @api.depends('finished_client_model.checksum', 'product_id.step_files')
    def _compute_is_model_modified(self):
        for line in self:
            if line.finished_client_model and line.product_id.step_files:
                original = line.product_id.step_files[0]
                line.is_model_modified = (line.finished_client_model.checksum != original.checksum)
            else:
                line.is_model_modified = False

    def action_restore_original_model(self):
        for line in self:
            if line.product_id.step_files and line.finished_client_model:
                original = line.product_id.step_files[0]
                line.finished_client_model.sudo().write({
                    'datas': original.datas,
                    'name': f'Finished_Model_{line.id}_{original.name}',
                })

    @api.model_create_multi
    def create(self, vals_list):
        lines = super(SaleOrderLine, self).create(vals_list)
        for line in lines:
            if line.product_id.step_files and not line.finished_client_model:
                first_model = line.product_id.step_files[0]
                new_att = first_model.sudo().copy({
                    'name': f'Finished_Model_{line.id}_{first_model.name}',
                    'res_model': 'sale.order.line',
                    'res_id': line.id,
                    'public': True,
                })
                line.finished_client_model = new_att.id
        return lines

class ProductTemplate(models.Model):
    _inherit = 'product.template'

    step_files = fields.Many2many(
        'ir.attachment',
        'product_step_attachment_rel',
        'product_id', 'attachment_id',
        string='3D Models',
        help="Upload .step, .stp, or .glb files. STEP files >= 4MB will be automatically exported to GLB."
    )


    def write(self, vals):
        res = super(ProductTemplate, self).write(vals)
        if self.step_files:
            if vals.get('step_files'):
                for att in self.step_files:
                    self.env['step.file.service'].process_attachment(att)
        return res

    @api.model_create_multi
    def create(self, vals_list):
        records = super(ProductTemplate, self).create(vals_list)
        for record in records:
            for att in record.step_files:
                self.env['step.file.service'].process_attachment(att)
        return records

    @api.constrains('step_files')
    def _check_step_files(self):
        msg = _('Only .step, .stp, .glb, or .gltf files are allowed.')
        for rec in self:
            for att in rec.step_files:
                ext = att.name.rsplit('.', 1)[-1].lower()
                if ext not in ('step', 'stp', 'glb', 'gltf'):
                    raise ValidationError(msg)
