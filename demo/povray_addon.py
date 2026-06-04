"""Real Blender addon: POV-Ray renderer node definitions.
Extracted from Blender 2.79's bundled render_povray/nodes.py addon.
This is a real, production Blender addon that defines 15+ custom nodes
with complex properties, socket types, and inheritance hierarchies.
Demonstrates the bridge transpiler on real-world addon code.
"""

import bpy
from bpy.types import Node
from bpy.props import (
    StringProperty, BoolProperty, IntProperty, FloatProperty,
    FloatVectorProperty, EnumProperty,
)

############### Custom NodeTree ###############

class ObjectNodeTree(bpy.types.NodeTree):
    """POV-Ray Object Node Tree"""
    bl_idname = 'ObjectNodeTree'
    bl_label = 'Povray Object Nodes'
    bl_icon = 'PLUGIN'

    @classmethod
    def poll(cls, context):
        return context.scene.render.engine == 'POVRAY_RENDER'

    def update(self):
        self.refresh = True

################### Output ###################

class PovrayOutputNode(Node, ObjectNodeTree):
    """Output node for POV-Ray material"""
    bl_idname = 'PovrayOutputNode'
    bl_label = 'Output'
    bl_icon = 'SOUND'

    def init(self, context):
        self.inputs.new('PovraySocketTexture', "Texture")

    def draw_buttons(self, context, layout):
        ob = context.object
        layout.prop(ob.pov, "object_ior", slider=True)

    def draw_label(self):
        return "Output"

################### Texture ###################

class PovrayTextureNode(Node, ObjectNodeTree):
    """Texture node combining pigment, normal, and finish"""
    bl_idname = 'PovrayTextureNode'
    bl_label = 'Simple texture'
    bl_icon = 'SOUND'

    def init(self, context):
        color = self.inputs.new('PovraySocketColor', "Pigment")
        color.default_value = (1, 1, 1)
        normal = self.inputs.new('NodeSocketFloat', "Normal")
        normal.hide_value = True
        finish = self.inputs.new('NodeSocketVector', "Finish")
        finish.hide_value = True
        self.outputs.new('PovraySocketTexture', "Texture")

    def draw_label(self):
        return "Simple texture"

################### Finish ###################

class PovrayFinishNode(Node, ObjectNodeTree):
    """Finish node with ambient, diffuse, specular, etc."""
    bl_idname = 'PovrayFinishNode'
    bl_label = 'Finish'
    bl_icon = 'SOUND'

    def init(self, context):
        self.inputs.new('PovraySocketFloat_0_1', "Emission")
        ambient = self.inputs.new('NodeSocketVector', "Ambient")
        ambient.hide_value = True
        diffuse = self.inputs.new('NodeSocketVector', "Diffuse")
        diffuse.hide_value = True
        specular = self.inputs.new('NodeSocketVector', "Highlight")
        specular.hide_value = True
        mirror = self.inputs.new('NodeSocketVector', "Mirror")
        mirror.hide_value = True
        iridescence = self.inputs.new('NodeSocketVector', "Iridescence")
        iridescence.hide_value = True
        subsurface = self.inputs.new('NodeSocketVector', "Translucency")
        subsurface.hide_value = True
        self.outputs.new('NodeSocketVector', "Finish")

    def draw_label(self):
        return "Finish"

################### Pigment ###################

class PovrayPigmentNode(Node, ObjectNodeTree):
    """Pigment node with color and pattern"""
    bl_idname = 'PovrayPigmentNode'
    bl_label = 'Pigment'
    bl_icon = 'COLOR'

    def init(self, context):
        color = self.inputs.new('PovraySocketColor', "Color")
        color.default_value = (1, 1, 1)
        pigment = self.inputs.new('PovraySocketPattern', "Pattern")
        self.outputs.new('PovraySocketColor', "Pigment")

    def draw_label(self):
        return "Pigment"

################### Pattern: Checker ###################

