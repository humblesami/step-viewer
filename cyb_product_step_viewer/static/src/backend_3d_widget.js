/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Dialog } from "@web/core/dialog/dialog";
import { Component, xml } from "@odoo/owl";

// 1. Define a clean Dialog Wrapper component to host your custom iframe
class CADViewerDialog extends Component {
    static template = xml`
        <Dialog title="props.title" fullscreen="true">
            <style>
                :not(.s_popup) > .modal .modal-dialog{
                    padding:0;
                    margin:0;
                    max-width: 100vw;
                }
                .modal-dialog footer.modal-footer{
                    padding: 5px;
                }
                .modal-dialog .modal-content {
                    height: 100vh;
                }
            </style>
            <div style="height: calc(100vh - 120px); width: 100%;">
                <iframe t-att-src="props.src" style="width: 100%; height: 100%; border: none;"/>
            </div>
        </Dialog>
    `;
    static components = { Dialog };
}

// 2. Extend the standard Backend Many2OneField
export class Many2One3DViewer extends Component {

    static template = xml`
        <div class="d-flex">
            <t t-if="props.record.resModel === 'sale.order.line' and props.record.data.product_step_file_id">
                <button class="btn btn-primary btn-sm" t-on-click="onFinishModelClick">
                    Finish model
                </button>
            </t>
            <t t-elif="props.record.resModel !== 'sale.order.line' and props.record.data[props.name]">
                <button class="btn btn-primary btn-sm" t-on-click="onFinishModelClick">
                    Preview Model
                </button>
            </t>
            <span t-else=""></span>
        </div>
    `;

    // Override the native click handler
    async onFinishModelClick(ev) {
        ev.preventDefault();
        ev.stopPropagation();

        let attachmentId = null;
        let filename = 'Model';

        if (this.props.record.resModel === 'sale.order.line') {
            const stpFile = this.props.record.data.product_step_file_id;
            if (stpFile) {
                attachmentId = Array.isArray(stpFile) ? stpFile[0] : stpFile.id;
                filename = Array.isArray(stpFile) ? stpFile[1] : (stpFile || 'Model');
            }
        } else {
            const dataVal = this.props.record.data[this.props.name];
            if (dataVal) {
                attachmentId = dataVal.id || (Array.isArray(dataVal) ? dataVal[0] : dataVal);
                filename = dataVal.display_name || (Array.isArray(dataVal) ? dataVal[1] : 'Model');
            }
        }

        if (!attachmentId) return;

        let productId = null;
        let lineId = null;
        let templateId = null;

        if (this.props.record.resModel === 'sale.order.line') {
            lineId = this.props.record.resId;
            if (this.props.record.data.product_id) {
                productId = Array.isArray(this.props.record.data.product_id)
                    ? this.props.record.data.product_id[0]
                    : this.props.record.data.product_id.id;
            }
        } else if (this.props.record.resModel === 'product.product') {
            productId = this.props.record.resId;
        } else if (this.props.record.resModel === 'product.template') {
            templateId = this.props.record.resId;
        }

        // Build your URL matching your exact frontend logic
        const web_page = '/cyb_step_file_viewer/static/viewer/cad_viewer.html';
        let query_params = `?file_id=${attachmentId}&filename=${encodeURIComponent(filename)}`;

        if (productId) {
            query_params += `&product_id=${productId}`;
        }
        if (templateId) {
            query_params += `&product_tmpl_id=${templateId}`;
        }
        if (lineId) {
            query_params += `&line_id=${lineId}`;
        }
        if (['product.template', 'product.product'].includes(this.props.record.resModel)) {
            query_params += `&hide_save=1`;
        }
        query_params += `&t=${Date.now()}`;
        const iframeSrc = window.location.origin + web_page + query_params;

        console.log('attachmentId', attachmentId);
        console.log('iframeSrc', iframeSrc);

        // Open your viewer beautifully within a secure backend dialog container
        this.env.services.dialog.add(CADViewerDialog, {
            title: `3D Model Preview - ${filename}`,
            src: iframeSrc,
        });
    }

    async onRestoreModelClick(ev) {
        ev.preventDefault();
        ev.stopPropagation();

        const $btn = $(ev.currentTarget);
        const lineId = $btn.data('line-id');
        const accessToken = $btn.data('access-token');

        if (!confirm('Are you sure you want to restore the original model? All your unsaved modifications will be lost.')) {
            return;
        }

        try {
            const response = await fetch('/step_file_viewer/restore_original_model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ line_id: lineId, access_token: accessToken })
            });
            const result = await response.json();

            if (result.result && result.result.status === 'success') {
                window.location.reload(); // Reload portal page to reflect changes
            } else {
                alert(result.result ? result.result.message : 'Error restoring model');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Failed to restore model');
        }
    }
}

export const many2One3DViewer = {
    component: Many2One3DViewer,
};

registry.category("fields").add("many2one_3d_viewer", many2One3DViewer);