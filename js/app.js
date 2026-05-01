window.setupPremiumUI = () => {
    console.log("Premium UI Integration Started");

    const customToolbar = document.getElementById('custom-toolbar');
    const intro = document.getElementById('intro');
    const fileInput = document.getElementById('open_file');

    if (!(OV && OV.Engine && typeof OV.Engine.Init3DViewerFromFileList === 'function')) {
        console.log(9989, "Module not found => OV.Init3DViewerFromFileList not found", OV);
        return;
    }

    // 1. Explicitly handle file selection
    fileInput.onchange = (e) => {
        const files = Array.from(e.target.files);
        console.log(99890, OV);
        if (files.length > 0) {
            console.log("Files selected, initializing viewer:", files);
            OV.Engine.Init3DViewerFromFileList(document.getElementById('main_viewer'), files);
        }
    };

    // 2. Monitor visibility
    const observer = new MutationObserver(() => {
        if (intro.style.display === 'none') {
            customToolbar.style.display = 'flex';
        } else {
            customToolbar.style.display = 'none';
        }
    });

    observer.observe(intro, { attributes: true, attributeFilter: ['style'] });

    // 3. Toolbar Actions
    document.getElementById('fit-btn').onclick = () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
    };

    document.getElementById('rotate-btn').onclick = () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    };

    document.getElementById('shot-btn').onclick = () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    };
};
