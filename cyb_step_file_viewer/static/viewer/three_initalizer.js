// import * as THREEModules from 'three_modules';
// import { OrbitControls } from 'OrbitControls';
// import { GLTFLoader } from 'GLTFLoader';
import { CadViewer } from '/cyb_step_file_viewer/static/viewer/cad_viewer.js';

// window.THREEModules = THREEModules;
// window.OrbitControls = OrbitControls;
// window.GLTFLoader = GLTFLoader;

document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('cad-viewer-root');
    const file_url = document.getElementById('step_viewer_file_url').value;
    console.log(9999, 'file_url', file_url);
    const viewer = new CadViewer(root, file_url, {
        onClose: () => {
            window.parent.postMessage('close_step_viewer', '*');
        }
    });
});