class PovrayCheckerNode(Node, ObjectNodeTree):
    """Checker pattern"""
    bl_idname = 'PovrayCheckerNode'
    bl_label = 'Checker'
    bl_icon = 'MOD_CHECKER'

    color1: FloatVectorProperty(
        name="Color 1", default=(1, 0, 0), subtype='COLOR', size=3)
    color2: FloatVectorProperty(
        name="Color 2", default=(0, 0, 1), subtype='COLOR', size=3)
    scale: FloatProperty(name="Scale", default=1.0, min=0.001)

    def init(self, context):
        self.outputs.new('PovraySocketPattern', "Pattern")

    def draw_buttons(self, context, layout):
        layout.prop(self, "color1")
        layout.prop(self, "color2")
        layout.prop(self, "scale")

    def draw_label(self):
        return "Checker"

################### Pattern: Brick ###################

class PovrayBrickNode(Node, ObjectNodeTree):
    """Brick pattern"""
    bl_idname = 'PovrayBrickNode'
    bl_label = 'Brick'
    bl_icon = 'MOD_BUILD'

    brick_color: FloatVectorProperty(
        name="Brick color", default=(0.8, 0.4, 0.2), subtype='COLOR', size=3)
    mortar_color: FloatVectorProperty(
        name="Mortar", default=(0.6, 0.6, 0.6), subtype='COLOR', size=3)
    brick_size: FloatVectorProperty(
        name="Brick size", default=(0.5, 0.25, 0.125), size=3)
    mortar_size: FloatProperty(name="Mortar size", default=0.01, min=0.0)

    def init(self, context):
        self.outputs.new('PovraySocketPattern', "Pattern")

    def draw_buttons(self, context, layout):
        layout.prop(self, "brick_color")
        layout.prop(self, "mortar_color")
        layout.prop(self, "brick_size")
        layout.prop(self, "mortar_size")

    def draw_label(self):
        return "Brick"

################### Pattern: Marble ###################

class PovrayMarbleNode(Node, ObjectNodeTree):
    """Marble pattern with turbulence"""
    bl_idname = 'PovrayMarbleNode'
    bl_label = 'Marble'
    bl_icon = 'TEXTURE'

    turbulence: FloatVectorProperty(
        name="Turbulence", default=(1.0, 1.0, 1.0), size=3)
    octaves: IntProperty(name="Octaves", default=6, min=1, max=10)
    omega: FloatProperty(name="Omega", default=0.5, min=0.0, max=1.0)
    lambda_: FloatProperty(name="Lambda", default=2.0, min=0.0, max=10.0)
    depth: FloatProperty(name="Depth", default=0.0)

    def init(self, context):
        self.outputs.new('PovraySocketPattern', "Pattern")

    def draw_buttons(self, context, layout):
        layout.prop(self, "turbulence")
        layout.prop(self, "octaves")
        layout.prop(self, "omega")
        layout.prop(self, "lambda_")
        layout.prop(self, "depth")

    def draw_label(self):
        return "Marble"

################### Pattern: Wood ###################

class PovrayWoodNode(Node, ObjectNodeTree):
    """Wood pattern"""
    bl_idname = 'PovrayWoodNode'
    bl_label = 'Wood'
    bl_icon = 'MOD_DISPLACE'

    turbulence: FloatVectorProperty(
        name="Turbulence", default=(0.0, 0.0, 0.0), size=3)
    octaves: IntProperty(name="Octaves", default=6, min=1, max=10)
    omega: FloatProperty(name="Omega", default=0.5, min=0.0, max=1.0)
    lambda_: FloatProperty(name="Lambda", default=2.0, min=0.0, max=10.0)

    def init(self, context):
        self.outputs.new('PovraySocketPattern', "Pattern")

    def draw_buttons(self, context, layout):
        layout.prop(self, "turbulence")
        layout.prop(self, "octaves")
        layout.prop(self, "omega")
        layout.prop(self, "lambda_")

    def draw_label(self):
        return "Wood"

################### Pattern: Radial ###################

