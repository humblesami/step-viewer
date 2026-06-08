# -*- coding: utf-8 -*-
{
    'name': "STEP/STP File Viewer | CAD Model Preview",

    'summary': "Preview STEP (.stp) and STP 3D CAD files directly in Odoo ERP.",

    'description': """
Odoo STEP/STP 3D File Viewer | CAD Model Preview
=================================================
Easily preview and visualize STEP (.stp) and CAD 3D models directly inside Odoo ERP.

Features:
------------
- 3D preview of STEP and STP files in Odoo
- Integrated CAD model viewer using Three.js
- Helps engineers, manufacturers, and product designers
- Smooth navigation, zoom, and rotation of 3D models
- Useful for manufacturing, engineering, and product lifecycle management

Keywords:
------------
Odoo STEP viewer, Odoo STP viewer, Odoo 3D viewer, CAD file preview, Odoo engineering module, 
Odoo CAD integration, Odoo 18 CAD extension, Odoo 3D model viewer, Odoo manufacturing design.

""",

    'depends': ['mail', 'web'],
    "author": "Cybat",
    "website": "https://cybat.net",
    "category": "Manufacturing/Engineering",
    "license": "OPL-1",
    "price": 100.00,
    "currency": 'EUR',
    'version': '19.0.0.1',
    'external_dependencies': {'python': ['cadquery']},

    'data': [
        'security/ir.model.access.csv',
        'views/step_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'cyb_step_file_viewer/static/src/web_patch.js',
            'cyb_step_file_viewer/static/src/stp_preview.xml',
        ]
    },
    'images': ['static/description/main_screenshot.gif'],
    'application': True,
}