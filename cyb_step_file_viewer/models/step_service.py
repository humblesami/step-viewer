import os
import json
import struct
import base64
import logging
import tempfile
from odoo import models, fields, _
from odoo.exceptions import UserError
from .step_to_glb_ocp import convert_step_to_glb_with_names

_logger = logging.getLogger(__name__)


class GlbPart(models.Model):
    _name = 'glb.part'

    part_name = fields.Char()
    att_id = fields.Many2one('ir.attachment', string='Attachment', ondelete='cascade')
    

class StepService(models.TransientModel):
    _name = 'step.file.service'
    _description = "Step File Service"

    def process_attachment(self, attachment):
        # self.with_delay().run_attachment_job(attachment.id)
        self.run_attachment_job(attachment)

    def _extract_names_from_glb_bytes(self, glb_bytes):
        """Natively parse the JSON chunk of a GLB file to find mesh/node names."""

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

    def save_glb_parts(self, att_obj, part_names=None):        
        if self.env['glb.part'].search([('att_id', '=', att_obj.id)], limit=1):
            return
        att_id = att_obj.id
        if not part_names:
            glb_bytes = base64.b64decode(att_obj.datas)
            part_names = self._extract_names_from_glb_bytes(glb_bytes)

        dict_names = [{"part_name": n, 'att_id': att_id} for n in part_names]
        self.env['glb.part'].create(dict_names)

    def run_attachment_job(self, attachment):
        print("===============job started===============")
        is_step_file = str(attachment.raw or '').startswith("b\"ISO-10303-21;")                
        if not is_step_file:
            self.save_glb_parts(attachment)
            return
        glb_bytes, manifest = self.conversion_process(attachment.id, attachment.datas)
        if not glb_bytes:
            _logger.error('Invalid glb bytes')
            raise UserError(_('Invalid glb bytes'))

        part_names = False
        if manifest:
            part_names = json.dumps(list(manifest.keys()))

        # create new GLB attachment
        attachment.write({
            'datas': glb_bytes,
            'name': (attachment.name or 'file.step').lower().replace('.step', '.glb').replace('.stp', '.glb'),
            'mimetype': 'model/gltf-binary',
            'description': f'Converted from {attachment.name}',
            'is_step_processed': True,
            'type': 'binary',
            'public': True,
        })

        self.save_glb_parts(attachment, part_names)
                
        self._notify_user(attachment.id)
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