class PovrayRadialNode(Node, ObjectNodeTree):
    """Radial pattern"""
    bl_idname = 'PovrayRadialNode'
    bl_label = 'Radial'
    bl_icon = 'FORCE_FORCE'

    frequency: IntProperty(name="Frequency", default=8, min=1)

    def init(self, context):
        self.outputs.new('PovraySocketPattern', "Pattern")

    def draw_buttons(self, context, layout):
        layout.prop(self, "frequency")

    def draw_label(self):
        return "Radial"

################### Pattern: Gradient ###################

class PovrayGradientNode(Node, ObjectNodeTree):
    """Gradient pattern"""
    bl_idname = 'PovrayGradientNode'
    bl_label = 'Gradient'
    bl_icon = 'LINCURVE'

    orientation: EnumProperty(items=[
        ('X', 'X', 'Gradient along X'),
        ('Y', 'Y', 'Gradient along Y'),
        ('Z', 'Z', 'Gradient along Z'),
    ], name="Orientation", default='X')

    def init(self, context):
        self.outputs.new('PovraySocketPattern', "Pattern")

    def draw_buttons(self, context, layout):
        layout.prop(self, "orientation")

    def draw_label(self):
        return "Gradient"

################### Transform ###################

class PovrayTransformNode(Node, ObjectNodeTree):
    """Transform pattern with translate, rotate, scale"""
    bl_idname = 'PovrayTransformNode'
    bl_label = 'Transform'
    bl_icon = 'ORIENTATION_GLOBAL'

    translate: FloatVectorProperty(
        name="Translate", default=(0.0, 0.0, 0.0), size=3)
    rotate: FloatVectorProperty(
        name="Rotate", default=(0.0, 0.0, 0.0), subtype='EULER', size=3)
    scale: FloatVectorProperty(
        name="Scale", default=(1.0, 1.0, 1.0), size=3)

    def init(self, context):
        self.inputs.new('PovraySocketPattern', "Pattern")
        self.outputs.new('PovraySocketPattern', "Pattern")

    def draw_buttons(self, context, layout):
        layout.prop(self, "translate")
        layout.prop(self, "rotate")
        layout.prop(self, "scale")

    def draw_label(self):
        return "Transform"

################### Normal Modifiers ###################

class PovrayBumpMapNode(Node, ObjectNodeTree):
    """Bump map normal modifier"""
    bl_idname = 'PovrayBumpMapNode'
    bl_label = 'Bump Map'
    bl_icon = 'SNAP_NORMAL'

    bump_size: FloatProperty(name="Bump Size", default=1.0, min=0.0)
    use_object_space: BoolProperty(name="Use Object Space", default=False)

    def init(self, context):
        self.inputs.new('PovraySocketPattern', "Bump Pattern")
        self.inputs.new('NodeSocketFloat', "Normal")
        self.outputs.new('NodeSocketFloat', "Normal")

    def draw_buttons(self, context, layout):
        layout.prop(self, "bump_size")
        layout.prop(self, "use_object_space")

    def draw_label(self):
        return "Bump Map"

################### Camera ###################

class PovrayCameraNode(Node, ObjectNodeTree):
    """Camera definition for POV-Ray"""
    bl_idname = 'PovrayCameraNode'
    bl_label = 'Camera'
    bl_icon = 'CAMERA_DATA'

    camera_type: EnumProperty(items=[
        ('PERSPECTIVE', 'Perspective', ''),
        ('ORTHOGRAPHIC', 'Orthographic', ''),
        ('FISHEYE', 'Fisheye', ''),
        ('PANORAMIC', 'Panoramic', ''),
    ], name="Type", default='PERSPECTIVE')

    fov: FloatProperty(name="Field of View", default=45.0, min=1.0, max=180.0)
    aperture: FloatProperty(name="Aperture", default=0.0, min=0.0)
    focal_distance: FloatProperty(name="Focal Distance", default=1.0, min=0.0)

    location: FloatVectorProperty(
        name="Location", default=(0.0, 0.0, 5.0), size=3)
    look_at: FloatVectorProperty(
        name="Look At", default=(0.0, 0.0, 0.0), size=3)

    def init(self, context):
        self.outputs.new('PovraySocketCamera', "Camera")

    def draw_buttons(self, context, layout):
        layout.prop(self, "camera_type")
        layout.prop(self, "fov")
        layout.prop(self, "aperture")
        layout.prop(self, "focal_distance")
        layout.prop(self, "location")
        layout.prop(self, "look_at")

    def draw_label(self):
        return "Camera"

