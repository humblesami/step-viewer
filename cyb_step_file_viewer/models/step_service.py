import os
import time
import base64
import logging
import subprocess
import tempfile
import cadquery as cq
from odoo import models, fields, api, _
from odoo.exceptions import UserError, ValidationError
from .step_to_glb_ocp import convert_step_to_glb_with_names

_logger = logging.getLogger(__name__)



class StepService(models.TransientModel):
    _name = 'step.file.service'
    _description = "Step File Service"


    def process_attachment(self, attachment):
        if not attachment.needs_step_conversion():
            return
        # self.with_delay().run_attachment_job(attachment.id)
        self.run_attachment_job(attachment.id)

    def run_attachment_job(self, att_id):
        print("===============job started===============")
        attachment = self.env['ir.attachment'].browse(att_id)
        glb_bytes, manifest = self.conversion_process(att_id, attachment.datas)
        if not glb_bytes:
            _logger.error('Invalid glb bytes')
            raise UserError(_('Invalid glb bytes'))

        import json
        part_names_json = False
        if manifest:
            # The manifest is a dict of {node_name: original_name}, we just need the node_names (keys)
            part_names_json = json.dumps(list(manifest.keys()))

        # create new GLB attachment
        attachment.write({
            'datas': glb_bytes,
            'name': (attachment.name or 'file.step').lower().replace('.step', '.glb').replace('.stp', '.glb'),
            'mimetype': 'model/gltf-binary',
            'description': f'Converted from {attachment.name}',
            'is_step_processed': True,
            'part_names_json': part_names_json,
            'type': 'binary',
            'public': True,
        })
        
        # Trigger auto-grouping on any product linking this attachment
        products = self.env['product.template'].search([('step_file_id', '=', att_id)])
        for product in products:
            if hasattr(product, '_auto_generate_parts_groups'):
                product._auto_generate_parts_groups()
                
        self._notify_user(att_id)
        print("============Sent notification============")

    def _notify_user(self, att_id):
        self.env['bus.bus']._sendone(
            self.env.user.partner_id,
            'STEP_FILE_PROCESSED',
            {
                'title': 'Preview Ready',
                'item_id':att_id,
                'message': f'Attachment ({att_id}) is ready to view',
                'type': 'success',
            }
        )

    @classmethod
    def conversion_process(cls, att_id, file_data):
        stp_bytes = base64.b64decode(file_data)

        with tempfile.TemporaryDirectory() as temp_dir:
            input_stp = os.path.join(temp_dir, f"{att_id}.step")
            output_glb = os.path.join(temp_dir, f"{att_id}.glb")

            try:
                # 1. write STEP
                with open(input_stp, "wb") as f:
                    f.write(stp_bytes)
                
                manifest = convert_step_to_glb_with_names(input_stp, output_glb)
                
                glb_bytes = False
                if os.path.exists(output_glb):
                    with open(output_glb, "rb") as f:
                        glb_bytes = base64.b64encode(f.read())

                return glb_bytes, manifest

            except Exception as e:
                raise UserError(f"STEP → GLB failed: {str(e)}")

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



class StpFiles(models.Model):
    _name = 'step.files'

    file_title = fields.Char(string='Title')
    file_raw_name = fields.Char(string='Original Name')
    original_stp = fields.Binary(string='STEP Attachment', attachment=True)
    conversion_pending = fields.Boolean(string='Wait Conversion', compute='_compute_wait_conversion')
