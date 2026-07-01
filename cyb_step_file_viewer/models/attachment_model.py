import time
from odoo import models, fields, api


class IrAttachment(models.Model):
    _inherit = 'ir.attachment'

    file_extension = fields.Char()
    is_step_processed = fields.Boolean()

    def needs_step_conversion(self):
        is_step_file = str(self.raw or '').startswith("b\"ISO-10303-21;")
        if is_step_file:
            return True
        return False
        
    def get_name(self):
        if self.file_extension:
            return f"{time.time()}.{self.file_extension}"
        return ''
