"""
blender_exporter.py — Blender addon side.

Install: drop into Blender's text editor and run, or save as an addon.
Exports every node group in `bpy.data.node_groups` (or the active editor's
tree) to a BNG/1 JSON document compatible with `src/bridge/importer.ts`.

Run from a Blender Text block::

    import bpy, json
    from blender_exporter import build_document
    doc = build_document(bpy.data.node_groups)
    with open('/tmp/scene.bng.json', 'w') as f:
        json.dump(doc, f, indent=2)
"""

from __future__ import annotations

import json
import uuid
from typing import Any, Iterable

import bpy  # type: ignore


SUPPORTED_TREE_IDS = {
    "ShaderNodeTree",
    "GeometryNodeTree",
    "CompositorNodeTree",
    "TextureNodeTree",
}


def _socket_default(sock) -> Any:  # noqa: ANN001
    """Read a socket's default value in a JSON-safe form."""
    if not hasattr(sock, "default_value"):
        return None
    v = sock.default_value
    # vectors / colors come back as bpy_prop_array
    try:
        return list(v)  # type: ignore[arg-type]
    except TypeError:
        return v


def _serialize_socket_def(sock) -> dict[str, Any]:  # noqa: ANN001
    return {
        "identifier": sock.identifier,
        "name": sock.name,
        "socket_type": sock.bl_idname,
        "default_value": _socket_default(sock),
        "hide_value": getattr(sock, "hide_value", False) or None,
    }


def _serialize_properties(node) -> dict[str, Any]:  # noqa: ANN001
    """Walk all RNA-declared properties (excluding internal ones) and serialize."""
    out: dict[str, Any] = {}
    # rna_type.properties has every property declared by the class.
    for prop in node.bl_rna.properties:
        if prop.is_readonly:
            continue
        name = prop.identifier
        if name in {
            "rna_type", "name", "label", "location", "width", "height",
            "color", "use_custom_color", "hide", "mute", "select", "parent",
            "inputs", "outputs", "internal_links", "show_options", "show_preview",
            "show_texture", "type", "bl_idname", "bl_label",
        }:
            continue
        try:
            val = getattr(node, name)
        except AttributeError:
            continue
        try:
            json.dumps(val)
            out[name] = val
        except TypeError:
            # vec, etc.
            try:
                out[name] = list(val)
            except TypeError:
                # bpy object reference (e.g. Image, Object) — store by name
                if hasattr(val, "name"):
                    out[name] = {"$ref": val.name, "$type": type(val).__name__}
    return out


def _serialize_interface(tree) -> dict[str, Any]:  # noqa: ANN001
    items: list[dict[str, Any]] = []
    iface = getattr(tree, "interface", None)
    if iface is None:
        # pre-4.0 fallback: use tree.inputs / tree.outputs
        for s in getattr(tree, "inputs", []):
            items.append({
                "kind": "socket", "in_out": "INPUT", "socket_type": s.bl_socket_idname,
                "name": s.name, "identifier": s.identifier, "description": s.description,
                "default_value": _socket_default(s), "parent": None,
            })
        for s in getattr(tree, "outputs", []):
            items.append({
                "kind": "socket", "in_out": "OUTPUT", "socket_type": s.bl_socket_idname,
                "name": s.name, "identifier": s.identifier, "description": s.description,
                "default_value": _socket_default(s), "parent": None,
            })
        return {"items": items}
    for it in iface.items_tree:
        if it.item_type == "SOCKET":
            items.append({
                "kind": "socket",
                "in_out": it.in_out,
                "socket_type": it.bl_socket_idname or it.socket_type,
                "name": it.name,
                "identifier": it.identifier,
                "description": it.description,
                "default_value": _socket_default(it),
                "parent": it.parent.identifier if it.parent else None,
            })
        else:  # PANEL
            items.append({
                "kind": "panel",
                "name": it.name,
                "identifier": it.identifier,
                "description": it.description,
                "default_closed": it.default_closed,
                "parent": it.parent.identifier if it.parent else None,
            })
    return {"items": items}


def _node_ref_id(node, _ids: dict[int, str]) -> str:  # noqa: ANN001
    key = id(node)
    if key not in _ids:
        _ids[key] = uuid.uuid4().hex[:10]
    return _ids[key]


def _tree_ref_id(tree, _ids: dict[int, str]) -> str:  # noqa: ANN001
    key = id(tree)
    if key not in _ids:
        _ids[key] = uuid.uuid4().hex[:10]
    return _ids[key]


def _serialize_tree(tree, tree_ids: dict[int, str]) -> dict[str, Any]:  # noqa: ANN001
    node_ids: dict[int, str] = {}
    nodes_out: list[dict[str, Any]] = []
    for n in tree.nodes:
        nodes_out.append({
            "id": _node_ref_id(n, node_ids),
            "bl_idname": n.bl_idname,
            "name": n.name,
            "label": n.label or None,
            "location": [n.location.x, n.location.y],
            "width": n.width,
            "mute": n.mute or None,
            "hide": n.hide or None,
            "properties": _serialize_properties(n),
            "inputs": [_serialize_socket_def(s) for s in n.inputs],
            "outputs": [_serialize_socket_def(s) for s in n.outputs],
            "node_tree": _tree_ref_id(n.node_tree, tree_ids) if hasattr(n, "node_tree") and n.node_tree else None,
        })
    links_out = []
    for l in tree.links:
        links_out.append({
            "from_node": _node_ref_id(l.from_node, node_ids),
            "from_socket": l.from_socket.identifier,
            "to_node": _node_ref_id(l.to_node, node_ids),
            "to_socket": l.to_socket.identifier,
            "is_muted": l.is_muted or None,
        })
    return {
        "id": _tree_ref_id(tree, tree_ids),
        "bl_idname": tree.bl_idname,
        "name": tree.name,
        "interface": _serialize_interface(tree),
        "nodes": nodes_out,
        "links": links_out,
    }


def build_document(trees: Iterable) -> dict[str, Any]:  # noqa: ANN001
    source_trees = [t for t in trees if t.bl_idname in SUPPORTED_TREE_IDS]
    # Stable within one export document: group node references use these ids,
    # not mutable Blender names, so the TypeScript importer can resolve them.
    tree_ids: dict[int, str] = {id(t): uuid.uuid4().hex[:10] for t in source_trees}
    out_trees: list[dict[str, Any]] = []
    for t in source_trees:
        out_trees.append(_serialize_tree(t, tree_ids))
    return {
        "schema": "BNG/1",
        "blender_version": bpy.app.version_string,
        "trees": out_trees,
    }


# ---------------------------------------------------------------------------
#  Operator wrapper
# ---------------------------------------------------------------------------

class BNG_OT_export(bpy.types.Operator):
    """Export node groups to BNG JSON."""
    bl_idname = "bng.export"
    bl_label = "Export Node Groups (BNG/1 JSON)"

    filepath: bpy.props.StringProperty(subtype="FILE_PATH", default="//node_groups.bng.json")  # type: ignore

    def execute(self, context):  # noqa: ANN001
        doc = build_document(bpy.data.node_groups)
        path = bpy.path.abspath(self.filepath)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2, default=str)
        self.report({"INFO"}, f"Wrote {len(doc['trees'])} trees to {path}")
        return {"FINISHED"}

    def invoke(self, context, _event):  # noqa: ANN001
        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}


def register() -> None:
    bpy.utils.register_class(BNG_OT_export)


def unregister() -> None:
    bpy.utils.unregister_class(BNG_OT_export)


if __name__ == "__main__":
    register()
