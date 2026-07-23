/**
 * Standalone Vanilla JS CAD Viewer
 * Extracted from Odoo OWL component gltf_renderer_google.js
 */
import * as THREEModules from 'three_modules';
import { OrbitControls } from 'OrbitControls';
import { GLTFLoader } from 'GLTFLoader';
import { mergeGeometries } from 'BufferGeometryUtils';
import { GLTFExporter } from 'GLTFExporter';

// IndexedDB Caching Helpers
const DB_NAME = 'STP_Viewer_DB';
const STORE_NAME = 'Models';

async function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE_NAME);
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function getCachedModel(url) {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(url);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    } catch (e) { return null; }
}

async function cacheModel(url, buffer) {
    try {
        const db = await openDB();
        db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(buffer, url);
    } catch (e) { console.warn('Cache failed', e); }
}

function applyTriplanarMapping(material, textureScale = 0.05) {
    material.onBeforeCompile = (shader) => {
        shader.uniforms.triplanarScale = { value: textureScale };

        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `
            #include <common>
            varying vec3 vWorldPos;
            varying vec3 vWorldNormal;
            `
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            `
            #include <worldpos_vertex>
            vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
            vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
            `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `
            #include <common>
            uniform float triplanarScale;
            varying vec3 vWorldPos;
            varying vec3 vWorldNormal;
            
            vec4 getTriplanarMap(sampler2D map) {
                vec3 blending = abs(vWorldNormal);
                blending = normalize(max(blending, 0.00001)); 
                float b = (blending.x + blending.y + blending.z);
                blending /= vec3(b, b, b);
                
                vec4 xaxis = texture2D(map, vWorldPos.yz * triplanarScale);
                vec4 yaxis = texture2D(map, vWorldPos.xz * triplanarScale);
                vec4 zaxis = texture2D(map, vWorldPos.xy * triplanarScale);
                
                return xaxis * blending.x + yaxis * blending.y + zaxis * blending.z;
            }
            `
        );
        
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `
            #ifdef USE_MAP
                vec4 sampledDiffuseColor = getTriplanarMap(map);
                diffuseColor *= sampledDiffuseColor;
            #endif
            `
        );
    };
}

export class CadViewer {
    constructor(container, fileUrl, options = {}) {
        this.container = container;
        this.fileUrl = fileUrl;
        this.options = options;

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.animationId = null;
        this.model = null; // The merged fast-render model
        this.originalModel = null; // The full hierarchy for interactivity
        this.mergedMeshes = []; // Keep track of merged objects for disposal
        this.edgeObjects = [];
        this.initialState = null;

        this.lights = {
            ambientLight: null,
            mainLight: null,
            hemiLight: null
        };

        this.rebuildTimeout = null;
        this.colorDebounceTimeout = null;

        const defaultSettings = {
            lighting: {
                ambientIntensity: 0.4,
                mainIntensity: 1.7,
                hemiIntensity: 0.5,
                exposure: 2.2,
            },
            edgeColor: "#000000",
            edgeOpacity: 1,
            bgColor: "#ffffff",
            showEdges: true,
        };

        const savedSettings = JSON.parse(localStorage.getItem('stp_viewer_settings') || '{}');

        // Handle migration of old flat settings to nested lighting settings
        if (savedSettings.ambientIntensity !== undefined && !savedSettings.lighting) {
            savedSettings.lighting = {
                ambientIntensity: savedSettings.ambientIntensity || defaultSettings.lighting.ambientIntensity,
                mainIntensity: savedSettings.mainIntensity || defaultSettings.lighting.mainIntensity,
                hemiIntensity: savedSettings.hemiIntensity || defaultSettings.lighting.hemiIntensity,
                exposure: savedSettings.exposure || defaultSettings.lighting.exposure,
            };
        }

        this.settings = { ...defaultSettings, ...savedSettings };
        if (savedSettings.lighting) {
            this.settings.lighting = { ...defaultSettings.lighting, ...savedSettings.lighting };
        }

        this.state = {
            parts: [],
            assemblyName: 'Assembly',
            loading_model: true,
            cancelling: false,
            showSidebar: false,
            showLightsPopup: false,
            showEdgePopup: false,
            searchQuery: 'others',
            invertSearch: false,
            isSidebarCollapsed: false,
        };

        this.needsRender = true;
        this.idleTimer = null;
        this.isAnimating = true;

        // Store bound handlers for reliable removal
        this._handlers = {
            onOutsideClick: this.onOutsideClick.bind(this),
            onWindowResize: this.onWindowResize.bind(this),
            onMouseMove: this.onMouseMove.bind(this),
            onMouseUp: this.onMouseUp.bind(this),
        };

        this.init();
    }