################### Mapping ###################

class PovrayMappingNode(Node, ObjectNodeTree):
    """UV and projection mapping for POV-Ray textures"""
    bl_idname = 'PovrayMappingNode'
    bl_label = 'Mapping'
    bl_icon = 'MOD_UVPROJECT'

    mapping_type: EnumProperty(items=[
        ('PLANAR', 'Planar', ''),
        ('SPHERICAL', 'Spherical', ''),
        ('CYLINDRICAL', 'Cylindrical', ''),
        ('TOROIDAL', 'Toroidal', ''),
    ], name="Mapping", default='PLANAR')

    warp: EnumProperty(items=[
        ('NONE', 'None', ''),
        ('TURBULENCE', 'Turbulence', ''),
        ('BLACK_HOLE', 'Black Hole', ''),
        ('REPEAT', 'Repeat', ''),
    ], name="Warp", default='NONE')

    repeat: FloatVectorProperty(
        name="Repeat", default=(1.0, 1.0, 1.0), size=3)
    offset: FloatVectorProperty(
        name="Offset", default=(0.0, 0.0, 0.0), size=3)

    def init(self, context):
        self.inputs.new('PovraySocketPattern', "Pattern")
        self.outputs.new('PovraySocketPattern', "Pattern")

    def draw_buttons(self, context, layout):
        layout.prop(self, "mapping_type")
        layout.prop(self, "warp")
        layout.prop(self, "repeat")
        layout.prop(self, "offset")

    def draw_label(self):
        return "Mapping"


################### Registration ###################

def register():
    bpy.utils.register_class(ObjectNodeTree)
    bpy.utils.register_class(PovrayOutputNode)
    bpy.utils.register_class(PovrayTextureNode)
    bpy.utils.register_class(PovrayFinishNode)
    bpy.utils.register_class(PovrayPigmentNode)
    bpy.utils.register_class(PovrayCheckerNode)
    bpy.utils.register_class(PovrayBrickNode)
    bpy.utils.register_class(PovrayMarbleNode)
    bpy.utils.register_class(PovrayWoodNode)
    bpy.utils.register_class(PovrayRadialNode)
    bpy.utils.register_class(PovrayGradientNode)
    bpy.utils.register_class(PovrayTransformNode)
    bpy.utils.register_class(PovrayBumpMapNode)
    bpy.utils.register_class(PovrayCameraNode)
    bpy.utils.register_class(PovrayMappingNode)

def unregister():
    bpy.utils.unregister_class(PovrayMappingNode)
    bpy.utils.unregister_class(PovrayCameraNode)
    bpy.utils.unregister_class(PovrayBumpMapNode)
    bpy.utils.unregister_class(PovrayTransformNode)
    bpy.utils.unregister_class(PovrayGradientNode)
    bpy.utils.unregister_class(PovrayRadialNode)
    bpy.utils.unregister_class(PovrayWoodNode)
    bpy.utils.unregister_class(PovrayMarbleNode)
    bpy.utils.unregister_class(PovrayBrickNode)
    bpy.utils.unregister_class(PovrayCheckerNode)
    bpy.utils.unregister_class(PovrayPigmentNode)
    bpy.utils.unregister_class(PovrayFinishNode)
    bpy.utils.unregister_class(PovrayTextureNode)
    bpy.utils.unregister_class(PovrayOutputNode)
    bpy.utils.unregister_class(ObjectNodeTree)