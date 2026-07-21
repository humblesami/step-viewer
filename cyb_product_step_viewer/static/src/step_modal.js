/** @odoo-module **/
import publicWidget from "@web/legacy/js/public/public_widget";

publicWidget.registry.StepViewer = publicWidget.Widget.extend({
    selector: '.step_files_container, #quote_content, body',
    events: {
        'click .step-file-trigger': '_onStepFileClick',
        'click .restore-model-trigger': '_onRestoreModelClick',
    },

    init: function () {
        this._super.apply(this, arguments);
        this._onMessage = this._onMessage.bind(this);
    },

    start: function () {
        window.addEventListener('message', this._onMessage);
        return this._super.apply(this, arguments);
    },

    destroy: function () {
        window.removeEventListener('message', this._onMessage);
        this._super.apply(this, arguments);
    },

    _onStepFileClick: function (ev) {
        ev.preventDefault();
        const $btn = $(ev.currentTarget);
        const attachmentId = $btn.data('attachment-id');

        const $modal = $('#step_viewer_iframe_container');
        const $iframe = $('#step_viewer_iframe');

        const web_page = '/cyb_step_file_viewer/static/viewer/cad_viewer1.html';
        let query_params = `?file_id=${attachmentId}&filename=${$btn.data('filename')}`;

        if ($btn.data('product-id')) {
            query_params += `&product_id=${$btn.data('product-id')}`;
        }
        if ($btn.data('line-id')) {
            query_params += `&line_id=${$btn.data('line-id')}`;
        }
        if ($btn.data('access-token')) {
            query_params += `&access_token=${$btn.data('access-token')}`;
        }
        const tt = Date.now();
        query_params += `&t=${tt}`;

        let iframeSrc = window.location.origin + web_page + query_params;
        $iframe.attr('src', iframeSrc);

        if ($('#product_detail_main').length) {
            $('#product_detail_main').addClass('viewer_active');
            $('#top').addClass('viewer_active');
        }
        $modal.fadeIn(300);
        $('body').css('overflow', 'hidden'); // Prevent background scroll
    },

    _onRestoreModelClick: async function (ev) {
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
    },


    _closeViewer: function () {
        const $modal = $('#step_viewer_iframe_container');
        const $iframe = $('#step_viewer_iframe');
        $modal.removeClass('viewer_active');
        $modal.fadeOut(300, () => {
            $iframe.attr('src', ''); // Clear iframe to stop rendering
            $('body').css('overflow', '');
            $('#product_detail_main').removeClass('viewer_active');
            $('#top').removeClass('viewer_active');
        });
    },

    _onMessage: function (ev) {
        if (ev.data === 'close_step_viewer') {
            this._closeViewer();
        }
    },
});