    checkIfGraphicsAccelerationEnabled() {

        function showGuide() {
            function copyUrl() {
                const urlInput = document.getElementById("chrome-url");
                urlInput.select();
                urlInput.setSelectionRange(0, 99999); /* For mobile devices */

                navigator.clipboard.writeText(urlInput.value).then(() => {
                    alert("Copied to clipboard! Paste this into a new tab.");
                }).catch(err => {
                    console.error('Failed to copy: ', err);
                });
            }
            const threeContainer = document.getElementById("cad-viewer-root");
            threeContainer.innerHTML = `
            <div class="acceleration-guide" 
                style="color:white; padding: 20px; font-size:20px">
                <h3>Enable Hardware Acceleration</h3>
                
                <ol>
                    <li>Copy this link to your clipboard:</li>
                        <div class="copy-box" style="margin:10px;">
                            <input type="text" 
                            style="width: 400px;font-size:20px; color:black" id="chrome-url"
                            value="chrome://settings/?search=acceleration" readonly>
                            <button id="copy-url-btn" style="cursor:pointer">Copy Link</button>
                        </div>
                    <li>Open a new tab in Chrome.</li>
                    <li>Paste the link into the address bar and press <strong>Enter</strong>.</li>
                    <li>Toggle <strong>"Use graphics acceleration when available"</strong> to ON and relaunch Chrome.</li>
                </ol>
            </div>
            `;
            document.getElementById('copy-url-btn').addEventListener('click', copyUrl);
        }

        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl');
            if (!gl) {
                showGuide();
                return false;
            }
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');

            if (!debugInfo) showGuide();
            else {
                console.log(debugInfo, 'WEBGL debug renderer_info');
            }
            return debugInfo;
        } catch (e) {
            showGuide();
            return false;
        }
    }

    init() {
        if (!this.checkIfGraphicsAccelerationEnabled()) {
            return;
        }

        this.bindEvents();
        this.renderUI();
        this.initThree();
    }

    bindEvents() {
        document.addEventListener('mousedown', this._handlers.onOutsideClick);
        window.addEventListener('resize', this._handlers.onWindowResize);
    }

    destroy() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
        window.removeEventListener('resize', this._handlers.onWindowResize);
        document.removeEventListener('mousedown', this._handlers.onOutsideClick);
        window.removeEventListener('mousemove', this._handlers.onMouseMove);
        window.removeEventListener('mouseup', this._handlers.onMouseUp);
        if (this.controls) this.controls.dispose();
        if (this.renderer) this.renderer.dispose();
    }

    initThree() {
        const threeContainer = document.getElementById("three-container");
        if (!threeContainer) return;

        const width = threeContainer.clientWidth;
        const height = threeContainer.clientHeight;

        // --- 1. Scene and Camera ---
        this.scene = new THREEModules.Scene();
        this.scene.background = new THREEModules.Color(this.settings.bgColor);
        this.camera = new THREEModules.PerspectiveCamera(40, width / height, 1.0, 20000);

        // --- 2. Renderer ---
        this.renderer = new THREEModules.WebGLRenderer({
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true
        });
        this.renderer.outputColorSpace = THREEModules.SRGBColorSpace;
        this.renderer.toneMapping = THREEModules.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = this.settings.lighting.exposure;
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        threeContainer.appendChild(this.renderer.domElement);

        // --- 3. Lights ---
        this.lights.ambientLight = new THREEModules.AmbientLight(0xffffff, this.settings.lighting.ambientIntensity * 1.2);

        // Key Light
        this.lights.mainLight = new THREEModules.DirectionalLight(0xffffff, this.settings.lighting.mainIntensity);
        this.lights.mainLight.position.set(500, 500, 500);

        // Fill Light (Front-Left)
        this.lights.fillLight = new THREEModules.DirectionalLight(0xffffff, this.settings.lighting.mainIntensity * 0.7);
        this.lights.fillLight.position.set(-500, 250, 500);

        // Back Light
        this.lights.backLight = new THREEModules.DirectionalLight(0xffffff, this.settings.lighting.mainIntensity * 0.5);
        this.lights.backLight.position.set(0, 250, -750);

        // Top Light
        this.lights.topLight = new THREEModules.DirectionalLight(0xffffff, this.settings.lighting.mainIntensity * 0.4);
        this.lights.topLight.position.set(0, 750, 0);

        // Bottom Light
        this.lights.bottomLight = new THREEModules.DirectionalLight(0xffffff, this.settings.lighting.mainIntensity * 0.4);
        this.lights.bottomLight.position.set(0, -750, 0);

        this.lights.hemiLight = new THREEModules.HemisphereLight(0xffffff, 0x888888, this.settings.lighting.hemiIntensity);

        this.scene.add(this.lights.ambientLight);
        this.scene.add(this.lights.mainLight);
        this.scene.add(this.lights.fillLight);
        this.scene.add(this.lights.backLight);
        this.scene.add(this.lights.topLight);
        this.scene.add(this.lights.bottomLight);
        this.scene.add(this.lights.hemiLight);

        // --- 4. Controls ---
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableRotate = false; // Using custom pivot rotation
        this.controls.enableDamping = false;
        this.controls.screenSpacePanning = true;

        this.isRotating = false;
        this.previousMousePosition = { x: 0, y: 0 };

        this.renderer.domElement.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                this.isRotating = true;
                this.previousMousePosition = { x: e.clientX, y: e.clientY };
                this.resumeRendering();
                document.getElementById("three-container").style.cursor = "grabbing";
            }
        });

        this.renderer.domElement.addEventListener('wheel', () => {
            this.resumeRendering();
        }, { passive: true });

        window.addEventListener('mousemove', this._handlers.onMouseMove);
        window.addEventListener('mouseup', this._handlers.onMouseUp);

        // --- 5. Load model ---
        const loader = new GLTFLoader();
        const progressFill = this.container.querySelector('.progress-fill');


        const loadModelData = async () => {
            let buffer = await getCachedModel(this.fileUrl);

            if (buffer) {
                console.log('9999 Loaded from Cache');
                if (progressFill) progressFill.style.width = '100%';
            } else {
                console.time('Download');
                const response = await fetch(this.fileUrl);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                // Track download progress
                const reader = response.body.getReader();
                const contentLength = +response.headers.get('Content-Length');
                let receivedLength = 0;
                let chunks = [];

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    receivedLength += value.length;
                    if (contentLength && progressFill) {
                        progressFill.style.width = ((receivedLength / contentLength) * 100) + '%';
                    }
                }
                buffer = new Uint8Array(receivedLength);
                let position = 0;
                for (let chunk of chunks) {
                    buffer.set(chunk, position);
                    position += chunk.length;
                }
                console.timeEnd('Download');
                await cacheModel(this.fileUrl, buffer.buffer);
                buffer = buffer.buffer;
            }

            loader.parse(buffer, '', (gltf) => {
                this.originalModel = gltf.scene;
                const box = new THREEModules.Box3().setFromObject(this.originalModel);
                const center = box.getCenter(new THREEModules.Vector3());

                // Center the original model
                this.originalModel.position.set(-center.x, -center.y, -center.z);
                this.originalModel.updateMatrixWorld(true);

                // Pre-calculate world-space geometries and cache them to avoid cloning/transforming in every rebuild
                console.time('Pre-calculate Geometries');
                this.originalModel.traverse((node) => {
                    if (node.isMesh) {
                        const geo = node.geometry.clone();
                        geo.applyMatrix4(node.matrixWorld);
                        node.userData.worldGeometry = geo;
                        node.userData.edgeGeometry = null; // Lazy cache for edges
                    }
                });

                // Get parts list from the original model
                this.state.parts = this.getPartsFromModel(this.originalModel);

                if (this.options.customization && this.options.customization.parts) {
                    // Apply saved customizations
                    const customizations = this.options.customization.parts;
                    const customMap = new Map();
                    customizations.forEach(c => {
                        // Fallback to id if name is missing (for older saved models)
                        if (c.name) customMap.set(c.name, c);
                        else customMap.set(c.id, c);
                    });

                    this.state.parts.forEach(part => {
                        const custom = customMap.get(part.name) || customMap.get(part.id);
                        if (custom) {
                            part.visible = custom.visible;
                            part.color = custom.color;
                            const obj = this.originalModel.getObjectByProperty('uuid', part.id);
                            if (obj) {
                                obj.visible = custom.visible;
                                if (custom.color && custom.color !== '#ffffff') {
                                    obj.traverse((node) => {
                                        if (node.isMesh) {
                                            const oldMat = node.material;
                                            node.material = node.material.clone();
                                            node.material.color.set(custom.color);
                                            if (oldMat) oldMat.dispose();
                                        }
                                    });
                                }
                            }
                        }
                    });
                } else {
                    // Initialize visibility based on default searchQuery ('others')
                    const matchedParts = this.getMatchedParts();
                    const matchedIds = new Set(matchedParts.map(p => p.id));
                    this.state.parts.forEach(part => {
                        const isVisible = matchedIds.has(part.id);
                        part.visible = isVisible;
                        const obj = this.originalModel.getObjectByProperty('uuid', part.id);
                        if (obj) obj.visible = isVisible;
                    });
                }

                // Build the Merged Layer for performance
                this.rebuildMergedModel();

                // Set initial premium orientation: standing vertical with slight tilt
                if (this.model) {
                    // Slight tilt: Backwards (-0.3) and showing right side (0.6)
                    this.model.rotation.set(-0.3, 0.6, 0);
                }

                const size = box.getSize(new THREEModules.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                const fovRad = (this.camera.fov * Math.PI) / 180;
                let dist = Math.abs(maxDim / Math.sin(fovRad / 2)) * 1.2;

                this.camera.position.set(0, dist * 0.2, dist);
                this.controls.target.set(0, 0, 0);
                this.controls.update();

                this.initialState = {
                    position: this.camera.position.clone(),
                    target: this.controls.target.clone()
                };

                this.state.loading_model = false;
                this.needsRender = true;
                this.resumeRendering();
                this.animate();

                this.updateUI();
                const bottom_toolbar = document.querySelector('.o_stp_bottom_toolbar');
                if (bottom_toolbar) {
                    bottom_toolbar.style.display = 'flex';
                }
            }, (err) => {
                console.error("An error occurred while parsing the 3D model:", err);
                this.state.loading_model = false;
                this.updateUI();
            });
        };

        loadModelData().catch(error => {
            console.error("An error occurred while loading the 3D model:", error);
            this.state.loading_model = false;
            this.updateUI();
        });
    }

    rebuildMergedModel() {
        console.time('Rebuild Merged Layer');

        // Persist rotation
        const currentRotation = this.model ? this.model.quaternion.clone() : new THREEModules.Quaternion();

        // Remove old model
        if (this.model) this.scene.remove(this.model);
        this.mergedMeshes.forEach(m => {
            if (m.geometry) m.geometry.dispose();
        });
        this.mergedMeshes = [];

        this.model = new THREEModules.Group();
        this.model.quaternion.copy(currentRotation);
        this.scene.add(this.model);

        // Group geometries by material properties
        const materialGroups = new Map();

        this.originalModel.traverse((node) => {
            if (node.isMesh && node.userData.worldGeometry) {
                // Check effective visibility (is the mesh and all its parents up to originalModel visible?)
                let isEffectiveVisible = node.visible;
                let p = node.parent;
                while (p && p !== this.originalModel && p !== this.scene) {
                    if (!p.visible) {
                        isEffectiveVisible = false;
                        break;
                    }
                    p = p.parent;
                }

                if (isEffectiveVisible) {
                    const mat = node.material;
                    const key = `${mat.color.getHex()}_${mat.opacity}_${mat.transparent}_${mat.metalness || 0}_${mat.roughness || 1}`;

                    if (!materialGroups.has(key)) {
                        materialGroups.set(key, { material: mat, geometries: [] });
                    }

                    // Use pre-calculated world-space geometry
                    materialGroups.get(key).geometries.push(node.userData.worldGeometry);
                }
            }
        });

        // Merge and create optimized meshes
        materialGroups.forEach((group) => {
            if (group.geometries.length > 0) {
                const mergedGeo = mergeGeometries(group.geometries, false);
                if (mergedGeo) {
                    const mergedMesh = new THREEModules.Mesh(mergedGeo, group.material);
                    mergedMesh.matrixAutoUpdate = false;
                    this.model.add(mergedMesh);
                    this.mergedMeshes.push(mergedMesh);
                }
            }
        });

        // Handle Edges if enabled - Delay slightly to not block initial view
        if (this.settings.showEdges) {
            setTimeout(() => this.generateEdges(this.originalModel), 100);
        }

        console.timeEnd('Rebuild Merged Layer');
        this.needsRender = true;
        this.resumeRendering();
    }

    scheduleRebuild(delay = 500) {
        if (this.rebuildTimeout) clearTimeout(this.rebuildTimeout);
        this.rebuildTimeout = setTimeout(() => {
            this.setProcessing(true, 'Updating 3D Model...');
            setTimeout(() => {
                this.rebuildMergedModel();
                this.rebuildTimeout = null;
                this.setProcessing(false);
            }, 500);
        }, delay);
    }

    getPartsFromModel(model) {
        let root = model;
        while (root.children.length === 1 && (root.children[0].type === 'Group' || root.children[0].type === 'Object3D')) {
            root = root.children[0];
        }

        const all_parts = [];

        const traverse = (node, level, parentId) => {
            if (node.isMesh || node.isLineSegments || !node.visible) return;

            // Only treat nodes created by our Python script as actual structural nodes.
            const isStructural = node.name && node.name !== 'Scene' && node.name !== 'RootAssembly';
            const validChildren = node.children.filter(c => !c.isMesh && !c.isLineSegments);

            let currentLevel = level;
            let currentId = parentId;

            if (isStructural) {
                let initialColor = "#cccccc";
                node.traverse((n) => {
                    if (n.isMesh && n.material) {
                        n.material.envMapIntensity = 1.5;
                        if (initialColor === "#cccccc" && n.material.color) {
                            initialColor = "#" + n.material.color.getHexString();
                        }
                    }
                });

                const box = new THREEModules.Box3().setFromObject(node);
                const size = box.getSize(new THREEModules.Vector3());
                const volume = size.x * size.y * size.z;

                currentId = node.uuid;

                all_parts.push({
                    id: currentId,
                    name: node.name,
                    visible: node.visible,
                    color: initialColor,
                    volume: volume,
                    level: currentLevel,
                    parentId: parentId,
                    expanded: false,
                    childrenIds: [] // Populated below
                });

                currentLevel++; // Indent children
            }

            validChildren.forEach(c => traverse(c, currentLevel, currentId));
        };

        traverse(root, 0, null);

        all_parts.forEach(part => {
            part.childrenIds = all_parts.filter(p => p.parentId === part.id).map(p => p.id);
            part.isAssembly = part.childrenIds.length > 0;
        });

        return all_parts;
    }

    getStructuralGroups() {
        if (!this.options.odooPayload || !this.options.odooPayload.groups) {
            return [];
        }
        
        let groupsDict = {'Others': []}
        const groups = this.options.odooPayload.groups;

        this.state.parts.forEach(part => {
            let unmatched = true;
            groups.forEach(group => {
                group.parts.forEach(gp => {
                    if (part.name === gp.part_name) {
                        if (groupsDict[group.displayName]) {
                            groupsDict[group.displayName].push(part);
                        } else {
                            groupsDict[group.displayName] = [part];
                        }
                        unmatched = false;
                    }
                });
            });
            if (unmatched) {
                groupsDict['Others'].push(part);
            }
        });

        let results = [];
        for(const key in groupsDict) {
            let groupConfig = groups.find(g => g.displayName === key);
            let colors = groupConfig ? (groupConfig.colors || []) : [];
            
            if (key === 'Others') {
                colors = [
                    { color_name: 'White', color_value: '#ffffff' },
                    { color_name: 'Black', color_value: '#000000' },
                    { color_name: 'Golden', color_value: '#ffd700' },
                    { color_name: 'Wood', color_value: '#8b5a2b' },
                    { color_name: 'Red', color_value: '#ff0000' },
                    { color_name: 'Green', color_value: '#008000' },
                    { color_name: 'Blue', color_value: '#0000ff' },
                    { color_name: 'Grey', color_value: '#808080' },
                    { color_name: 'Silver', color_value: '#c0c0c0' },
                    { color_name: 'Orange', color_value: '#ffa500' },
                    { color_name: 'Purple', color_value: '#800080' }
                ];
            }

            if (key === 'Others' && groupsDict[key].length === 0) {
                continue;
            }

            results.push({
                id: groupConfig ? groupConfig.id : "group_others",
                displayName: key,
                name: key,
                isOthers: key === 'Others',
                parts: groupsDict[key],
                colors: colors
            });
        }
        
        // Move "Others" to the bottom of the array
        const othersIndex = results.findIndex(g => g.isOthers);
        if (othersIndex !== -1) {
            const othersGroup = results.splice(othersIndex, 1)[0];
            results.push(othersGroup);
        }
        
        return results;
    }

    renderGroupsSidebar() {
        if (!this.options.odooPayload || !this.options.odooPayload.groups) return '';
        
        const groupsList = this.getStructuralGroups();
        
        let savedWidth = localStorage.getItem('left_popup_width') || '300px';
        
        const collapseClass = this.state.isSidebarCollapsed ? 'sidebar-collapsed' : '';
        const popupWidth = this.state.isSidebarCollapsed ? '50px' : savedWidth;
        const displayGroups = this.state.isSidebarCollapsed ? 'none' : 'block';
        const flexDir = this.state.isSidebarCollapsed ? 'column' : 'row';
        const chevronClass = this.state.isSidebarCollapsed ? 'fa-chevron-right' : 'fa-chevron-left';
        const resizeStyle = this.state.isSidebarCollapsed ? '' : 'resize: horizontal;';
        
        const urlParams = new URLSearchParams(window.location.search);
        const hasLineId = urlParams.has('line_id');

        return `
            <div class="popover o_stp_parts_popup ${collapseClass}" style="width: ${popupWidth}; ${resizeStyle}">
                
                <!-- Toolbar Header Area -->
                <div class="sidebar-header" style="flex-direction: ${flexDir}">
                    <button class="btn-sidebar-collapse btn btn-dark" title="Toggle Sidebar">
                        <i class="fa ${chevronClass}"></i>
                    </button>
                    
                    <div style="display: flex; flex-direction: ${flexDir}; gap: 5px; flex-wrap: wrap;" class="sidebar-toolbar-buttons">
                        <button class="btn btn-dark tool-btn tool-btn-zoom-in" title="Zoom In" style="padding: 5px 10px;">
                            <i class="fa fa-search-plus"></i>
                        </button>
                        <button class="btn btn-dark tool-btn tool-btn-zoom-out" title="Zoom Out" style="padding: 5px 10px;">
                            <i class="fa fa-search-minus"></i>
                        </button>
                        <button class="btn btn-dark tool-btn tool-btn-refresh" title="Reset View" style="padding: 5px 10px;">
                            <i class="fa fa-refresh"></i>
                        </button>
                        <button class="btn btn-dark tool-btn tool-btn-snapshot" title="Take Photo (PNG)" style="padding: 5px 10px;">
                            <i class="fa fa-camera"></i>
                        </button>
                        ${hasLineId ? `
                        <button class="btn btn-dark tool-btn tool-btn-save-finished" title="Save Finished 3D Model" style="padding: 5px 10px; color: #4CAF50;">
                            <i class="fa fa-save"></i>
                        </button>
                        ` : ''}
                    </div>
                </div>
                
                <!-- Group List Area -->
                <div class="sidebar-content" style="display: ${displayGroups};">
                    ${groupsList.map((group, groupIdx) => `
                        <div class="group-item">
                            <div class="group-header">
                                <strong class="group-name">
                                    ${group.displayName} (${group.parts.length} parts)
                                </strong>
                                <div class="group-actions" style="display: flex; align-items: center; gap: 8px;">
                                    <button class="btn-vis-group" data-group-index="${groupIdx}" style="background: none; border: none; color: #333333; cursor: pointer;">
                                        <i class="fa fa-eye"></i>
                                    </button>
                                </div>
                            </div>
                            <!-- Palette Grid -->
                            <div class="color-palette-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 10px; justify-items: center;">
                                ${group.colors.map((c, colorIdx) => {
                                    const bgStyle = c.color_image ? `background-image: url('${c.color_image}'); background-size: cover; background-position: center;` : `background-color: ${c.color_value};`;
                                    const imageAttr = c.color_image ? `data-color-image="${c.color_image}"` : '';
                                    return `
                                    <button class="color-btn" data-group-index="${groupIdx}" data-color-value="${c.color_value}" ${imageAttr} title="${c.color_name}" style="border: 2px solid transparent; border-radius: 50%; width: 30px; height: 30px; padding: 0; cursor: pointer; ${bgStyle} box-shadow: 0 0 3px rgba(0,0,0,0.5);"></button>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    bindGroupsSidebarEvents(popoversContainer) {
        if (!this.options.odooPayload || !this.options.odooPayload.groups) return;
        
        const uiPartGroups = this.getStructuralGroups();

        // Collapse toggle binding
        const collapseBtn = popoversContainer.querySelector('.btn-sidebar-collapse');
        if (collapseBtn) {
            collapseBtn.onclick = () => {
                this.state.isSidebarCollapsed = !this.state.isSidebarCollapsed;
                this.updateUI();
                setTimeout(() => {
                    if (this._handlers && this._handlers.onWindowResize) {
                        this._handlers.onWindowResize();
                    }
                }, 10);
            };
        }

        // Save width only after the user finishes resizing (mouseup/touchend)
        if (this._saveWidthHandler) {
            document.removeEventListener('mouseup', this._saveWidthHandler);
            document.removeEventListener('touchend', this._saveWidthHandler);
        }
        this._saveWidthHandler = () => {
            const popupEl = popoversContainer.querySelector('.o_stp_parts_popup');
            if (popupEl && !this.state.isSidebarCollapsed) {
                const pxWidth = popupEl.offsetWidth;
                if (pxWidth > 60) {
                    localStorage.setItem('left_popup_width', pxWidth + 'px');
                }
            }
            if (this._handlers && this._handlers.onWindowResize) {
                this._handlers.onWindowResize();
            }
        };
        document.addEventListener('mouseup', this._saveWidthHandler);
        document.addEventListener('touchend', this._saveWidthHandler);

        // Toolbar tools binding
        const zoomInBtn = popoversContainer.querySelector('.tool-btn-zoom-in');
        if (zoomInBtn) zoomInBtn.onclick = () => this.zoomIn();
        
        const zoomOutBtn = popoversContainer.querySelector('.tool-btn-zoom-out');
        if (zoomOutBtn) zoomOutBtn.onclick = () => this.zoomOut();
        
        const refreshBtn = popoversContainer.querySelector('.tool-btn-refresh');
        if (refreshBtn) refreshBtn.onclick = () => this.resetView();
        
        const snapshotBtn = popoversContainer.querySelector('.tool-btn-snapshot');
        if (snapshotBtn) snapshotBtn.onclick = () => this.takeSnapshot();
        
        const saveBtn = popoversContainer.querySelector('.tool-btn-save-finished');
        if (saveBtn) {
            saveBtn.onclick = () => {
                this.setProcessing(true, 'Saving Customizations...');
                setTimeout(() => {
                    let dt1 = Date.now();
                    const modifications = this.state.parts.map(p => ({
                        id: p.id,
                        name: p.name,
                        color: p.color,
                        visible: p.visible
                    }));
                    const customizationJSON = JSON.stringify({ parts: modifications });
                    
                    if (window.saveCustomizations) {
                        window.saveCustomizations(customizationJSON, dt1).finally(() => {
                            this.setProcessing(false);
                        });
                    } else {
                        console.error('save To Odoo function not found globally');
                        this.setProcessing(false);
                    }
                }, 50);
            };
        }
        
        // Group level color binding (palette)
        popoversContainer.querySelectorAll('.color-btn').forEach(btn => {
            btn.onclick = (e) => {
                const groupIdx = parseInt(e.currentTarget.dataset.groupIndex, 10);
                const colorValue = e.currentTarget.dataset.colorValue;
                const color_image = e.currentTarget.dataset.colorImage;
                const group = uiPartGroups[groupIdx];
                

                
                // Update active styling
                const grid = e.currentTarget.closest('.color-palette-grid');
                if (grid) {
                    grid.querySelectorAll('.color-btn').forEach(b => b.style.borderColor = 'transparent');
                    e.currentTarget.style.borderColor = '#4CAF50';
                }

                group.parts.forEach(p => {
                    p.color = colorValue;
                    p.colorImage = color_image;

                    const partObj = this.originalModel.getObjectByProperty('uuid', p.id);
                    if (!partObj) return;

                    partObj.traverse(child => {
                        if (!(child.isMesh && child.material)) return;

                        const mat = child.material.clone();
                        
                        if (color_image) {
                            if (!this.textureCache) this.textureCache = new Map();
                            let texture = this.textureCache.get(color_image);
                            if (!texture) {
                                const textureLoader = new THREEModules.TextureLoader();
                                texture = textureLoader.load(color_image, () => {
                                    this.rebuildMergedModel();
                                });
                                texture.wrapS = THREEModules.RepeatWrapping;
                                texture.wrapT = THREEModules.RepeatWrapping;
                                this.textureCache.set(color_image, texture);
                            }
                            
                            applyTriplanarMapping(mat, 0.02);
                            mat.map = texture;
                            mat.color.setHex(0xffffff);
                        } else {
                            mat.map = null;
                            mat.color.set(colorValue);
                        }
                        
                        mat.needsUpdate = true;
                        child.material = mat;
                    });
                });
                this.rebuildMergedModel();
            };
        });

        console.log(777);

        // Group level visibility binding
        popoversContainer.querySelectorAll('.btn-vis-group').forEach(btn => {
            btn.onclick = (e) => {
                const groupIdx = parseInt(e.currentTarget.dataset.groupIndex, 10);
                const group = uiPartGroups[groupIdx];
                const anyVisible = group.parts.some(p => p.visible);
                const newVis = !anyVisible;
                
                group.parts.forEach(p => {
                    p.visible = newVis;
                    const partObj = this.originalModel.getObjectByProperty('uuid', p.id);
                    if (partObj) partObj.visible = newVis;
                });
                
                // Toggle icon
                const icon = e.currentTarget.querySelector('i');
                if (icon) {
                    icon.className = newVis ? 'fa fa-eye' : 'fa fa-eye-slash';
                }

                this.rebuildMergedModel();
            };
        });
    }

    getDescendantIds(partId) {
        const descendants = [];
        const part = this.state.parts.find(p => p.id === partId);
        if (!part) return descendants;

        const traverse = (p) => {
            p.childrenIds.forEach(childId => {
                descendants.push(childId);
                const child = this.state.parts.find(c => c.id === childId);
                if (child) traverse(child);
            });
        };
        traverse(part);
        return descendants;
    }

    generateEdges(model) {
        console.time('Generate Edges');
        this.edgeObjects.forEach(edge => {
            if (edge.parent) edge.parent.remove(edge);
            if (edge.geometry) edge.geometry.dispose();
            if (edge.material) edge.material.dispose();
        });
        this.edgeObjects = [];

        const edgeGeometries = [];
        const edgeMat = new THREEModules.LineBasicMaterial({
            color: new THREEModules.Color(this.settings.edgeColor),
            transparent: true,
            opacity: this.settings.edgeOpacity
        });

        model.traverse((node) => {
            if (node.isMesh && node.visible && node.userData.worldGeometry) {
                // Use cached edge geometry if available
                if (!node.userData.edgeGeometry) {
                    node.userData.edgeGeometry = new THREEModules.EdgesGeometry(node.geometry, 15);
                    node.userData.edgeGeometry.applyMatrix4(node.matrixWorld);
                }
                edgeGeometries.push(node.userData.edgeGeometry);
            }
        });

        if (edgeGeometries.length > 0) {
            const mergedEdgeGeo = mergeGeometries(edgeGeometries, false);
            if (mergedEdgeGeo) {
                const mergedEdges = new THREEModules.LineSegments(mergedEdgeGeo, edgeMat);
                mergedEdges.matrixAutoUpdate = false;
                this.model.add(mergedEdges);
                this.edgeObjects.push(mergedEdges);
            }
        }
        console.timeEnd('Generate Edges');
        this.needsRender = true;
    }

    updateSetting(key, value) {
        this.setProcessing(true, 'Updating Rendering...');
        setTimeout(() => {
            if (key === 'ambientIntensity') {
                this.settings.lighting.ambientIntensity = parseFloat(value);
                this.lights.ambientLight.intensity = parseFloat(value) * 1.2;
            }
            if (key === 'mainIntensity') {
                const val = parseFloat(value);
                this.settings.lighting.mainIntensity = val;
                this.lights.mainLight.intensity = val;
                this.lights.fillLight.intensity = val * 0.7;
                this.lights.backLight.intensity = val * 0.5;
                this.lights.topLight.intensity = val * 0.4;
                this.lights.bottomLight.intensity = val * 0.4;
            }
            if (key === 'hemiIntensity') {
                this.settings.lighting.hemiIntensity = parseFloat(value);
                this.lights.hemiLight.intensity = parseFloat(value);
            }
            if (key === 'exposure') {
                this.settings.lighting.exposure = parseFloat(value);
                this.renderer.toneMappingExposure = parseFloat(value);
            }

            if (key === 'bgColor') {
                this.settings.bgColor = value;
                this.scene.background.set(value);
            }

            if (key === 'edgeColor' || key === 'edgeOpacity') {
                const color = new THREEModules.Color(this.settings.edgeColor);
                const opacity = parseFloat(this.settings.edgeOpacity);
                this.edgeObjects.forEach(edge => {
                    if (edge.material) {
                        edge.material.color.copy(color);
                        edge.material.opacity = opacity;
                    }
                });
            }
            this.needsRender = true;
            this.resumeRendering();
            localStorage.setItem('stp_viewer_settings', JSON.stringify(this.settings));
            this.setProcessing(false);
        }, 20);
    }

    onMouseMove(e) {
        if (this.isRotating && this.model) {
            const deltaMove = {
                x: e.clientX - this.previousMousePosition.x,
                y: e.clientY - this.previousMousePosition.y
            };

            const moveSpeed = 0.01;
            const deltaRotationQuaternion = new THREEModules.Quaternion()
                .setFromEuler(new THREEModules.Euler(
                    deltaMove.y * moveSpeed,
                    deltaMove.x * moveSpeed,
                    0,
                    'XYZ'
                ));

            this.model.quaternion.multiplyQuaternions(deltaRotationQuaternion, this.model.quaternion);
            this.previousMousePosition = { x: e.clientX, y: e.clientY };
            this.needsRender = true;
            this.resumeRendering();
        }
    }

    onMouseUp() {
        this.isRotating = false;
        const container = document.getElementById("three-container");
        if (container) container.style.cursor = "grab";
    }

    toggleEdges() {
        const newState = !this.settings.showEdges;
        this.settings.showEdges = newState;

        // Lazy generation of edges if they don't exist yet
        if (newState && this.edgeObjects.length === 0 && this.model) {
            this.generateEdges(this.model);
        }

        this.edgeObjects.forEach(edge => edge.visible = newState);
        this.needsRender = true;
        this.resumeRendering();
        localStorage.setItem('stp_viewer_settings', JSON.stringify(this.settings));
        this.updateUI();
    }

    onOutsideClick(ev) {
        let changed = false;
        const edgePopup = document.querySelector('.o_stp_edge_popup');
        const edgeBtn = document.querySelector('.tool-btn-edge-settings');
        if (this.state.showEdgePopup && edgePopup && !edgePopup.contains(ev.target) && edgeBtn && !edgeBtn.contains(ev.target)) {
            this.state.showEdgePopup = false;
            changed = true;
        }
        const lightsPopup = document.querySelector('.o_stp_lights_popup');
        const lightsBtn = document.querySelector('.tool-btn-lights');
        if (this.state.showLightsPopup && lightsPopup && !lightsPopup.contains(ev.target) && lightsBtn && !lightsBtn.contains(ev.target)) {
            this.state.showLightsPopup = false;
            changed = true;
        }
        if (changed) {
            this.updateUI();
        }
    }

    toggleSidebar() {
        this.state.showSidebar = !this.state.showSidebar;
        if (this.state.showSidebar) {
            this.state.showLightsPopup = false;
            this.state.showEdgePopup = false;
        }
        this.updateUI();
    }

    toggleLightsPopup() {
        this.state.showLightsPopup = !this.state.showLightsPopup;
        if (this.state.showLightsPopup) {
            this.state.showSidebar = false;
            this.state.showEdgePopup = false;
        }
        this.updateUI();
    }

    toggleEdgePopup() {
        this.state.showEdgePopup = !this.state.showEdgePopup;
        if (this.state.showEdgePopup) {
            this.state.showSidebar = false;
            this.state.showLightsPopup = false;
        }
        this.updateUI();
    }

    resetView() {
        if (this.initialState && this.camera && this.controls) {
            this.camera.position.copy(this.initialState.position);
            this.controls.target.copy(this.initialState.target);
            this.controls.update();

            if (this.model) {
                this.model.rotation.set(0, 0, 0);
                this.model.quaternion.set(0, 0, 0, 1);
            }
        }
        this.needsRender = true;
        this.resumeRendering();
    }

    onGlobalColorChange(ev, immediate = false) {
        const color = ev.target.value;
        if (this.colorDebounceTimeout) clearTimeout(this.colorDebounceTimeout);

        const apply = () => {
            this.setProcessing(true, 'Applying Color...');
            setTimeout(() => {
                const matchedParts = this.getMatchedParts();
                const matchedIds = new Set(matchedParts.map(p => p.id));

                matchedParts.forEach(part => {
                    part.color = color;
                    const obj = this.originalModel.getObjectByProperty('uuid', part.id);
                    if (obj) {
                        obj.traverse((node) => {
                            if (node.isMesh) {
                                const oldMat = node.material;
                                node.material = node.material.clone();
                                node.material.color.set(color);
                                if (oldMat) oldMat.dispose();
                            }
                        });
                    }
                });

                const pickers = this.container.querySelectorAll('.part-color-picker');
                pickers.forEach(p => {
                    if (matchedIds.has(p.dataset.partId)) p.value = color;
                });
                this.rebuildMergedModel();
                this.resumeRendering();
                this.setProcessing(false);
            }, 50);
        };

        if (immediate) {
            apply();
        } else {
            this.colorDebounceTimeout = setTimeout(apply, 1000);
        }
    }

    onColorChange(ev, partId, immediate = false) {
        const color = ev.target.value;
        if (this.colorDebounceTimeout) clearTimeout(this.colorDebounceTimeout);

        const apply = () => {
            this.setProcessing(true, 'Applying Color...');
            setTimeout(() => {
                const part = this.state.parts.find(p => p.id === partId);
                if (part) {
                    const idsToColor = [partId, ...this.getDescendantIds(partId)];
                    idsToColor.forEach(id => {
                        const p = this.state.parts.find(x => x.id === id);
                        if (p) p.color = color;

                        const obj = this.originalModel.getObjectByProperty('uuid', id);
                        if (obj) {
                            obj.traverse((node) => {
                                if (node.isMesh) {
                                    const oldMat = node.material;
                                    node.material = node.material.clone();
                                    node.material.color.set(color);
                                    if (oldMat) oldMat.dispose();
                                }
                            });
                        }

                        const picker = this.container.querySelector(`.part-color-picker[data-part-id="${id}"]`);
                        if (picker) picker.value = color;
                    });
                }
                this.rebuildMergedModel();
                this.resumeRendering();
                this.setProcessing(false);
            }, 50);
        };

        if (immediate) apply();
        else this.colorDebounceTimeout = setTimeout(apply, 1000);
    }

    toggleVisibility(ev, partId) {
        const btn = ev.currentTarget;
        const part = this.state.parts.find(p => p.id === partId);
        if (part) {
            const targetVisible = !part.visible;
            const idsToToggle = [partId, ...this.getDescendantIds(partId)];

            idsToToggle.forEach(id => {
                const p = this.state.parts.find(x => x.id === id);
                if (p) {
                    p.visible = targetVisible;
                    const obj = this.originalModel.getObjectByProperty('uuid', id);
                    if (obj) obj.visible = targetVisible;

                    const dBtn = this.container.querySelector(`.btn-vis[data-part-id="${id}"]`);
                    if (dBtn) {
                        dBtn.className = `btn-vis ${targetVisible ? 'active' : ''}`;
                        const icon = dBtn.querySelector('i');
                        if (icon) icon.className = `fa ${targetVisible ? 'fa-eye' : 'fa-eye-slash'}`;
                    }
                }
            });

            // const globalBtn = this.container.querySelector('.global-toggle-btn');
            // if (globalBtn) this.updateGlobalToggleUI(globalBtn, this.globalVisibilityState);
        }
        this.scheduleRebuild(300);
    }

    get globalVisibilityState() {
        const matchedParts = this.getMatchedParts();
        if (matchedParts.length === 0) return 'none';

        const visibleCount = matchedParts.filter(p => p.visible).length;
        if (visibleCount === 0) return 'none';
        if (visibleCount === matchedParts.length) return 'all';
        return 'mixed';
    }

    updateGlobalToggleUI(btn, state) {
        const matchedCount = this.getMatchedParts().length;
        const totalCount = this.state.parts.length;
        const noun = matchedCount < totalCount ? ` MATCHES` : 'ALL';

        const icon = btn.querySelector('i');
        const text = btn.querySelector('.btn-text');
        if (state === 'all') {
            btn.className = 'btn btn-primary drawer-action-btn flex-grow-1 global-toggle-btn';
            if (icon) icon.className = 'fa fa-eye';
            if (text) text.innerText = `HIDE ${noun}`;
        } else if (state === 'none') {
            btn.className = 'btn btn-outline-light drawer-action-btn flex-grow-1 global-toggle-btn';
            if (icon) icon.className = 'fa fa-eye-slash';
            if (text) text.innerText = `SHOW ${noun}`;
        } else {
            btn.className = 'btn btn-warning drawer-action-btn flex-grow-1 global-toggle-btn';
            if (icon) icon.className = 'fa fa-adjust';
            if (text) text.innerText = `MIXED (HIDE ${noun})`;
        }
    }

    takeSnapshot() {
        if (!this.renderer) return;
        const dataURL = this.renderer.domElement.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `3d_snapshot_${new Date().getTime()}.png`;
        link.href = dataURL;
        link.click();
    }

    downloadModel() {
        this.setProcessing(true, 'Preparing Download... Please wait');
        setTimeout(() => {
            const exporter = new GLTFExporter();
            const options = {
                binary: true,
                onlyVisible: true, // Only download what's currently visible
                maxTextureSize: 4096
            };

            // Export the originalModel because it has the user's color/visibility modifications
            exporter.parse(
                this.originalModel,
                (result) => {
                    const blob = new Blob([result], { type: 'application/octet-stream' });
                    const link = document.createElement('a');
                    const filename = (this.options.filename || 'model.glb').replace('.step', '.glb').replace('.stp', '.glb');

                    link.href = URL.createObjectURL(blob);
                    link.download = filename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(link.href);
                    this.setProcessing(false);
                },
                (error) => {
                    console.error('An error happened during GLTF export:', error);
                    this.setProcessing(false);
                },
                options
            );
        }, 50);
    }

    zoomIn() {
        this.camera.position.lerp(this.controls.target, 0.2);
        this.needsRender = true;
        this.resumeRendering();
    }

    zoomOut() {
        this.camera.position.lerp(this.controls.target, -0.2);
        this.needsRender = true;
        this.resumeRendering();
    }

    animate() {
        if (!this.isAnimating) return;
        this.animationId = requestAnimationFrame(this.animate.bind(this));

        const controlsUpdated = this.controls && this.controls.update();
        if (controlsUpdated) this.needsRender = true;

        if (this.needsRender && this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
            this.needsRender = false;
            this.resetIdleTimer();
        }
    }

    resetIdleTimer() {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
            this.pauseRendering();
        }, 5000);
    }

    pauseRendering() {
        this.isAnimating = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    resumeRendering() {
        this.needsRender = true;
        if (!this.isAnimating) {
            this.isAnimating = true;
            this.animate();
        }
        this.resetIdleTimer();
    }

    interruptAndClose() {
        this.state.cancelling = true;
        this.pauseRendering();
        if (this.options.onClose) {
            this.options.onClose();
        }
    }

    onWindowResize() {
        const c = document.getElementById("three-container");
        if (c && this.camera && this.renderer) {
            this.camera.aspect = c.clientWidth / c.clientHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(c.clientWidth, c.clientHeight);
            this.needsRender = true;
            this.resumeRendering();
        }
    }

    getMatchedParts() {
        const query = this.state.searchQuery === undefined || this.state.searchQuery === null ? 'others' : this.state.searchQuery;
        if (!query) {
            return [];
        }

        const terms = query.toLowerCase().split('+').filter(t => t);

        return this.state.parts.filter(part => {
            const partNameLower = part.name.toLowerCase();
            let matches = false;
            if (terms.length > 0) {
                for (const term of terms) {
                    if (term === 'others') {
                        if (!partNameLower.includes('int') && !partNameLower.includes('ext') && !partNameLower.includes('met')) {
                            matches = true;
                            break;
                        }
                    } else {
                        if (partNameLower.includes(term)) {
                            matches = true;
                            break;
                        }
                    }
                }
            } else {
                matches = true;
            }
            return matches;
        });
    }

    updatePaintGlobalUI() {
        const paintLabel = this.container.querySelector('.global-paint-row .part-name-text');
        if (paintLabel) {
            const count = this.getMatchedParts().length;
            paintLabel.innerText = `Paint ${count} Shown Parts`;
        }
    }

    providePartsSearch(query, invert = null) {
        if (query !== null) this.state.searchQuery = query;

        const popup = this.container.querySelector('.o_stp_parts_popup');
        if (!popup) return;

        const matchedParts = this.getMatchedParts();
        const matchedIds = new Set(matchedParts.map(p => p.id));

        this.setProcessing(true, 'Filtering parts... Please wait');
        setTimeout(() => {
            // Sidebar DOM filter & 3D Canvas updates (ignoring tree parents)
            this.state.parts.forEach((part) => {
                const isVisible = matchedIds.has(part.id);

                const partEl = popup.querySelector(`.part-item-modern[data-part-id="${part.id}"]`);
                if (partEl) {
                    partEl.style.display = isVisible ? '' : 'none';
                }

                // Sync 3D Canvas visibility
                part.visible = isVisible;
                const obj = this.originalModel.getObjectByProperty('uuid', part.id);
                if (obj) obj.visible = isVisible;

                const btn = this.container.querySelector(`.btn-vis[data-part-id="${part.id}"]`);
                if (btn) {
                    btn.className = `btn-vis ${isVisible ? 'active' : ''}`;
                    const icon = btn.querySelector('i');
                    if (icon) icon.className = `fa ${isVisible ? 'fa-eye' : 'fa-eye-slash'}`;
                }
            });

            this.rebuildMergedModel();

            const matchCountSpan = popup.querySelector('#matching_count');
            if (matchCountSpan) {
                matchCountSpan.innerText = matchedParts.length;
            }

            const clearBtn = popup.querySelector('.clear-search-btn');
            if (clearBtn) {
                clearBtn.style.opacity = this.state.searchQuery ? '0.6' : '0';
                clearBtn.style.pointerEvents = this.state.searchQuery ? 'auto' : 'none';
            }
            this.updatePaintGlobalUI();
            this.setProcessing(false);
        }, 50);
    }

    // UI Rendering & Updates
    renderUI() {
        // Initial static structure
        this.container.innerHTML = `
            <div class="o_stp_preview_container" style="display: flex; flex-direction: row; width: 100vw; height: 100vh; overflow: hidden;">
                <div id="popovers-container" style="flex-shrink: 0; position: relative; height: 100%;"></div>
                <div id="three-container" style="flex-grow: 1; height: 100%; cursor: grab; position: relative; overflow: hidden;"></div>
                <div id="loader-container" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 9999; display: none; justify-content: center; align-items: center; background: rgba(0,0,0,0.6); pointer-events: auto;">
                    <div class="o_stp_glass_loader" style="">                        
                        <h2>3d Model Viewer</h2>
                        <div class="" style="display: flex;justify-content: center;">
                            <div class="model-loader-spinner"></div>                            
                        </div>                        
                        <p class="message">Loading...</p>
                    </div>
                </div>
            </div>
        `;

        this.updateUI();
        // this.toggleSidebar(); // Removed so we don't automatically open the old sidebar logic
    }

    setProcessing(isProcessing, message = 'Processing...') {
        let loaderWrapper = this.container.querySelector('#loader-container');
        console.log(5545, "showing loaiud", isProcessing)
        if (!loaderWrapper) return;
        if (isProcessing) {
            let msgEl = loaderWrapper.querySelector('.message');
            if (msgEl) msgEl.innerText = message;
            loaderWrapper.style.display = 'flex';
        } else {
            if (this.state.loading_model) {
                this.updateUI();
            } else {
                loaderWrapper.style.display = 'none';
            }
        }
    }

    updateUI() {
        const popoversContainer = this.container.querySelector('#popovers-container');
        const loaderContainer = this.container.querySelector('#loader-container');

        // Save scroll position of the assembly list
        let sidebarScrollTop = 0;
        const sidebarContent = this.container.querySelector('.sidebar-content');
        if (sidebarContent) {
            sidebarScrollTop = sidebarContent.scrollTop;
        }

        const bgColorPicker = this.container.querySelector('.global-color-picker');
        const edgeBtn = this.container.querySelector('.tool-btn-edge');
        const lightsBtn = this.container.querySelector('.tool-btn-lights');

        if (bgColorPicker) bgColorPicker.value = this.settings.bgColor;
        if (edgeBtn) edgeBtn.className = `btn tool-btn tool-btn-edge ${this.settings.showEdges ? 'btn-primary' : 'btn-dark'}`;

        const edgeSettingsBtn = this.container.querySelector('.tool-btn-edge-settings');
        if (edgeSettingsBtn) edgeSettingsBtn.className = `btn tool-btn tool-btn-edge-settings ${this.state.showEdgePopup ? 'btn-primary' : 'btn-dark'}`;

        if (lightsBtn) lightsBtn.className = `btn tool-btn tool-btn-lights ${this.state.showLightsPopup ? 'btn-primary' : 'btn-dark'}`;

        let popoversHtml = this.renderGroupsSidebar();
        popoversContainer.innerHTML = popoversHtml;
        this.bindGroupsSidebarEvents(popoversContainer);

        // Loader
        if (this.state.loading_model) {
            this.setProcessing(true, 'Loading...');
            const interruptBtn = loaderContainer.querySelector('.interrupt');
            if (interruptBtn) interruptBtn.onclick = () => this.interruptAndClose();
        } else {
            this.setProcessing(false);
        }
    }

    init_group_search() {
        const self = this;
        const container = document.querySelector('.o_stp_preview_container .int_ext_met');
        if (!container) return;

        const search_input = document.querySelector('.o_stp_preview_container .part-search-input');

        container.querySelectorAll('.btn_filter').forEach(btn => {
            btn.onclick = (ev) => {
                const target = ev.target;
                target.classList.toggle('selected');

                const terms = [];
                container.querySelectorAll('.btn_filter.selected').forEach(b => {
                    terms.push(b.dataset.term);
                });

                const searchKeyword = terms.join('+');
                if (search_input) search_input.value = searchKeyword;

                self.providePartsSearch(searchKeyword, null);
            };
        });
    }
}

async function initApp() {
    const root = document.getElementById('cad-viewer-root');
    if (!root) return;
    
    let attachment_id = findQueryParam('file_id');
    let filename = findQueryParam('filename');
    let file_url = document.getElementById('step_viewer_file_url') ? document.getElementById('step_viewer_file_url').value : '';
    
    if (attachment_id) {
        file_url = window.location.origin + `/web/content/${attachment_id}`;
        if (filename) {
            file_url += `/` + filename;
        }
        // Add a cache-buster so the browser doesn't load the old HTTP cache
        file_url += `?t=${new Date().getTime()}`;
    }

    let product_id = findQueryParam('product_id');
    let product_tmpl_id = findQueryParam('product_tmpl_id');
    let line_id = findQueryParam('line_id');
    let access_token = findQueryParam('access_token');
    let hide_save = findQueryParam('hide_save');

    let customizationData = null;
    let productColorsData = null;
    if (line_id || product_id) {
        try {
            let url = '/step_file_viewer/get_customization';
            let req_body = {};
            if (line_id) req_body.line_id = line_id;
            if (product_id) req_body.product_id = product_id;
            if (access_token) req_body.access_token = access_token;

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ params: req_body })
            });
            if (response.ok) {
                const responseJSON = await response.json();
                if (responseJSON.result && responseJSON.result.status === 'success') {
                    if (responseJSON.result.customization_json) {
                        customizationData = JSON.parse(responseJSON.result.customization_json);
                    }
                    if (responseJSON.result.product_colors) {
                        productColorsData = responseJSON.result.product_colors;
                    }
                }
            }
        } catch (e) { console.error('Error fetching customization', e); }
    }

    let dataFromServer = null;
    if (product_tmpl_id) {
        try {
            const configResponse = await fetch('/step_file_viewer/get_cad_viewer_config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "call",
                    params: { product_tmpl_id: product_tmpl_id }
                })
            });
            const result = await configResponse.json();
            if (result.result && result.result.status === 'success') {
                dataFromServer = result.result;
            }
        } catch (e) {
            console.error("Failed to fetch config", e);
        }
    }

    const viewer = new CadViewer(root, file_url, {
        onClose: () => {
            window.parent.postMessage('close_step_viewer', '*');
        },
        customization: customizationData,
        productColors: productColorsData,
        odooPayload: dataFromServer
    });

    if ((!product_id && !line_id) || hide_save) {
        return;
    }

    async function saveCustomizations(customizationJSON, dt1) {
        try {
            let url = '/step_file_viewer/save_sale_model';

            let bodyData = { customization_json: customizationJSON };
            if (product_id) bodyData.product_id = product_id;
            if (line_id) bodyData.line_id = line_id;
            if (access_token) bodyData.access_token = access_token;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({ params: bodyData })
            });
            if (response.ok) {
                const responseJSON = await response.json();
                let dt3 = Date.now();
                console.log(666, `Finished saving model to Odoo in ${dt3 - dt1}ms`);

                if (responseJSON.error) {
                    alert("Error from server => " + responseJSON.error.message);
                    return;
                }
                const responseData = responseJSON.result;
                if (responseData && responseData.status === 'success') {
                    window.parent.location.reload();
                } else {
                    alert('Error ' + (responseData ? responseData.status : '') + ' - ' + (responseData ? responseData.message : 'Unknown error'));
                }
            } else {
                alert('HTTP Response Status ' + response.status + ' - ' + response.statusText);
            }
        } catch (error) {
            alert('Error saving model: ' + error);
        }
    }
    window.saveCustomizations = saveCustomizations;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
console.log(875555);