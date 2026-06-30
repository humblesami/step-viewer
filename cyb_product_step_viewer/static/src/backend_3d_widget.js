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
            </style>
            <div style="height: 100vh; width: 100%;">
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
            <t t-if="props.record.data[props.name]">
                <button class="btn btn-primary btn-sm" t-on-click="onClick">
                    Finish your model
                </button>
            </t>
            <span t-else=""></span>
        </div>
    `;

    // Override the native click handler
    async onClick(ev) {
        ev.preventDefault();
        ev.stopPropagation();

        const attachmentId = this.props.record.data[this.props.name].id;
        if (!attachmentId) return;

        const filename = this.props.record.data[this.props.name].display_name;
        const productId = this.props.record.data.product_id.id;
        const lineId = this.props.record.resId;

        // Build your URL matching your exact frontend logic
        const web_page = '/cyb_step_file_viewer/static/viewer/cad_viewer.html';
        let query_params = `?file_id=${attachmentId}&filename=${encodeURIComponent(filename)}`;

        if (productId) {
            query_params += `&product_id=${productId}`;
        }
        if (lineId) {
            query_params += `&line_id=${lineId}`;
        }
        query_params += `&t=${Date.now()}`;
        const iframeSrc = window.location.origin + web_page + query_params;

        // Open your viewer beautifully within a secure backend dialog container
        this.env.services.dialog.add(CADViewerDialog, {
            title: `3D Model Preview - ${filename}`,
            src: iframeSrc,
        });
    }
}

export const many2One3DViewer = {
    component: Many2One3DViewer,
    fieldDependencies: [{ name: "product_id", type: "many2one" }],
};

registry.category("fields").add("many2one_3d_viewer", many2One3DViewer);