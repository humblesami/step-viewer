import * as THREE from 'three_modules';
import { OrbitControls } from 'OrbitControls';
import { GLTFLoader } from 'GLTFLoader';

// Initialize Scene
const container = document.getElementById('viewer-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#f8f9fa');

const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
camera.position.set(0, 1.5, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// Lighting
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
hemiLight.position.set(0, 200, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(0, 20, 10);
scene.add(dirLight);

// Handle Resize
window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
});

// Render Loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

// --- CUSTOMIZATION LOGIC ---

// activeGroups maps group IDs to an array of THREE.Mesh objects
const activeGroups = {};
let odooPayload = null;

// Create the "Others" group dynamically
activeGroups["group_others"] = [];

async function fetchConfiguration(product_tmpl_id) {
    if (!product_tmpl_id) return null;
    try {
        const response = await fetch('/step_file_viewer/get_cad_viewer_config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "call",
                params: { product_tmpl_id: product_tmpl_id }
            })
        });
        const result = await response.json();
        if (result.result && result.result.status === 'success') {
            return result.result;
        }
    } catch (error) {
        console.error("Failed to fetch config", error);
    }
    return null;
}

async function loadModelAndInitialize() {
    const loader = new GLTFLoader();

    // Check URL params for file and config
    const urlParams = window.location ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const filename = urlParams.get('filename') || 'demo.glb';
    const fileId = urlParams.get('file_id');
    const product_tmpl_id = urlParams.get('product_tmpl_id');

    // Odoo route to get the GLB file
    const modelPath = fileId ? `/web/content/${fileId}` : `/cyb_step_file_viewer/static/viewer/models/${filename}`;

    // Fetch Configuration from Odoo
    odooPayload = await fetchConfiguration(product_tmpl_id);

    // Fallback Mock Payload if not connected to backend yet
    if (!odooPayload) {
        odooPayload = {
            productName: "Cube Booth (Demo/Fallback)",
            groups: [
                { id: "group_demo", displayName: "Demo Group", searchTerm: ["EXT_"], colors: [{ name: "#222222", hex: "#222222" }] }
            ]
        };
    }

    try {
        const gltf = await loader.loadAsync(modelPath);
        const model = gltf.scene;

        // Grouping Logic: Iterate over meshes and apply "First Match Wins"
        model.traverse((node) => {
            if (node.isMesh) {
                // Ensure unique materials if they share it in the GLB
                node.material = node.material.clone();

                let matchedGroup = null;

                // Check against predefined groups
                for (const group of odooPayload.groups) {
                    const isMatch = group.searchTerm && node.name.toLowerCase().includes(group.searchTerm.toLowerCase());
                    if (isMatch) {
                        matchedGroup = group.id;
                        break; // Stop at first group match
                    }
                }

                if (matchedGroup) {
                    if (!activeGroups[matchedGroup]) activeGroups[matchedGroup] = [];
                    activeGroups[matchedGroup].push(node);
                } else {
                    // Exclusion: Falls into "Others"
                    activeGroups["group_others"].push(node);
                }
            }
        });

        // Center model
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        scene.add(model);

        buildUI();

    } catch (error) {
        console.warn("Could not load 3D model (file might not exist at path). Rendering UI anyway.", error);
        document.getElementById('viewer-container').innerHTML = `<div style="position:absolute; top:50%; width:100%; text-align:center; color:#999; font-family:sans-serif;">No 3D Model Loaded.<br>Awaiting backend integration.</div>`;
        buildUI();
    }
}

function buildUI() {
    document.getElementById('product-name').textContent = odooPayload.productName;
    const container = document.getElementById('options-container');
    container.innerHTML = ''; // Clear loading

    // Loop through groups from backend
    odooPayload.groups.forEach(group => {
        // Create Section
        const section = document.createElement('div');
        section.className = 'group-section';

        const title = document.createElement('h3');
        title.textContent = group.displayName;
        section.appendChild(title);

        // Create Colors Grid
        const grid = document.createElement('div');
        grid.className = 'colors-grid';

        group.colors.forEach((color, index) => {
            const btn = document.createElement('button');
            btn.className = 'color-btn';
            if (index === 0) btn.classList.add('active'); // Default active

            const circle = document.createElement('div');
            circle.className = 'color-circle';
            circle.style.backgroundColor = color.hex;

            const label = document.createElement('span');
            label.className = 'color-name';
            label.textContent = color.name;

            btn.appendChild(circle);
            btn.appendChild(label);

            btn.onclick = () => {
                // Update active class
                grid.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Apply Color to Meshes
                applyColorToGroup(group.id, color.hex);
            };

            grid.appendChild(btn);
        });

        section.appendChild(grid);
        container.appendChild(section);

        // Apply default color initially if there are meshes in this group
        if (group.colors.length > 0) {
            applyColorToGroup(group.id, group.colors[0].hex);
        }
    });
}

function applyColorToGroup(groupId, hexColor) {
    const meshes = activeGroups[groupId];
    if (meshes) {
        meshes.forEach(mesh => {
            mesh.material.color.set(hexColor);
            mesh.material.needsUpdate = true;
        });
    }
}

// Start Application
loadModelAndInitialize();
