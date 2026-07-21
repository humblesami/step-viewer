import os
import re
import json
import cadquery as cq

from OCP.TopoDS import TopoDS_Shape, TopoDS_Iterator
from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL, TopAbs_COMPSOLID, TopAbs_COMPOUND
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

# Regex to detect standard UUIDs
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)

def convert_step_to_tree_glb(step_file_path: str, output_glb_path: str) -> dict:
    """
    Extracts true names/colors, strips out UUIDs, collapses single-child chains,
    and directly attaches shapes to prevent CadQuery naming collisions.
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

    # Mutable state for global uniqueness
    counter = {"n": 0}
    flat_manifest = {}  

    # ── 2. Top-Down Recursive Processor ───────────────────────────────────────
    def process_label(
        label: TDF_Label, 
        parent_assy: cq.Assembly, 
        parent_tree: dict, 
        loc: TopLoc_Location, 
        parent_name: str, 
        inherited_color=None
    ):
        own_color = _label_color(color_tool, label)
        effective_color = own_color or inherited_color

        # Scrub UUIDs and inherit parent name if empty/UUID
        raw_name = _label_name(label)
        if not raw_name or UUID_PATTERN.match(raw_name.strip()):
            raw_name = f"{parent_name}_Part"

        idx = counter["n"]
        counter["n"] += 1
        node_name = _sanitize(raw_name, idx)

        components = TDF_LabelSequence()
        is_assembly = shape_tool.GetComponents_s(label, components, False)

        # ✨ USER RULE APPLIED: Collapse 1-child assemblies into leaf parts
        if is_assembly and components.Size() == 1:
            is_assembly = False

        if is_assembly and components.Size() > 0:
            # Create sub-assembly container
            node = cq.Assembly(name=node_name)
            tree_node = {
                "name": node_name,
                "original_name": raw_name,
                "type": "assembly",
                "children": []
            }

            for i in range(1, components.Size() + 1):
                comp_label = components.Value(i)
                comp_loc = shape_tool.GetLocation_s(comp_label)
                inst_color = _label_color(color_tool, comp_label) or effective_color

                referred = TDF_Label()
                if shape_tool.GetReferredShape_s(comp_label, referred):
                    target_label = referred
                else:
                    target_label = comp_label

                process_label(target_label, node, tree_node, comp_loc, node_name, inst_color)

            # Attach fully built sub-assembly to parent
            parent_assy.add(node, loc=cq.Location(loc))
            parent_tree["children"].append(tree_node)

        else:
            # Leaf node processing
            topo = TopoDS_Shape()
            shape_tool.GetShape_s(label, topo)
            solids = _get_solids(topo)

            cq_color = cq.Color(effective_color[0], effective_color[1], effective_color[2], 1.0) if effective_color else None

            if solids:
                if len(solids) == 1:
                    # Single solid -> Add directly as a shape (No wrapper folder)
                    cq_shape = cq.Shape.cast(solids[0])
                    parent_assy.add(cq_shape, name=node_name, color=cq_color, loc=cq.Location(loc))
                    
                    parent_tree["children"].append({
                        "name": node_name,
                        "original_name": raw_name,
                        "type": "part"
                    })
                    flat_manifest[node_name] = raw_name

                else:
                    # Multiple solids clumped -> Create a wrapper folder just for these solids
                    node = cq.Assembly(name=node_name)
                    tree_node = {
                        "name": node_name,
                        "original_name": raw_name,
                        "type": "part",
                        "children": []
                    }

                    for s_idx, solid in enumerate(solids):
                        solid_name = f"{node_name}_Solid_{s_idx + 1:03d}"
                        cq_shape = cq.Shape.cast(solid)
                        # Local location applied at the wrapper level, so shapes stay at 0,0 relative to it
                        node.add(cq_shape, name=solid_name, color=cq_color)
                        
                        tree_node["children"].append({
                            "name": solid_name,
                            "original_name": f"{raw_name}_Solid_{s_idx + 1}",
                            "type": "part"
                        })
                        flat_manifest[solid_name] = f"{raw_name}_Solid_{s_idx + 1}"

                    parent_assy.add(node, loc=cq.Location(loc))
                    parent_tree["children"].append(tree_node)

    # ── 3. Build top-level ────────────────────────────────────────────────────
    root_assy = cq.Assembly(name="Scene")
    hierarchy = {"name": "Scene", "type": "assembly", "children": []}

    free_labels = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free_labels)

    for i in range(1, free_labels.Size() + 1):
        label = free_labels.Value(i)
        root_loc = shape_tool.GetLocation_s(label)
        process_label(label, root_assy, hierarchy, root_loc, "Assembly", None)

    print(f"Extracted {len(flat_manifest)} individual parts.")

    # ── 4. Export ─────────────────────────────────────────────────────────────
    print(f"Exporting GLB to {output_glb_path}...")
    root_assy.save(output_glb_path, "GLTF", tolerance=1.2, angularTolerance=0.8, write_binary=True)

    manifest_path = output_glb_path.replace(".glb", "_parts.json")
    with open(manifest_path, "w") as f:
        json.dump({
            "source": os.path.basename(step_file_path),
            "total_parts": len(flat_manifest),
            "parts": flat_manifest,
            "hierarchy": hierarchy,
        }, f, indent=2)

    return flat_manifest


# ── Helpers ─────────────────────────────────────────────────────────────────
def _get_solids(shape: TopoDS_Shape) -> list:
    """Recursively extracts individual solids/shells from a TopoDS_Compound."""
    solids = []
    if shape.IsNull():
        return solids
        
    stype = shape.ShapeType()
    if stype in (TopAbs_SOLID, TopAbs_SHELL, TopAbs_COMPSOLID):
        solids.append(shape)
    elif stype == TopAbs_COMPOUND:
        it = TopoDS_Iterator(shape)
        while it.More():
            solids.extend(_get_solids(it.Value()))
            it.Next()
    else:
        # Fallback for faces/edges if no solids are present
        solids.append(shape)
        
    return solids


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
    s = re.sub(r"_+", "_", s).strip("_")
    return f"{s}_{idx + 1:03d}"