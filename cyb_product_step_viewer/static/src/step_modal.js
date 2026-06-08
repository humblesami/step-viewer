/** @odoo-module **/
import publicWidget from "@web/legacy/js/public/public_widget";

publicWidget.registry.StepViewer = publicWidget.Widget.extend({
    selector: '.step_files_container',
    events: {
        'click .step-file-trigger': '_onStepFileClick',
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
        console.log(attachmentId, 'attachmentId');

        const $modal = $('#step_viewer_iframe_container');
        const $iframe = $('#step_viewer_iframe');

        const web_page = '/cyb_step_file_viewer/static/viewer/cad_viewer.html';
        let query_params = `?file_id=${attachmentId}&filename=${$btn.data('filename')}`;

        if ($btn.data('product-id')) {
            query_params += `&product_id=${$btn.data('product-id')}`;
        }
        const tt = Date.now();
        query_params += `&t=${tt}`;

        let iframeSrc = window.location.origin + web_page + query_params;
        $iframe.attr('src', iframeSrc);
        console.log(iframeSrc, 'iframeSrc');

        $('#product_detail_main').addClass('viewer_active');
        $('#top').addClass('viewer_active');
        $modal.fadeIn(300);
        $('body').css('overflow', 'hidden'); // Prevent background scroll
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
