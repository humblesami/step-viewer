{
    'name': "product_model_colors",

    'summary': "Short (1 phrase/line) summary of the module's purpose",


    # any module necessary for this one to work correctly
    'depends': ['product'],
    'author': 'cybat',

    # always loaded
    'data': [
        'security/ir.model.access.csv',
        'views/views.xml',
        'data/demo_data.xml',
    ],
    # only loaded in demonstration mode
    'demo': [
        'demo/demo.xml',
    ],
}

