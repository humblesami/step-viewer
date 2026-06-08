# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import request

class ProductStepViewerController(http.Controller):

    @http.route('/step_file_viewer/save_sale_model', type='json', auth="public", methods=['POST'], website=True, csrf=False)
    def save_sale_model(self):
        try:
            data = request.httprequest.json
            model_data = data.get('model_data')
            product_id = int(data.get('product_id'))

            # 1. Implicitly create/get the cart
            order_sudo = request.cart or request.website._create_cart()
            line_id = None
            sale_order_line = None
            existing_lines = order_sudo.order_line.filtered(lambda l: l.product_id.id == product_id)
            if existing_lines:
                sale_order_line = existing_lines[0]
            else:
                values = order_sudo._cart_add(
                    product_id=product_id,
                    add_qty=1,
                )
                line_id = values.get('line_id') if isinstance(values, dict) else False
                sale_order_line = request.env['sale.order.line'].sudo().browse(line_id)
            if not sale_order_line:
                return {'status': 'error', 'message': 'Could not get line id'}

            if sale_order_line.finished_client_model:
                sale_order_line.finished_client_model.sudo().unlink()

            # 4. Save the new custom 3D model
            attachment = request.env['ir.attachment'].sudo().create({
                'name': f'Finished_Model_{sale_order_line.id}.glb',
                'datas': model_data,
                'res_model': 'sale.order.line',
                'res_id': line_id,
                'type': 'binary',
                'mimetype': 'model/gltf-binary',
                'public': True,
            })

            sale_order_line.write({
                'finished_client_model': attachment.id,
            })

            return {'status': 'success', 'message': 'Model added to cart successfully'}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}
