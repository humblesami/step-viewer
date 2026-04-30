document.addEventListener('DOMContentLoaded', () => {
    let viewer = null;
    let autoRotateActive = false;
    let currentMode = 'shaded';

    const viewerElement = document.getElementById('viewer-container');
    const dropZone = document.getElementById('drop-zone');
    const loadingOverlay = document.getElementById('loading-overlay');
    const partTreeList = document.getElementById('part-tree');
    const modelInfoList = document.getElementById('model-info');

    // 1. Initialize Viewer
    function initViewer(files) {
        if (viewer) {
            // Cleanup existing viewer
            viewerElement.innerHTML = '';
        }

        showLoading(true);

        const settings = {
            backgroundColor: new OV.RGBAColor(13, 15, 26, 255),
            defaultColor: new OV.RGBColor(120, 130, 200),
            edgeSettings: new OV.EdgeSettings(currentMode === 'edges', new OV.RGBColor(99, 102, 241), 1),
        };

        viewer = new OV.EmbeddedViewer(viewerElement, settings);
        
        // Handle multi-file support (STEP/STL)
        viewer.LoadModelFromFileList(files);

        viewer.GetViewer().AddOnFinishEvent(() => {
            showLoading(false);
            updateModelMetadata();
            if (currentMode === 'wireframe') setWireframeMode(true);
        });
    }

    // 2. Metadata & Sidebar
    function updateModelMetadata() {
        const model = viewer.GetModel();
        if (!model) return;

        // Model Stats
        modelInfoList.innerHTML = `
            <li class="info-item">Parts <span class="info-value">${model.MeshInstanceCount()}</span></li>
            <li class="info-item">Triangles <span class="info-value">${model.TriangleCount().toLocaleString()}</span></li>
            <li class="info-item">Vertices <span class="info-value">${model.VertexCount().toLocaleString()}</span></li>
        `;

        // Part Tree
        partTreeList.innerHTML = '';
        for (let i = 0; i < model.MeshInstanceCount(); i++) {
            const mesh = model.GetMeshInstance(i);
            const li = document.createElement('li');
            li.className = 'tree-item';
            li.textContent = mesh.GetName() || `Part ${i + 1}`;
            li.onclick = () => {
                // Focus part
                const boundingBox = mesh.GetBoundingBox();
                viewer.GetViewer().GetCamera().FitToBoundingBox(boundingBox, 1.0);
            };
            partTreeList.appendChild(li);
        }
    }

    // 3. UI Control Handlers
    window.setMode = (mode) => {
        currentMode = mode;
        document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`[onclick="setMode('${mode}')"]`).classList.add('active');

        if (mode === 'wireframe') {
            setWireframeMode(true);
        } else {
            setWireframeMode(false);
            // Re-init for Edge settings change if needed
            const files = viewer.GetInputFiles();
            initViewer(files);
        }
    };

    function setWireframeMode(active) {
        // Access underlying Three.js scene via OV internals if possible, 
        // or re-render with wireframe materials.
        // OV provides a way to get the three viewer
        const threeViewer = viewer.GetViewer().GetMainViewer();
        threeViewer.EnumerateMeshes((mesh) => {
            mesh.material.wireframe = active;
        });
        threeViewer.Render();
    }

    window.toggleAutoRotate = () => {
        autoRotateActive = !autoRotateActive;
        const btn = document.getElementById('rotate-btn');
        btn.classList.toggle('active', autoRotateActive);
        
        const navigation = viewer.GetViewer().GetNavigation();
        
        function spin() {
            if (!autoRotateActive) return;
            navigation.RotateCamera(0.005, 0);
            requestAnimationFrame(spin);
        }
        
        if (autoRotateActive) spin();
    };

    window.zoomToFit = () => {
        if (viewer) viewer.GetViewer().FitToWindow();
    };

    window.takeScreenshot = () => {
        if (!viewer) return;
        const canvas = viewerElement.querySelector('canvas');
        const link = document.createElement('a');
        link.download = 'model-capture.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    // 4. File Drag & Drop
    window.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('active');
    });

    window.addEventListener('dragleave', () => {
        dropZone.classList.remove('active');
    });

    window.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('active');
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) initViewer(files);
    });

    window.triggerUpload = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = '.stp,.step,.stl';
        input.onchange = (e) => {
            const files = Array.from(e.target.files);
            if (files.length > 0) initViewer(files);
        };
        input.click();
    };

    function showLoading(show) {
        loadingOverlay.classList.toggle('visible', show);
    }
});
