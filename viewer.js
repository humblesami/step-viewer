(function () {
    occtimportjs().then((module) => {
        let occ = module;
        console.log(9980001, occ);

        document.getElementById("fileInput").addEventListener("change", async (e) => {
            const file = e.target.files[0];

            const buffer = await file.arrayBuffer();

            const result = await occ.ReadStepFile(buffer);

            const meshes = result.meshes;

            meshes.forEach((meshData) => {
                const geometry = new THREE.BufferGeometry();

                geometry.setAttribute(
                    "position",
                    new THREE.Float32BufferAttribute(meshData.vertices, 3)
                );

                geometry.setIndex(meshData.indices);

                const material = new THREE.MeshStandardMaterial({
                    color: 0x0077ff,
                    metalness: 0.3,
                    roughness: 0.6
                });

                const mesh = new THREE.Mesh(geometry, material);

                scene.add(mesh);
            });
        });

        const canvas = document.getElementById("canvas");

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf0f0f0);

        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);


        camera.position.set(100, 100, 100);

        const renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true
        });

        renderer.setSize(window.innerWidth, window.innerHeight);

        // light
        const light = new THREE.AmbientLight(0xffffff, 1);
        scene.add(light);

        // simple orbit controls (minimal)
        let isDragging = false;
        let prev = { x: 0, y: 0 };

        document.addEventListener("mousedown", (e) => {
            isDragging = true;
            prev.x = e.clientX;
            prev.y = e.clientY;
        });

        document.addEventListener("mouseup", () => isDragging = false);

        document.addEventListener("mousemove", (e) => {
            if (!isDragging) return;

            const dx = e.clientX - prev.x;
            const dy = e.clientY - prev.y;

            scene.rotation.y += dx * 0.005;
            scene.rotation.x += dy * 0.005;

            prev.x = e.clientX;
            prev.y = e.clientY;
        });

        function animate() {
            requestAnimationFrame(animate);
            renderer.render(scene, camera);
        }

        animate();
        console.log(9980001, "1827")
    });
})();
