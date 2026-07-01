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
            searchQuery: '',
            invertSearch: false,
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

    init() {
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
                console.timeEnd('Pre-calculate Geometries');

                // Get parts list from the original model
                this.state.parts = this.getPartsFromModel(this.originalModel);

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

                this.updateUI(); // Initial UI update after model load
                console.timeEnd('Model Processing');
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
            this.rebuildMergedModel();
            this.rebuildTimeout = null;
        }, delay);
    }

    getPartsFromModel(model) {
        let root = model;
        while (root.children.length === 1 && (root.children[0].type === 'Group' || root.children[0].type === 'Object3D')) {
            root = root.children[0];
        }

        const all_parts = [];
        
        const traverse = (node, level, parentId) => {
            if (node.isMesh || node.isLineSegments) return; 

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
                    expanded: true,
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
        // const sidebar = document.querySelector('.o_stp_parts_popup');
        // const sidebarBtn = document.querySelector('.tool-btn-sidebar');
        // if (this.state.showSidebar && sidebar && !sidebar.contains(ev.target) && sidebarBtn && !sidebarBtn.contains(ev.target)) {
        //     this.state.showSidebar = false;
        //     changed = true;
        // }
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
        };

        if (immediate) {
            apply();
        } else {
            this.colorDebounceTimeout = setTimeout(apply, 2000);
        }
    }

    onColorChange(ev, partId, immediate = false) {
        const color = ev.target.value;
        if (this.colorDebounceTimeout) clearTimeout(this.colorDebounceTimeout);

        const apply = () => {
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
        };

        if (immediate) apply();
        else this.colorDebounceTimeout = setTimeout(apply, 2000);
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

            const globalBtn = this.container.querySelector('.global-toggle-btn');
            if (globalBtn) this.updateGlobalToggleUI(globalBtn, this.globalVisibilityState);
        }
        this.scheduleRebuild(300);
    }

    toggleAllVisibility() {
        const matchedParts = this.getMatchedParts();
        if (matchedParts.length === 0) return;
        
        const current = this.globalVisibilityState;
        const targetVisible = (current === 'none') ? true : false;

        matchedParts.forEach(part => {
            part.visible = targetVisible;
            const obj = this.originalModel.getObjectByProperty('uuid', part.id);
            if (obj) obj.visible = targetVisible;
        });

        matchedParts.forEach(part => {
            const btn = this.container.querySelector(`.btn-vis[data-part-id="${part.id}"]`);
            if (btn) {
                btn.className = `btn-vis ${targetVisible ? 'active' : ''}`;
                const icon = btn.querySelector('i');
                if (icon) icon.className = `fa ${targetVisible ? 'fa-eye' : 'fa-eye-slash'}`;
            }
        });

        const globalBtn = this.container.querySelector('.global-toggle-btn');
        if (globalBtn) {
            this.updateGlobalToggleUI(globalBtn, targetVisible ? 'all' : 'none');
        }

        this.rebuildMergedModel();
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
        const noun = matchedCount < totalCount ? `${matchedCount} MATCHED` : 'ALL';
        
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
            },
            (error) => {
                console.error('An error happened during GLTF export:', error);
            },
            options
        );
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
        if (!this.state.searchQuery && !this.state.invertSearch) {
            return this.state.parts;
        }
        
        const terms = (this.state.searchQuery || '').toLowerCase().split(/\s+/).filter(t => t);
        const directMatches = new Set();
        
        this.state.parts.forEach(part => {
            const partNameLower = part.name.toLowerCase();
            let matches = true;
            if (terms.length > 0) {
                for (const term of terms) {
                    if (term.startsWith('-')) {
                        const excludeTerm = term.slice(1);
                        if (excludeTerm && partNameLower.includes(excludeTerm)) {
                            matches = false;
                            break;
                        }
                    } else {
                        if (!partNameLower.includes(term)) {
                            matches = false;
                            break;
                        }
                    }
                }
            }
            if (this.state.invertSearch) matches = !matches;
            if (matches) directMatches.add(part.id);
        });

        const finalMatches = new Set();
        
        const addAncestors = (partId) => {
            const part = this.state.parts.find(p => p.id === partId);
            if (part && part.parentId) {
                finalMatches.add(part.parentId);
                addAncestors(part.parentId);
            }
        };

        const addDescendants = (partId) => {
            const descendants = this.getDescendantIds(partId);
            descendants.forEach(dId => finalMatches.add(dId));
        };

        directMatches.forEach(id => {
            finalMatches.add(id);
            addAncestors(id);
            addDescendants(id);
        });

        return this.state.parts.filter(p => finalMatches.has(p.id));
    }

    updatePaintGlobalUI() {
        const paintLabel = this.container.querySelector('.global-paint-row .part-name-text');
        if (paintLabel) {
            const matchedCount = this.getMatchedParts().length;
            const totalCount = this.state.parts.length;
            paintLabel.innerText = matchedCount < totalCount ? `Paint ${matchedCount} Matched` : `Paint All`;
        }
    }

    providePartsSearch(query, invert = null) {
        if (query !== null) this.state.searchQuery = query;
        if (invert !== null) this.state.invertSearch = invert;

        const popup = this.container.querySelector('.o_stp_parts_popup');
        if (!popup) return;

        const matchedParts = this.getMatchedParts();
        const matchedIds = new Set(matchedParts.map(p => p.id));

        this.state.parts.forEach((part) => {
            const partEl = popup.querySelector(`.part-item-modern[data-part-id="${part.id}"]`);
            if (partEl) {
                let isCollapsedByParent = false;
                let currParent = this.state.parts.find(p => p.id === part.parentId);
                while (currParent) {
                    if (!currParent.expanded) {
                        isCollapsedByParent = true;
                        break;
                    }
                    currParent = this.state.parts.find(p => p.id === currParent.parentId);
                }
                partEl.style.display = (matchedIds.has(part.id) && !isCollapsedByParent) ? '' : 'none';
            }
        });

        const countEl = popup.querySelector('.matching-parts-count');
        if (countEl) {
            countEl.innerText = `${matchedParts.length} of ${this.state.parts.length} parts matched`;
        }

        const clearBtn = popup.querySelector('.clear-search-btn');
        if (clearBtn) {
            clearBtn.style.opacity = this.state.searchQuery ? '0.6' : '0';
            clearBtn.style.pointerEvents = this.state.searchQuery ? 'auto' : 'none';
        }

        const globalBtn = popup.querySelector('.global-toggle-btn');
        if (globalBtn) this.updateGlobalToggleUI(globalBtn, this.globalVisibilityState);
        this.updatePaintGlobalUI();
    }

    // UI Rendering & Updates
    renderUI() {
        // Initial static structure
        this.container.innerHTML = `
            <div class="o_stp_preview_container">
                <div id="three-container" style="width: 100%; height: 100%; cursor: grab;"></div>
                
                <div id="popovers-container"></div>
                
                <div class="o_stp_bottom_toolbar">
                    <div class="btn-group">
                        <button class="btn btn-dark tool-btn tool-btn-sidebar" title="Assembly Tree">
                            <i class="fa fa-sitemap"></i>
                        </button>
                        <button class="btn tool-btn tool-btn-lights" title="Lighting Control">
                            <i class="fa fa-lightbulb-o"></i>
                        </button>
                        <button class="btn tool-btn tool-btn-edge" title="Wireframe / Edges">
                            <i class="fa fa-cube"></i>
                        </button>
                        <button class="btn btn-dark tool-btn tool-btn-edge-settings" title="Edge Settings">
                            <i class="fa fa-pencil"></i>
                        </button>
                        <div class="color-picker-wrapper btn btn-dark tool-btn" title="Background Color">
                            <i class="fa fa-tint" style="font-size: 14px; margin-right: 4px;"></i>
                            <input type="color" class="global-color-picker">
                        </div>
                    </div>

                    <div class="divider"></div>

                    <div class="btn-group">
                        <button class="btn btn-dark tool-btn tool-btn-zoom-in" title="Zoom In">
                            <i class="fa fa-search-plus"></i>
                        </button>
                        <button class="btn btn-dark tool-btn tool-btn-zoom-out" title="Zoom Out">
                            <i class="fa fa-search-minus"></i>
                        </button>
                        <button class="btn btn-dark tool-btn tool-btn-refresh" title="Reset View">
                            <i class="fa fa-refresh"></i>
                        </button>
                    </div>

                    <div class="divider"></div>

                    <div class="btn-group">
                        <button class="btn btn-dark tool-btn tool-btn-snapshot" title="Take Photo (PNG)">
                            <i class="fa fa-camera"></i>
                        </button>
                        <button class="btn btn-dark tool-btn tool-btn-download" title="Download Model (GLB)">
                            <i class="fa fa-download"></i>
                        </button>
                    </div>

                    <div class="divider"></div>

                    <div class="btn-group">
                        <button class="btn btn-dark tool-btn close-btn" title="Exit Viewer">
                            <i class="fa fa-times-circle"></i>
                        </button>
                    </div>
                </div>

                <div id="loader-container"></div>
            </div>
        `;

        // Bind toolbar events
        this.container.querySelector('.tool-btn-sidebar').onclick = () => this.toggleSidebar();
        this.container.querySelector('.tool-btn-lights').onclick = () => this.toggleLightsPopup();
        this.container.querySelector('.tool-btn-edge').onclick = () => this.toggleEdges();
        this.container.querySelector('.tool-btn-edge-settings').onclick = () => this.toggleEdgePopup();
        this.container.querySelector('.global-color-picker').oninput = (e) => this.updateSetting('bgColor', e.target.value);
        this.container.querySelector('.tool-btn-zoom-in').onclick = () => this.zoomIn();
        this.container.querySelector('.tool-btn-zoom-out').onclick = () => this.zoomOut();
        this.container.querySelector('.tool-btn-refresh').onclick = () => this.resetView();
        this.container.querySelector('.tool-btn-snapshot').onclick = () => this.takeSnapshot();
        this.container.querySelector('.tool-btn-download').onclick = () => this.downloadModel();
        this.container.querySelector('.close-btn').onclick = () => this.interruptAndClose();

        this.updateUI();
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

        // Popovers
        let popoversHtml = '';

        if (this.state.showSidebar) {
            const matchedParts = this.getMatchedParts();
            const matchedIds = new Set(matchedParts.map(p => p.id));
            const matchingCount = matchedParts.length;
            const noun = matchingCount < this.state.parts.length ? `${matchingCount} Matched` : 'All';

            popoversHtml += `
                <div class="popover o_stp_parts_popup">
                    <div class="sidebar-header">
                        <h3>${this.state.assemblyName}</h3>
                        <button class="btn-close-sidebar"><i class="fa fa-times"></i></button>
                    </div>
                    <div class="sidebar-action-box">
                        <div class="part-search-box" style="margin-bottom: 12px; padding: 0 8px;">
                            <div style="display: flex; align-items: center; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px; padding: 6px 10px; transition: border-color 0.2s; position: relative;">
                                <i class="fa fa-search" style="opacity: 0.6; margin-right: 8px; color: #fff;"></i>
                                <input type="text" class="form-control part-search-input" placeholder="Search parts (e.g. bolt -bracket)..." value="${this.state.searchQuery || ''}" style="background: transparent; border: none; color: white; outline: none; font-size: 13px; width: 100%; padding: 0; padding-right: 20px; box-shadow: none;">
                                <i class="fa fa-times-circle clear-search-btn" style="position: absolute; right: 40px; cursor: pointer; color: white; opacity: ${this.state.searchQuery ? '0.6' : '0'}; transition: opacity 0.2s; pointer-events: ${this.state.searchQuery ? 'auto' : 'none'};"></i>
                                <div style="display: flex; align-items: center; justify-content: center; margin-left: 8px; border-left: 1px solid rgba(255, 255, 255, 0.1); padding-left: 8px;" title="Invert Results">
                                    <input class="part-search-invert" type="checkbox" ${this.state.invertSearch ? 'checked' : ''} style="cursor: pointer; margin: 0; width: 14px; height: 14px;">
                                </div>
                            </div>
                            <div class="matching-parts-count" style="font-size: 11px; opacity: 0.7; padding-left: 2px; margin-top: 4px; color: rgba(255, 255, 255, 0.7);">
                                ${matchingCount} of ${this.state.parts.length} parts matched
                            </div>
                        </div>
                        <div class="part-item-modern global-paint-row">
                            <span class="part-name-text">Paint ${noun}</span>
                            <div class="part-actions">
                                <input type="color" class="mini-color-picker global-paint-picker" value="#ffffff">
                            </div>
                        </div>
                        <div class="d-flex gap-2 mb-3">
                            <button class="btn drawer-action-btn flex-grow-1 global-toggle-btn">
                                <i class="fa"></i> <span class="btn-text"></span>
                            </button>
                        </div>
                    </div>
                    <div class="sidebar-content">
                        ${this.state.parts.map(part => {
                            const matches = matchedIds.has(part.id);
                            let isCollapsedByParent = false;
                            let currParent = this.state.parts.find(p => p.id === part.parentId);
                            while (currParent) {
                                if (!currParent.expanded) {
                                    isCollapsedByParent = true;
                                    break;
                                }
                                currParent = this.state.parts.find(p => p.id === currParent.parentId);
                            }
                            
                            const displayStyle = (matches && !isCollapsedByParent) ? '' : 'display: none;';
                            const expanderHtml = part.isAssembly 
                                ? `<i class="fa ${part.expanded ? 'fa-caret-down' : 'fa-caret-right'} tree-expander" data-part-id="${part.id}" style="cursor: pointer; width: 16px; text-align: center; margin-right: 4px;"></i>`
                                : `<span style="width: 20px; display: inline-block;"></span>`;

                            const nameStyle = part.isAssembly ? 'font-weight: 600;' : '';

                            return `
                                <div class="part-item-modern" data-part-id="${part.id}" style="${displayStyle} padding-left: ${part.level * 16 + 8}px;">
                                    ${expanderHtml}
                                    <span class="part-name-text" style="${nameStyle}" title="Volume: ${Math.round(part.volume)}">${part.name}</span>
                                    <div class="part-actions">
                                        <input type="color" value="${part.color}" data-part-id="${part.id}" class="mini-color-picker part-color-picker">
                                        <button class="btn-vis ${part.visible ? 'active' : ''}" data-part-id="${part.id}">
                                            <i class="fa ${part.visible ? 'fa-eye' : 'fa-eye-slash'}"></i>
                                        </button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        if (this.state.showLightsPopup) {
            popoversHtml += `
                <div class="popover o_stp_lights_popup">
                    <div class="popup-header">
                        <span>Lighting</span>
                        <button class="btn-close-mini close-lights-btn"><i class="fa fa-times"></i></button>
                    </div>
                    <div class="popup-section">
                        <label>Ambient Intensity</label>
                        <input type="range" min="0" max="2" step="0.1" value="${this.settings.lighting.ambientIntensity}" class="ambient-range">
                    </div>
                    <div class="popup-section">
                        <label>Main Light</label>
                        <input type="range" min="0" max="5" step="0.1" value="${this.settings.lighting.mainIntensity}" class="main-range">
                    </div>
                    <div class="popup-section">
                        <label>Exposure</label>
                        <input type="range" min="0" max="4" step="0.1" value="${this.settings.lighting.exposure}" class="exposure-range">
                    </div>
                </div>
            `;
        }

        if (this.state.showEdgePopup) {
            popoversHtml += `
                <div class="popover o_stp_edge_popup">
                    <div class="popup-header">
                        <span>Edges</span>
                        <button class="btn-close-mini close-edge-btn"><i class="fa fa-times"></i></button>
                    </div>
                    <div class="popup-section">
                        <label>Color</label>
                        <input type="color" value="${this.settings.edgeColor}" class="edge-color-picker mini-color-picker w-100">
                    </div>
                    <div class="popup-section">
                        <label>Opacity</label>
                        <input type="range" min="0" max="1" step="0.05" value="${this.settings.edgeOpacity}" class="edge-opacity-range">
                    </div>
                </div>
            `;
        }

        popoversContainer.innerHTML = popoversHtml;

        // Bind popover events
        if (this.state.showSidebar) {
            popoversContainer.querySelector('.btn-close-sidebar').onclick = () => this.toggleSidebar();
            popoversContainer.querySelector('.global-paint-picker').oninput = (e) => this.onGlobalColorChange(e);

            const searchInput = popoversContainer.querySelector('.part-search-input');
            if (searchInput) {
                const searchWrapper = searchInput.closest('div');
                searchInput.onfocus = () => {
                    if (searchWrapper) {
                        searchWrapper.style.borderColor = '#00a09d';
                        searchWrapper.style.boxShadow = '0 0 5px rgba(0, 160, 157, 0.5)';
                    }
                };
                searchInput.onblur = () => {
                    if (searchWrapper) {
                        searchWrapper.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                        searchWrapper.style.boxShadow = 'none';
                    }
                };
                const handleSearch = (e) => {
                    this.providePartsSearch(e.target.value, null);
                };
                searchInput.oninput = handleSearch;
                searchInput.onkeyup = handleSearch;
            }
            
            const clearBtn = popoversContainer.querySelector('.clear-search-btn');
            if (clearBtn) {
                clearBtn.onclick = () => {
                    if (searchInput) {
                        searchInput.value = '';
                        this.providePartsSearch('');
                    }
                };
            }
            
            const invertCheckbox = popoversContainer.querySelector('.part-search-invert');
            if (invertCheckbox) {
                invertCheckbox.onchange = (e) => {
                    this.providePartsSearch(null, e.target.checked);
                };
            }

            const globalBtn = popoversContainer.querySelector('.global-toggle-btn');
            this.updateGlobalToggleUI(globalBtn, this.globalVisibilityState);
            globalBtn.onclick = () => this.toggleAllVisibility();

            popoversContainer.querySelectorAll('.part-color-picker').forEach(el => {
                el.oninput = (e) => this.onColorChange(e, e.target.dataset.partId);
                el.onkeydown = (e) => {
                    if (e.key === 'Enter') this.onColorChange(e, e.target.dataset.partId, true);
                };
            });
            popoversContainer.querySelectorAll('.btn-vis').forEach(el => {
                el.onclick = (e) => this.toggleVisibility(e, e.currentTarget.dataset.partId);
            });
            
            popoversContainer.querySelectorAll('.tree-expander').forEach(exp => {
                exp.onclick = (e) => {
                    const partId = e.currentTarget.dataset.partId;
                    const part = this.state.parts.find(p => p.id === partId);
                    if (part) {
                        part.expanded = !part.expanded;
                        e.currentTarget.className = `fa ${part.expanded ? 'fa-caret-down' : 'fa-caret-right'} tree-expander`;
                        this.providePartsSearch(null, null); // Refresh DOM visibility instantly
                    }
                };
            });

            // Restore scroll position
            const newSidebarContent = popoversContainer.querySelector('.sidebar-content');
            if (newSidebarContent) {
                newSidebarContent.scrollTop = sidebarScrollTop;
            }
        }

        if (this.state.showLightsPopup) {
            popoversContainer.querySelector('.close-lights-btn').onclick = () => {
                this.state.showLightsPopup = false;
                this.updateUI();
            };
            popoversContainer.querySelector('.ambient-range').oninput = (e) => this.updateSetting('ambientIntensity', e.target.value);
            popoversContainer.querySelector('.main-range').oninput = (e) => this.updateSetting('mainIntensity', e.target.value);
            popoversContainer.querySelector('.exposure-range').oninput = (e) => this.updateSetting('exposure', e.target.value);
        }
        if (this.state.showEdgePopup) {
            popoversContainer.querySelector('.close-edge-btn').onclick = () => {
                this.state.showEdgePopup = false;
                this.updateUI();
            };
            popoversContainer.querySelector('.edge-color-picker').oninput = (e) => this.updateSetting('edgeColor', e.target.value);
            popoversContainer.querySelector('.edge-opacity-range').oninput = (e) => this.updateSetting('edgeOpacity', e.target.value);
        }

        // Loader
        if (this.state.loading_model) {
            loaderContainer.innerHTML = `
                <div class="o_stp_glass_loader">
                    <div class="glass-orb"><div class="inner-spin"></div></div>
                    <div class="loader-text text-center">
                        <h2>3d Model Viewer</h2>
                        <div class="progress-bar-container"><div class="progress-fill"></div></div>
                        <p>Virtualizing Assembly...</p>
                        ${!this.state.cancelling ? '<button class="interrupt mt-4 px-4 py-2">Cancel & Close</button>' : '<span class="cancelling">Cancelling...</span>'}
                    </div>
                </div>
            `;
            const interruptBtn = loaderContainer.querySelector('.interrupt');
            if (interruptBtn) interruptBtn.onclick = () => this.interruptAndClose();
        } else {
            loaderContainer.innerHTML = '';
        }
    }
}

