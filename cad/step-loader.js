export async function loadSTEP(file, occ) {
  const buffer = await file.arrayBuffer();

  const result = await occ.ReadStepFile(buffer);

  const model = {
    parts: []
  };

  console.log("result", result);

  if (result && result.meshes) {
    for (const meshData of result.meshes) {
      model.parts.push({
        name: meshData.name || "Part",
        vertices: meshData.vertices,
        indices: meshData.indices
      });
    }
  } else if (result && result.shapes) {
    for (const shape of result.shapes) {
      model.parts.push({
        name: shape.name || "Part",
        vertices: shape.vertices,
        indices: shape.indices
      });
    }
  } else {
    console.log("No meshes or shapes found");
  }

  return model;
}
