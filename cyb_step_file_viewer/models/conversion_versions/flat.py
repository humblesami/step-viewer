import os
import re
import json
import cadquery as cq

from OCP.TopoDS import TopoDS_Shape
from OCP.TDataStd import TDataStd_Name
from OCP.TopLoc import TopLoc_Location
from OCP.Quantity import Quantity_Color
from OCP.TDocStd import TDocStd_Document
from OCP.IFSelect import IFSelect_RetDone
from OCP.XCAFApp import XCAFApp_Application
from OCP.TDF import TDF_LabelSequence, TDF_Label
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorType



def convert_step_to_flat_glb(step_file_path: str, output_glb_path: str) -> dict:
    """
    Extracts true names/colors using OCP XCAF, applies absolute 3D locations,
    and exports a flat, UI-friendly GLB using CadQuery's native exporter.
    """
    # ── 1. Init XDE App & Read STEP ───────────────────────────────────────────
    app = XCAFApp_Application.GetApplication_s()
    doc = TDocStd_Document(TCollection_ExtendedString("BinXCAF"))
    app.NewDocument(TCollection_ExtendedString("BinXCAF"), doc)

    reader = STEPCAFControl_Reader()
    reader.SetColorMode(True)
    reader.SetNameMode(True)

    if reader.ReadFile(step_file_path) != IFSelect_RetDone:
        raise RuntimeError(f"STEP read failed: {step_file_path}")

    reader.Transfer(doc)
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    color_tool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())

    parts_data = []  # Stores (sanitized_name, original_name, cq_shape, color_rgba)

    # ── 2. Walk Tree and Calculate Absolute 3D Positions ──────────────────────
    def walk(label: TDF_Label, parent_loc: TopLoc_Location, parent_color=None):
        components = TDF_LabelSequence()
        is_assembly = shape_tool.GetComponents_s(label, components, False)

        # Check if current node has an override color
        curr_color = _label_color(color_tool, label) or parent_color

        if is_assembly and components.Size() > 0:
            for i in range(1, components.Size() + 1):
                comp_label = components.Value(i)

                # Accumulate exact 3D location matrix
                comp_loc = shape_tool.GetLocation_s(comp_label)
                absolute_loc = parent_loc.Multiplied(comp_loc)

                inst_color = _label_color(color_tool, comp_label) or curr_color

                referred = TDF_Label()
                if shape_tool.GetReferredShape_s(comp_label, referred):
                    walk(referred, absolute_loc, inst_color)
                else:
                    walk(comp_label, absolute_loc, inst_color)
        else:
            # Leaf node reached - extract actual geometry
            topo = TopoDS_Shape()
            shape_tool.GetShape_s(label, topo)

            if topo.IsNull():
                return

            # Move shape to its absolute world coordinates
            world_topo = topo.Moved(parent_loc)

            # Wrap standard OCP shape back into a CadQuery shape
            cq_shape = cq.Shape.cast(world_topo)

            name = _label_name(label) or f"Part_{len(parts_data) + 1:03d}"
            final_color = _label_color(color_tool, label) or curr_color

            idx = len(parts_data)
            node_name = _sanitize(name, idx)
            parts_data.append((node_name, name, cq_shape, final_color))

    # Start walk from root assembly
    free_labels = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free_labels)
    identity_loc = TopLoc_Location()

    for i in range(1, free_labels.Size() + 1):
        walk(free_labels.Value(i), identity_loc)

    print(f"Extracted {len(parts_data)} correctly positioned parts.")

    # ── 3. Build & Export Native CadQuery Assembly ────────────────────────────
    assy = cq.Assembly(name="RootAssembly")
    manifest = {}

    for node_name, original_name, cq_shape, color in parts_data:
        if color:
            # CadQuery Color expects RGB in 0.0 - 1.0 range
            cq_color = cq.Color(color[0], color[1], color[2], 1.0)
            assy.add(cq_shape, name=node_name, color=cq_color)
        else:
            assy.add(cq_shape, name=node_name)

        manifest[node_name] = original_name

    print(f"Exporting precise GLB to {output_glb_path}...")
    assy.save(output_glb_path, "GLTF", tolerance=1.2, angularTolerance=0.8, write_binary=True)

    # Write Sidecar JSON Manifest for your JS UI clustering
    manifest_path = output_glb_path.replace(".glb", "_parts.json")
    with open(manifest_path, "w") as f:
        json.dump({
            "source": os.path.basename(step_file_path),
            "total_parts": len(manifest),
            "parts": manifest
        }, f, indent=2)

    final_size = os.path.getsize(output_glb_path) / (1024 * 1024)
    print(f"Success! Final Size: {final_size:.2f} MB")

    return manifest


# ── Helpers (Same as before) ──────────────────────────────────────────────────
def _label_name(label: TDF_Label) -> str:
    try:
        attr = TDataStd_Name()
        if label.FindAttribute(TDataStd_Name.GetID_s(), attr):
            return attr.Get().ToExtString()
    except Exception:
        pass
    return ""


def _label_color(color_tool, label: TDF_Label):
    try:
        col = Quantity_Color()
        for c_type in [
                XCAFDoc_ColorType.XCAFDoc_ColorSurf, 
                XCAFDoc_ColorType.XCAFDoc_ColorGen,
                XCAFDoc_ColorType.XCAFDoc_ColorCurv
            ]:
            if color_tool.GetColor_s(label, c_type, col):
                return (col.Red(), col.Green(), col.Blue())
    except Exception:
        pass
    return None


def _sanitize(name: str, idx: int) -> str:
    s = re.sub(r"[^\w\-]", "_", name.strip())
    s = re.sub(r"_+", "_", s).strip("_") or f"Part_{idx + 1:03d}"
    return f"{s}_{idx + 1:03d}"