(function () {
    document.addEventListener('DOMContentLoaded', () => {
        console.log(998989, 'cad viewer loaded');
        const root = document.getElementById('cad-viewer-root');
        let attachment_id = findQueryParam('file_id');
        let filename = findQueryParam('filename');
        let file_url = document.getElementById('step_viewer_file_url').value;
        if (attachment_id) {
            file_url = window.location.origin + `/web/content/${attachment_id}`;
            if (filename) {
                file_url += `/` + filename;
            }
            // Add a cache-buster so the browser doesn't load the old HTTP cache
            file_url += `?t=${new Date().getTime()}`;
        }

        const viewer = new CadViewer(root, file_url, {
            onClose: () => {
                window.parent.postMessage('close_step_viewer', '*');
            }
        });

        let product_id = findQueryParam('product_id');
        let line_id = findQueryParam('line_id');
        let access_token = findQueryParam('access_token');
        let hide_save = findQueryParam('hide_save');
        console.log(product_id, 'product_id');
        if ((product_id || line_id) && !hide_save) {
            function addToCartSaveModelBtn() {
                const btn = document.createElement('button');
                btn.className = 'btn btn-dark tool-btn tool-btn-save';
                btn.title = 'Save 3D Model';
                btn.innerHTML = '<i class="fa fa-save"></i>';
                document.querySelector('.o_stp_bottom_toolbar .tool-btn-download').after(btn);

                btn.onclick = () => {
                    console.log('Generating GLB for save...');
                    const exporter = new GLTFExporter();
                    exporter.parse(viewer.originalModel, (result) => {
                        let binary = '';
                        let bytes = new Uint8Array(result);
                        for (let i = 0; i < bytes.byteLength; i++) {
                            binary += String.fromCharCode(bytes[i]);
                        }
                        const base64ModelData = window.btoa(binary);

                        async function saveToOdoo() {
                            console.log('Saving this model to Odoo...');
                            try {
                                let url = '/step_file_viewer/save_sale_model';
                                let bodyData = { model_data: base64ModelData };

                                if (product_id) bodyData.product_id = product_id;
                                if (line_id) bodyData.line_id = line_id;
                                if (access_token) bodyData.access_token = access_token;

                                const response = await fetch(url, {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Accept': 'application/json',
                                    },
                                    body: JSON.stringify(bodyData)
                                });
                                if (response.ok) {
                                    const responseJSON = await response.json();
                                    console.log(responseJSON, 'responseJSON');
                                    if (responseJSON.error) {
                                        alert(responseJSON.error.message);
                                        return;
                                    }
                                    const responseData = responseJSON.result;
                                    console.log(responseData, 'responseData');
                                    if (responseData.status === 'success') {
                                        window.parent.location.reload();
                                    } else {
                                        alert('Error saving model 1: ' + responseData.status + ' - ' + responseData.message);
                                    }
                                } else {
                                    alert('Error saving model 2: ' + response.status + ' - ' + response.statusText);
                                }
                            } catch (error) {
                                alert('Error saving model 3: ' + error);
                            }
                        }
                        saveToOdoo();
                    }, (error) => {
                        console.error('Export error:', error);
                    }, { binary: true, onlyVisible: true });
                };
            }
            addToCartSaveModelBtn();
        }

    });
})();
