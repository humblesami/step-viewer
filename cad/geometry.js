export function buildScene(model) {
  const group = new THREE.Group();

  model.parts.forEach(part => {

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(part.vertices, 3)
    );

    geometry.setIndex(part.indices);

    const material = new THREE.MeshStandardMaterial({
      color: 0x0088ff,
      metalness: 0.2,
      roughness: 0.6
    });

    const mesh = new THREE.Mesh(geometry, material);

    group.add(mesh);
  });

  return group;
}
