# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import request

class ProductStepViewerController(http.Controller):

    @http.route('/step_file_viewer/restore_original_model', type='jsonrpc', auth="public", methods=['POST'], website=True, csrf=False)
    def restore_original_model(self):
        try:
            data = request.httprequest.json
            line_id = data.get('line_id')
            access_token = data.get('access_token')

            if not line_id:
                return {'status': 'error', 'message': 'Missing line id'}

            sale_order_line = request.env['sale.order.line'].sudo().browse(int(line_id))
            if not sale_order_line.exists():
                return {'status': 'error', 'message': 'Invalid line id'}

            if not request.env.user.has_group('base.group_user') and access_token:
                if sale_order_line.order_id.access_token != access_token:
                     return {'status': 'error', 'message': 'Invalid access token'}

            if sale_order_line.product_id.step_file_id and sale_order_line.finished_client_model:
                original = sale_order_line.product_id.step_file_id
                sale_order_line.finished_client_model.sudo().write({
                    'datas': original.datas,
                    'name': f'Finished_Model_{sale_order_line.id}_{original.name}',
                })
                return {'status': 'success'}
                
            return {'status': 'error', 'message': 'No original model found'}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}


    @http.route('/step_file_viewer/save_sale_model', type='jsonrpc', auth="public", methods=['POST'], website=True, csrf=False)
    def save_sale_model(self):
        try:
            data = request.httprequest.json
            model_data = data.get('model_data')
            product_id = data.get('product_id')
            passed_line_id = data.get('line_id')
            access_token = data.get('access_token')

            sale_order_line = None

            if passed_line_id:
                sale_order_line = request.env['sale.order.line'].sudo().browse(int(passed_line_id))
                if not sale_order_line.exists():
                    return {'status': 'error', 'message': 'Invalid line id'}
                if not request.env.user.has_group('base.group_user') and access_token:
                    if sale_order_line.order_id.access_token != access_token:
                         return {'status': 'error', 'message': 'Invalid access token'}
            else:
                order_sudo = request.cart or request.website._create_cart()
                existing_lines = order_sudo.order_line.filtered(lambda l: l.product_id.id == int(product_id))
                if existing_lines:
                    sale_order_line = existing_lines[0]
                else:
                    values = order_sudo._cart_add(
                        product_id=int(product_id),
                        add_qty=1,
                    )
                    line_id = values.get('line_id') if isinstance(values, dict) else False
                    sale_order_line = request.env['sale.order.line'].sudo().browse(line_id)

            if not sale_order_line:
                return {'status': 'error', 'message': 'Could not get line id'}

            if sale_order_line.finished_client_model:
                sale_order_line.finished_client_model.sudo().write({'datas': model_data})
            else:
                attachment = request.env['ir.attachment'].sudo().create({
                    'name': f'Finished_Model_{sale_order_line.id}.glb',
                    'datas': model_data,
                    'res_model': 'sale.order.line',
                    'res_id': sale_order_line.id,
                    'type': 'binary',
                    'mimetype': 'model/gltf-binary',
                    'public': True,
                })
                sale_order_line.write({
                    'finished_client_model': attachment.id,
                })

            return {'status': 'success', 'message': 'Model saved successfully'}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}
