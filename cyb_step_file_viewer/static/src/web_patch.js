/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { WebClient } from "@web/webclient/webclient";

patch(WebClient.prototype, {
    setup(...args) {
        super.setup(...args);
        const busService = useService("bus_service");
        this.notification = useService("notification");
        
        // direct tab communication channel
        this.notifChannel = new BroadcastChannel("step_notifications");
        
        this.notifChannel.onmessage = (event) => {
            if (event.data.type === "CLAIMED") {
                const pending = JSON.parse(localStorage.getItem("notification/pending") || "[]");
                const newPending = pending.filter(id => id !== event.data.item_id);
                localStorage.setItem("notification/pending", JSON.stringify(newPending));
            }
        };

        busService.subscribe("STEP_FILE_PROCESSED", (ev_data) => {
            if (document.visibilityState === 'visible') {
                this.showStepNotification(ev_data);
                this.notifChannel.postMessage({ type: "CLAIMED", item_id: ev_data.item_id });
            } else {
                const pending = JSON.parse(localStorage.getItem("notification/pending") || "[]");
                if (!pending.includes(ev_data.item_id)) {
                    pending.push(ev_data.item_id);
                    localStorage.setItem("notification/pending", JSON.stringify(pending));
                }
                // Store actual data for later if needed, or just re-fetch if we have IDs
                localStorage.setItem(`notification/data/${ev_data.item_id}`, JSON.stringify(ev_data));
            }
        });

        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === 'visible') {
                const pending = JSON.parse(localStorage.getItem("notification/pending") || "[]");
                if (pending.length > 0) {
                    const nextId = pending[0];
                    const dataStr = localStorage.getItem(`notification/data/${nextId}`);
                    if (dataStr) {
                        const data = JSON.parse(dataStr);
                        this.showStepNotification(data);
                        this.notifChannel.postMessage({ type: "CLAIMED", item_id: nextId });
                        
                        // Clear pending
                        const newPending = pending.filter(id => id !== nextId);
                        localStorage.setItem("notification/pending", JSON.stringify(newPending));
                        localStorage.removeItem(`notification/data/${nextId}`);
                    }
                }
            }
        });
    },

    showStepNotification(ev_data) {
        this.notification.add("3D Model Conversion Completed!", {
            title: ev_data.title,
            message: ev_data.message,
            type: "success"
        });
    }
})