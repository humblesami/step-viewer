# -*- coding: utf-8 -*-
{
    'name': "Product Step Viewer",
    'summary': "3D Model Rendering for Product Attached Models",
    'author': 'cybat',
    'depends': ['website_sale', 'cyb_step_file_viewer'],
    'data': [
        'views/product_product_views.xml',
        'views/website_product_templates.xml',
    ],
    'assets': {
        'web.assets_frontend': [
            'cyb_product_step_viewer/static/src/step_modal.js',
        ],
    },
    'application': True,
}
