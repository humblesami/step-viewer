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
        glb_bytes = self.conversion_process(att_id, attachment.datas)
        if not glb_bytes:
            _logger.error('Invalid glb bytes')
            raise UserError(_('Invalid glb bytes'))

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
                
                convert_step_to_glb(input_stp, output_glb)
                
                glb_bytes = False
                if os.path.exists(output_glb):
                    with open(output_glb, "rb") as f:
                        glb_bytes = base64.b64encode(f.read())

                return glb_bytes

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


def convert_step_to_glb1(input_path, output_path):
    """
    Extracts a 25-part assembly (Logical Level) with 
    perfect 'World' positioning.
    """
    # 1. Load full assembly to preserve hierarchy
    assy = cq.Assembly.load(input_path)
    
    # 2. Traverse to the first branching node (The Pivot)
    # We accumulate the locations of any single-child wrappers we skip
    pivot = assy
    world_transform = cq.Location() # Start at Identity
    
    while len(pivot.children) == 1 and pivot.obj is None:
        world_transform = world_transform * pivot.loc
        pivot = pivot.children[0]
    
    # Apply the pivot's own location to the chain
    world_transform = world_transform * pivot.loc

    # 3. Create a new flat assembly
    flat_assy = cq.Assembly(name="Flattened_Assembly")
    parts_count = 0
    for i, child in enumerate(pivot.children):
        try:
            shape = child.toCompound()
            absolute_loc = world_transform * child.loc
            part_name = child.name or f"Part_{i+1:03d}"
            flat_assy.add(shape, name=part_name, loc=absolute_loc)
            parts_count += 1
        except Exception as e:
            print(f"Error processing {child.name}: {e}")
    print(f"===========parts_count {parts_count}============")
    # 4. Save with high-quality settings
    flat_assy.save(output_path, "GLTF", tolerance=0.5, angularTolerance=0.1, write_binary=True)
    
    final_size = os.path.getsize(output_path) / (1024 * 1024)
    print(f"Success! Parts: {len(flat_assy.children)}, Size: {final_size:.2f} MB")



def convert_step_to_glb(step_file_path, output_path):
    convert_step_to_glb_with_names(step_file_path, output_path)

def convert_step_to_glb1(step_file_path, output_path):
    imported_step = cq.importers.importStep(step_file_path)
    root_shape = imported_step.val()
    all_parts = []
    if hasattr(root_shape, "Solids") and root_shape.Solids():
        all_parts.extend(root_shape.Solids())
    if not all_parts and hasattr(root_shape, "Faces") and root_shape.Faces():
        all_parts.append(root_shape)
    print(f"Exporting to {output_path}... with {len(all_parts)}")
    assy = cq.Assembly(name="RootAssembly")
    for i, part in enumerate(all_parts):
        assy.add(part, name=f"Component_{i+1:03d}")
    assy.save(output_path, "GLTF", tolerance=1.2, angularTolerance=0.8, write_binary=True)

    # Calculate reduction for logs
    final_size = os.path.getsize(output_path) / (1024 * 1024)
    print(f"Success! Final Size: {final_size:.2f} MB")



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
            attachment = self.env['ir.attachment'].search([('res_model', '=', 'step.files'), ('res_id', '=', record.id), ('res_field', '=', 'original_stp')], limit=1)
            self.env['step.file.service'].process_attachment(attachment)
        return records

    def _compute_wait_conversion(self):
        for record in self:
            attachment = self.env['ir.attachment'].search([('res_model', '=', 'step.files'), ('res_id', '=', record.id), ('res_field', '=', 'original_stp')], limit=1)
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

