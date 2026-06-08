{
    'name': 'Step Purchase Portal',
    'version': '19.0.1.0.0',
    'category': 'Website/Portal',
    'summary': 'Allows portal users/vendors to view their Purchase Orders',
    'depends': ['purchase', 'portal', 'cyb_step_file_viewer'],
    'data': [
        'views/purchase_templates.xml',
    ],
    'application': True,
    'author': 'cybat',
    'license': 'LGPL-3',
}