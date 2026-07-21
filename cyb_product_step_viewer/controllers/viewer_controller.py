# -*- coding: utf-8 -*-
import json
import base64
from odoo import http
from odoo.http import request

class ProductStepViewerController(http.Controller):

    @http.route('/step_file_viewer/restore_original_model', type='jsonrpc', auth="public", website=True, csrf=False)
    def restore_original_model(self, **kwargs):
        try:
            line_id = kwargs.get('line_id')
            access_token = kwargs.get('access_token')

            if not line_id:
                return {'status': 'error', 'message': 'Missing line id'}

            sale_order_line = request.env['sale.order.line'].sudo().browse(int(line_id))
            if not sale_order_line.exists():
                return {'status': 'error', 'message': 'Invalid line id'}

            if not request.env.user.has_group('base.group_user') and access_token:
                if sale_order_line.order_id.access_token != access_token:
                     return {'status': 'error', 'message': 'Invalid access token'}

            if sale_order_line.product_id.step_file_id:
                sale_order_line.sudo().write({'model_customization_json': False})
                return {'status': 'success'}
                
            return {'status': 'error', 'message': 'No original model found'}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}


    @http.route('/step_file_viewer/get_customization', type='jsonrpc', auth="public", website=True, csrf=False)
    def get_customization(self, **kwargs):
        try:
            line_id = kwargs.get('line_id')
            access_token = kwargs.get('access_token')
            product_id = kwargs.get('product_id')
            product_template_id = kwargs.get('')

            customization_json = False
            product_colors = []
            product_template = False

            if line_id:
                sale_order_line = request.env['sale.order.line'].sudo().browse(int(line_id))
                if not sale_order_line.exists():
                    return {'status': 'error', 'message': 'Invalid line id'}
                if not request.env.user.has_group('base.group_user') and access_token:
                    if sale_order_line.order_id.access_token != access_token:
                        return {'status': 'error', 'message': 'Invalid access token'}
                customization_json = sale_order_line.model_customization_json
                product_template = sale_order_line.product_id.product_tmpl_id
            elif product_template_id:
                product_template = request.env['product.template'].sudo().browse(int(product_template_id))
            else:
                return {'status': 'error', 'message': 'Missing line id or product id'}

            return {
                'status': 'success',
                'customization_json': customization_json,
            }
        except Exception as e:
            return {'status': 'error', 'message': str(e)}

    @http.route('/step_file_viewer/get_cad_viewer_config', type='jsonrpc', auth="public", website=True, csrf=False)
    def get_cad_viewer_config(self, **kwargs):
        try:
            product_tmpl_id = kwargs.get('product_tmpl_id')
            if not product_tmpl_id:
                return {'status': 'error', 'message': 'Missing product template id'}
                
            product_template = request.env['product.template'].sudo().browse(int(product_tmpl_id))
            if not product_template.exists():
                return {'status': 'error', 'message': 'Template not found'}
                
            groups_data = []
            for group in product_template.parts_groups:
                colors = []
                if group.color_template_id:
                    color_vals = request.env['template.colors.values'].sudo().search([('color_template_id', '=', group.color_template_id.id)])
                    for cv in color_vals:
                        colors.append({
                            'name': cv.color_value,
                            'hex': cv.color_value
                        })
                        
                search_term = group.part_search_id.search_term
                
                groups_data.append({
                    'id': f"group_{group.id}",
                    'displayName': group.group_title or f"Group {group.id}",
                    'searchTerm': search_term,
                    'colors': colors
                })
                
            return {
                'status': 'success',
                'productName': product_template.name,
                'groups': groups_data
            }
        except Exception as e:
            return {'status': 'error', 'message': str(e)}

    @http.route('/step_file_viewer/save_sale_model', type='jsonrpc', auth="public", website=True, csrf=False)
    def save_sale_model(self, **kwargs):
        try:
            customization_json = kwargs.get('customization_json')
            product_id = kwargs.get('product_id')
            passed_line_id = kwargs.get('line_id')
            access_token = kwargs.get('access_token')

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

            sale_order_line.sudo().write({'model_customization_json': customization_json})

            return {'status': 'success', 'message': 'Model saved successfully'}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}
