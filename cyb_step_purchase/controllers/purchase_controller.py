# -*- coding: utf-8 -*-
import base64
from odoo import http
from odoo.http import request
from odoo.addons.portal.controllers.portal import CustomerPortal


class VendorPurchasePortal(CustomerPortal):

    @http.route('/step_file_viewer/save_model', type='json', auth="user", methods=['POST'], website=True, csrf=False)
    def save_model(self):
        try:
            data = request.httprequest.json
            model_data = data.get('model_data')
            order_line_id = data.get('order_line_id')

            # Create the actual attachment in Odoo
            attachment = request.env['ir.attachment'].sudo().create({
                'name': f'Finished_Model_PO_Line_{order_line_id}.glb',
                'datas': model_data,
                'res_model': 'purchase.order.line',
                'res_id': int(order_line_id),
                'type': 'binary',
                'mimetype': 'model/gltf-binary',
                'public': True,
            })

            # Link it to the purchase order line
            purchase_order_line = request.env['purchase.order.line'].sudo().browse(int(order_line_id))
            purchase_order_line.write({
                'finished_client_model': attachment.id,
            })

            return {'status': 'success', 'message': 'Model saved successfully'}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}

    def _prepare_home_portal_values(self, counters):
        values = super()._prepare_home_portal_values(counters)
        if 'purchase_count' in counters:
            partner = request.env.user.partner_id
            purchase_count = request.env.閲覧.search_count([
                ('partner_id', 'child_of', [partner.commercial_partner_id.id]),
                ('state', 'in', ['purchase', 'done', 'cancel'])
            ]) if request.env['purchase.order'].check_access_rights('read', raise_exception=False) else 0
            values['purchase_count'] = purchase_count
        return values

    @http.route(['/my/purchase', '/my/purchase/page/<int:page>'], type='http', auth="user", website=True)
    def portal_my_purchase_orders(self, page=1, date_begin=None, date_end=None, sortby=None, **kw):
        values = self._prepare_portal_layout_values()
        partner = request.env.user.partner_id
        PurchaseOrder = request.env['purchase.order']

        domain = [
            ('partner_id', 'child_of', [partner.commercial_partner_id.id]),
            ('state', 'in', ['purchase', 'done', 'cancel'])
        ]

        # Count for pager
        purchase_count = PurchaseOrder.search_count(domain)
        # Make pager
        pager = request.website.pager(
            url="/my/purchase",
            total=purchase_count,
            page=page,
            step=10
        )

        # Search orders
        orders = PurchaseOrder.search(domain, limit=10, offset=pager['offset'])

        values.update({
            'orders': orders,
            'page_name': 'purchase',
            'pager': pager,
            'default_url': '/my/purchase',
        })
        return request.render("vendor_purchase_portal.portal_my_purchase_orders", values)