# -*- coding: utf-8 -*-
{
    'name': "Product Step Viewer",
    'summary': "3D Model Rendering for Product Attached Models",
    'author': 'cybat',
    'depends': ['sale', 'cyb_step_file_viewer', 'product_model_colors'],
    'data': [
        'views/product_product_views.xml',
        'views/website_product_templates.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'cyb_product_step_viewer/static/src/backend_3d_widget.js',
        ],
        'web.assets_frontend': [
            'cyb_product_step_viewer/static/src/step_modal.js',
        ],
    },
    'application': True,
}
