import time
from odoo import models, fields, api


class IrAttachment(models.Model):
    _inherit = 'ir.attachment'

    file_extension = fields.Char()
    is_step_processed = fields.Boolean()

        
    def get_name(self):
        if self.file_extension:
            return f"{time.time()}.{self.file_extension}"
        return ''
