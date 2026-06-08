import os
import time
import base64
import logging
import trimesh
import tempfile
import cadquery as cq
from cadquery import exporters
from odoo import models, fields, api, _
from odoo.exceptions import UserError, ValidationError

_logger = logging.getLogger(__name__)


class StepService(models.TransientModel):
    _name = 'step.file.service'
    _description = "Step File Service"

    def action_preview_by_attachment_id(self, att_id):
        att = self.env['ir.attachment'].sudo().browse(att_id)
        if not att.exists():
            raise UserError(_("Attachment not found."))
        return {
            'type': 'ir.actions.client',
            'tag': 'step_files_preview_tag',
            'name': 'STP File Preview',
            'target': 'new',
            'params': {
                'file_name': att.name,
                'file_url': f'/web/content/{att.id}/{att.name}',
            }
        }

    def process_attachment(self, attachment):
        if not attachment.needs_step_conversion():
            return
        self.with_delay().run_attachment_job(attachment.id)

    def run_attachment_job(self, att_id):
        print("===============job started===============")
        attachment = self.env['ir.attachment'].browse(att_id)
        glb_bytes = self.__class__.convert_to_glb(att_id, attachment.datas)

        if not glb_bytes:
            _logger.error('Invalid glb bytes')
            raise UserError(_('Invalid glb bytes'))

        # create new GLB attachment
        attachment.write({
            'datas': glb_bytes,
            'mimetype': 'model/gltf-binary',
            'is_step_processed': True,
            'type': 'binary',
            'public': True,
        })

        self._notify_user(att_id)
        print("============Sent notification============")

    def _notify_user(self, att_id):
        self.env['bus.bus']._sendone(
            self.env.user.partner_id,
            'STEP_FILE_PROCESSED',
            {
                'title': 'Preview Ready',
                'item_id': att_id,
                'message': f'Attachment ({att_id}) is ready to view',
                'type': 'success',
            }
        )

    @classmethod
    def convert_to_glb(cls, att_id, file_data):
        stp_bytes = base64.b64decode(file_data)
        with tempfile.TemporaryDirectory() as temp_dir:
            input_stp_path = os.path.join(temp_dir, f'{att_id}_input.step')
            temp_stl_path = os.path.join(temp_dir, f'{att_id}_temp.stl')
            output_glb_path = os.path.join(temp_dir, f'{att_id}_output.glb')
            try:
                with open(input_stp_path, 'wb') as f:
                    f.write(stp_bytes)

                shape = cq.importers.importStep(input_stp_path)
                out_asm = cq.Assembly()
                if hasattr(shape, "objs") and len(shape.objs) > 0:
                    for i, obj in enumerate(shape.objs):
                        out_asm.add(obj, name=f"Part_{i}")
                else:
                    out_asm.add(shape, name="MainPart")
                out_asm.save(
                    output_glb_path,
                    exportType="GLB",
                    tolerance=1.0,
                    angularTolerance=0.5,
                    writeBinary=True
                )
                with open(output_glb_path, 'rb') as f:
                    glb_bytes = f.read()
                return base64.b64encode(glb_bytes)

            except Exception as ex:
                _logger.exception("Error during STEP to GLB conversion")
                raise UserError(_("Failed to convert STEP file to GLB: %s") % str(ex))


class StpFiles(models.Model):
    _name = 'step.files'

    file_title = fields.Char(string='Title')
    file_raw_name = fields.Char(string='Original Name')
    original_stp = fields.Binary(string='STEP Attachment', attachment=True)
    conversion_pending = fields.Boolean(string='Wait Conversion', compute='_compute_wait_conversion')

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        for record in records:
            attachment = self.env['ir.attachment'].search(
                [('res_model', '=', 'step.files'), ('res_id', '=', record.id), ('res_field', '=', 'original_stp')],
                limit=1)
            self.env['step.file.service'].process_attachment(attachment)
        return records

    def _compute_wait_conversion(self):
        for record in self:
            attachment = self.env['ir.attachment'].search(
                [('res_model', '=', 'step.files'), ('res_id', '=', record.id), ('res_field', '=', 'original_stp')],
                limit=1)
            if not attachment:
                record.conversion_pending = False
            else:
                record.conversion_pending = attachment.needs_step_conversion()

    def write(self, vals):
        if vals.get('original_stp'):
            vals['converted_step'] = False
        res = super().write(vals)
        return res

    @api.constrains('original_stp')
    def _check_file_type(self):
        allowed_extensions = ('.stp', '.step', '.gltf', '.glb')
        for record in self:
            if not record.file_raw_name:
                raise ValidationError(_("Invalid file! name"))
            if not record.file_raw_name.lower().endswith(allowed_extensions):
                raise ValidationError(_("Invalid file! Please upload: .stp, .step, .gltf, or .glb"))

    def action_preview_step_files(self):
        self.ensure_one()
        if not self.create_date:
            raise UserError(_("Record must be saved before previewing."))

        # Flush to ensure the 'res_field' write from IrAttachment.create is in the DB
        self.env['ir.attachment'].flush_model(['res_model', 'res_id', 'res_field'])
        dom = [('res_model', '=', 'step.files'), ('res_id', '=', self.id)]
        res_field = 'original_stp'
        dom += [('res_field', '=', res_field)]
        att = self.env['ir.attachment'].sudo().search(dom, limit=1, order='id desc')

        if not att:
            raise UserError(_("Attachment not processed yet. Please refresh and try again."))

        return {
            'type': 'ir.actions.client',
            'tag': 'step_files_preview_tag',
            'name': 'STP File Preview',
            'target': 'new',
            'params': {
                'file_name': self.file_title or att.get_name(),
                'file_url': f'/web/content/{att.id}/{time.time()}.glb',
            }
        }

