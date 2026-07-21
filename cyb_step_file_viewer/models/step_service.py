import os
import json
import base64
import logging
import tempfile
from odoo import models, fields, _
from odoo.exceptions import UserError
from .step_to_glb_ocp import convert_step_to_glb_with_names

_logger = logging.getLogger(__name__)



class StepService(models.TransientModel):
    _name = 'step.file.service'
    _description = "Step File Service"

    def process_attachment(self, attachment):
        if not attachment.needs_step_conversion():
            self.make_part_groups(0, attachment)
            return

        # self.with_delay().run_attachment_job(attachment.id)
        self.run_attachment_job(attachment.id)

    def _extract_names_from_glb_bytes(self, glb_bytes):
        """Natively parse the JSON chunk of a GLB file to find mesh/node names."""
        import struct
        if len(glb_bytes) < 20:
            return []

        # Parse the 12-byte header
        magic, version, length = struct.unpack('<4sII', glb_bytes[:12])
        if magic != b'glTF':
            return []

        # Parse the chunk 0 header
        chunk_0_length, chunk_0_type = struct.unpack('<II', glb_bytes[12:20])
        if chunk_0_type != b'JSON':
            return []

        try:
            # Decode the JSON chunk
            json_data = glb_bytes[20:20 + chunk_0_length]
            gltf = json.loads(json_data.decode('utf-8'))
            names = []

            # Extract names from nodes that have meshes
            if 'nodes' in gltf:
                for node in gltf['nodes']:
                    if 'mesh' in node and 'name' in node:
                        names.append(node['name'])

            # Fallback: if nodes don't have names, check meshes directly
            if not names and 'meshes' in gltf:
                for mesh in gltf['meshes']:
                    if 'name' in mesh:
                        names.append(mesh['name'])

            return names
        except Exception as e:
            _logger.warning("Could not parse GLB JSON chunk for parts: %s", e)
            return []

    def make_part_groups(self, att_id, att_obj=None):
        if att_obj and att_obj.name and att_obj.name.lower().endswith('.glb') and att_obj.datas:
            names = self._extract_names_from_glb_bytes(base64.b64decode(att_obj.datas))
            if names:
                att_obj.part_names_json = json.dumps(names)

    def run_attachment_job(self, att_id):
        print("===============job started===============")
        attachment = self.env['ir.attachment'].browse(att_id)
        glb_bytes, manifest = self.conversion_process(att_id, attachment.datas)
        if not glb_bytes:
            _logger.error('Invalid glb bytes')
            raise UserError(_('Invalid glb bytes'))

        part_json_names = False
        if manifest:
            part_json_names = json.dumps(list(manifest.keys()))

        # create new GLB attachment
        attachment.write({
            'datas': glb_bytes,
            'name': (attachment.name or 'file.step').lower().replace('.step', '.glb').replace('.stp', '.glb'),
            'mimetype': 'model/gltf-binary',
            'description': f'Converted from {attachment.name}',
            'is_step_processed': True,
            'part_names_json': part_json_names,
            'type': 'binary',
            'public': True,
        })

        self.make_part_groups(att_id)
                
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
