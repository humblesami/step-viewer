import time
from odoo import models, fields, api


class IrAttachment(models.Model):
    _inherit = 'ir.attachment'

    file_extension = fields.Char()
    is_step_processed = fields.Boolean()
    glb_part_ids = fields.One2many('glb.part', 'att_id')

        
    def get_name(self):
        if self.file_extension:
            return f"{time.time()}.{self.file_extension}"
        return ''


class GlbPart(models.Model):
    _name = 'glb.part'

    part_name = fields.Char()
    part_number = fields.Integer(default=0)
    att_id = fields.Many2one('ir.attachment', string='Attachment', ondelete='cascade')
