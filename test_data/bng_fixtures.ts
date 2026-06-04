import type { BngDocumentT } from '../src/bridge/schema';

export const REPEAT_ZONE_FLOWER: BngDocumentT = {
  schema: 'BNG/1', blender_version: '4.0.0',
  trees: [{
    id: 'flower_main', bl_idname: 'GeometryNodeTree', name: 'Repeat Zone Flower',
    interface: { items: [
      { kind: 'socket', in_out: 'INPUT', socket_type: 'NodeSocketInt', name: 'Petals', identifier: 'Petals', default_value: 8 },
      { kind: 'socket', in_out: 'OUTPUT', socket_type: 'NodeSocketGeometry', name: 'Geometry', identifier: 'Geometry' },
    ]},
    nodes: [
      { id: 'gout', bl_idname: 'NodeGroupOutput', name: 'Group Output', location: [800, 0], properties: {}, inputs: [], outputs: [] },
      { id: 'circle', bl_idname: 'GeometryNodeCurveCircle', name: 'Circle', location: [-600, 0], properties: {}, inputs: [
        { identifier: 'Resolution', name: 'Resolution', socket_type: 'NodeSocketInt', default_value: 64 },
        { identifier: 'Radius', name: 'Radius', socket_type: 'NodeSocketFloat', default_value: 1.5 },
      ], outputs: [{ identifier: 'Curve', name: 'Curve', socket_type: 'NodeSocketGeometry' }] },
      { id: 'resample', bl_idname: 'GeometryNodeResampleCurve', name: 'Resample', location: [-400, 0], properties: {}, inputs: [
        { identifier: 'Curve', name: 'Curve', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Count', name: 'Count', socket_type: 'NodeSocketInt', default_value: 8 },
      ], outputs: [{ identifier: 'Curve', name: 'Curve', socket_type: 'NodeSocketGeometry' }] },
      { id: 'toPts', bl_idname: 'GeometryNodeCurveToPoints', name: 'Curve to Points', location: [-200, 0], properties: {}, inputs: [
        { identifier: 'Curve', name: 'Curve', socket_type: 'NodeSocketGeometry' },
      ], outputs: [{ identifier: 'Points', name: 'Points', socket_type: 'NodeSocketGeometry' }] },
      { id: 'petal', bl_idname: 'GeometryNodeMeshCube', name: 'Petal', location: [-400, 250], properties: {}, inputs: [
        { identifier: 'Size', name: 'Size', socket_type: 'NodeSocketVector', default_value: [0.3, 0.05, 1.0] },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
      { id: 'inst', bl_idname: 'GeometryNodeInstanceOnPoints', name: 'Instance', location: [400, 250], properties: {}, inputs: [
        { identifier: 'Points', name: 'Points', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Instance', name: 'Instance', socket_type: 'NodeSocketGeometry' },
      ], outputs: [{ identifier: 'Instances', name: 'Instances', socket_type: 'NodeSocketGeometry' }] },
      { id: 'realize', bl_idname: 'GeometryNodeRealizeInstances', name: 'Realize', location: [600, 250], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
      { id: 'join', bl_idname: 'GeometryNodeJoinGeometry', name: 'Join', location: [600, 100], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
    ],
    links: [
      { from_node: 'circle', from_socket: 'Curve', to_node: 'resample', to_socket: 'Curve' },
      { from_node: 'resample', from_socket: 'Curve', to_node: 'toPts', to_socket: 'Curve' },
      { from_node: 'toPts', from_socket: 'Points', to_node: 'inst', to_socket: 'Points' },
      { from_node: 'petal', from_socket: 'Geometry', to_node: 'inst', to_socket: 'Instance' },
      { from_node: 'inst', from_socket: 'Instances', to_node: 'realize', to_socket: 'Geometry' },
      { from_node: 'realize', from_socket: 'Geometry', to_node: 'join', to_socket: 'Geometry' },
      { from_node: 'join', from_socket: 'Geometry', to_node: 'gout', to_socket: 'Geometry' },
    ],
  }],
};

export const PEBBLE_SCATTERING: BngDocumentT = {
  schema: 'BNG/1', blender_version: '3.0.0',
  trees: [{
    id: 'pebble_scatter', bl_idname: 'GeometryNodeTree', name: 'Pebble Scattering',
    interface: { items: [
      { kind: 'socket', in_out: 'OUTPUT', socket_type: 'NodeSocketGeometry', name: 'Geometry', identifier: 'Geometry' },
    ]},
    nodes: [
      { id: 'gout', bl_idname: 'NodeGroupOutput', name: 'Group Output', location: [1000, 0], properties: {}, inputs: [], outputs: [] },
      { id: 'grid', bl_idname: 'GeometryNodeMeshGrid', name: 'Terrain', location: [-800, 0], properties: {}, inputs: [
        { identifier: 'Size X', name: 'Size X', socket_type: 'NodeSocketFloat', default_value: 10 },
        { identifier: 'Size Y', name: 'Size Y', socket_type: 'NodeSocketFloat', default_value: 10 },
        { identifier: 'Vertices X', name: 'Vertices X', socket_type: 'NodeSocketInt', default_value: 50 },
        { identifier: 'Vertices Y', name: 'Vertices Y', socket_type: 'NodeSocketInt', default_value: 50 },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
      { id: 'pos', bl_idname: 'GeometryNodeInputPosition', name: 'Position', location: [-800, -200], properties: {}, inputs: [], outputs: [
        { identifier: 'Position', name: 'Position', socket_type: 'NodeSocketVector' },
      ]},
      { id: 'sep', bl_idname: 'SeparateXYZNode', name: 'Separate XYZ', location: [-600, -200], properties: {}, inputs: [
        { identifier: 'Vector', name: 'Vector', socket_type: 'NodeSocketVector' },
      ], outputs: [
        { identifier: 'X', name: 'X', socket_type: 'NodeSocketFloat' },
        { identifier: 'Y', name: 'Y', socket_type: 'NodeSocketFloat' },
      ]},
      { id: 'sinX', bl_idname: 'ShaderNodeMath', name: 'Sine X', location: [-400, -300], properties: { operation: 'SINE' }, inputs: [
        { identifier: 'A', name: 'A', socket_type: 'NodeSocketFloat' },
      ], outputs: [{ identifier: 'Value', name: 'Value', socket_type: 'NodeSocketFloat' }] },
      { id: 'sinY', bl_idname: 'ShaderNodeMath', name: 'Sine Y', location: [-400, -450], properties: { operation: 'SINE' }, inputs: [
        { identifier: 'A', name: 'A', socket_type: 'NodeSocketFloat' },
      ], outputs: [{ identifier: 'Value', name: 'Value', socket_type: 'NodeSocketFloat' }] },
      { id: 'addH', bl_idname: 'ShaderNodeMath', name: 'Add Height', location: [-200, -350], properties: { operation: 'ADD' }, inputs: [
        { identifier: 'A', name: 'A', socket_type: 'NodeSocketFloat' },
        { identifier: 'B', name: 'B', socket_type: 'NodeSocketFloat' },
      ], outputs: [{ identifier: 'Value', name: 'Value', socket_type: 'NodeSocketFloat' }] },
      { id: 'combZ', bl_idname: 'CombineXYZNode', name: 'Combine Z', location: [0, -250], properties: {}, inputs: [
        { identifier: 'X', name: 'X', socket_type: 'NodeSocketFloat', default_value: 0 },
        { identifier: 'Y', name: 'Y', socket_type: 'NodeSocketFloat', default_value: 0 },
        { identifier: 'Z', name: 'Z', socket_type: 'NodeSocketFloat' },
      ], outputs: [{ identifier: 'Vector', name: 'Vector', socket_type: 'NodeSocketVector' }] },
      { id: 'setPos', bl_idname: 'GeometryNodeSetPosition', name: 'Set Position', location: [200, -100], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Offset', name: 'Offset', socket_type: 'NodeSocketVector' },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
      { id: 'dist', bl_idname: 'GeometryNodeDistributePointsOnFaces', name: 'Distribute', location: [450, -50], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Density', name: 'Density', socket_type: 'NodeSocketFloat', default_value: 30 },
      ], outputs: [{ identifier: 'Points', name: 'Points', socket_type: 'NodeSocketGeometry' }] },
      { id: 'pebble', bl_idname: 'GeometryNodeMeshIcoSphere', name: 'Pebble', location: [200, 300], properties: {}, inputs: [
        { identifier: 'Radius', name: 'Radius', socket_type: 'NodeSocketFloat', default_value: 0.15 },
        { identifier: 'Subdivisions', name: 'Subdivisions', socket_type: 'NodeSocketInt', default_value: 1 },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
      { id: 'inst2', bl_idname: 'GeometryNodeInstanceOnPoints', name: 'Instance Pebbles', location: [700, 0], properties: {}, inputs: [
        { identifier: 'Points', name: 'Points', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Instance', name: 'Instance', socket_type: 'NodeSocketGeometry' },
      ], outputs: [{ identifier: 'Instances', name: 'Instances', socket_type: 'NodeSocketGeometry' }] },
      { id: 'realize2', bl_idname: 'GeometryNodeRealizeInstances', name: 'Realize', location: [900, 0], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
    ],
    links: [
      { from_node: 'pos', from_socket: 'Position', to_node: 'sep', to_socket: 'Vector' },
      { from_node: 'sep', from_socket: 'X', to_node: 'sinX', to_socket: 'A' },
      { from_node: 'sep', from_socket: 'Y', to_node: 'sinY', to_socket: 'A' },
      { from_node: 'sinX', from_socket: 'Value', to_node: 'addH', to_socket: 'A' },
      { from_node: 'sinY', from_socket: 'Value', to_node: 'addH', to_socket: 'B' },
      { from_node: 'addH', from_socket: 'Value', to_node: 'combZ', to_socket: 'Z' },
      { from_node: 'combZ', from_socket: 'Vector', to_node: 'setPos', to_socket: 'Offset' },
      { from_node: 'grid', from_socket: 'Geometry', to_node: 'setPos', to_socket: 'Geometry' },
      { from_node: 'setPos', from_socket: 'Geometry', to_node: 'dist', to_socket: 'Geometry' },
      { from_node: 'dist', from_socket: 'Points', to_node: 'inst2', to_socket: 'Points' },
      { from_node: 'pebble', from_socket: 'Geometry', to_node: 'inst2', to_socket: 'Instance' },
      { from_node: 'inst2', from_socket: 'Instances', to_node: 'realize2', to_socket: 'Geometry' },
      { from_node: 'realize2', from_socket: 'Geometry', to_node: 'gout', to_socket: 'Geometry' },
    ],
  }],
};

export const JIGGLY_PUDDING: BngDocumentT = {
  schema: 'BNG/1', blender_version: '3.6.0',
  trees: [{
    id: 'pudding_sim', bl_idname: 'GeometryNodeTree', name: 'Jiggly Pudding',
    interface: { items: [
      { kind: 'socket', in_out: 'OUTPUT', socket_type: 'NodeSocketGeometry', name: 'Geometry', identifier: 'Geometry' },
    ]},
    nodes: [
      { id: 'gout', bl_idname: 'NodeGroupOutput', name: 'Group Output', location: [800, 0], properties: {}, inputs: [], outputs: [] },
      { id: 'ico', bl_idname: 'GeometryNodeMeshIcoSphere', name: 'IcoSphere', location: [-700, 0], properties: {}, inputs: [
        { identifier: 'Radius', name: 'Radius', socket_type: 'NodeSocketFloat', default_value: 1 },
        { identifier: 'Subdivisions', name: 'Subdivisions', socket_type: 'NodeSocketInt', default_value: 3 },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
      { id: 's_in', bl_idname: 'GeometryNodeSimulationInput', name: 'Sim Input', location: [-400, 0], properties: {}, inputs: [], outputs: [], state_items: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Velocity', name: 'Velocity', socket_type: 'NodeSocketVector' },
      ]},
      { id: 's_out', bl_idname: 'GeometryNodeSimulationOutput', name: 'Sim Output', location: [500, 0], properties: {}, inputs: [], outputs: [], state_items: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Velocity', name: 'Velocity', socket_type: 'NodeSocketVector' },
      ]},
      { id: 'pos', bl_idname: 'GeometryNodeInputPosition', name: 'Position', location: [-200, 150], properties: {}, inputs: [], outputs: [
        { identifier: 'Position', name: 'Position', socket_type: 'NodeSocketVector' },
      ]},
      { id: 'scale', bl_idname: 'VectorMathNode', name: 'Scale', location: [0, 150], properties: { operation: 'SCALE' }, inputs: [
        { identifier: 'A', name: 'A', socket_type: 'NodeSocketVector' },
        { identifier: 'Scale', name: 'Scale', socket_type: 'NodeSocketFloat', default_value: 0.02 },
      ], outputs: [{ identifier: 'Vector', name: 'Vector', socket_type: 'NodeSocketVector' }] },
      { id: 'setPos', bl_idname: 'GeometryNodeSetPosition', name: 'Set Position', location: [300, 0], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Offset', name: 'Offset', socket_type: 'NodeSocketVector' },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
    ],
    links: [
      { from_node: 'ico', from_socket: 'Geometry', to_node: 's_in', to_socket: 'in_Geometry' },
      { from_node: 'pos', from_socket: 'Position', to_node: 'scale', to_socket: 'A' },
      { from_node: 'scale', from_socket: 'Vector', to_node: 'setPos', to_socket: 'Offset' },
      { from_node: 's_out', from_socket: 'Geometry', to_node: 'gout', to_socket: 'Geometry' },
    ],
  }],
};

export const HEXGRID: BngDocumentT = {
  schema: 'BNG/1', blender_version: '3.3.0',
  trees: [
    { id: 'hex_geo', bl_idname: 'GeometryNodeTree', name: 'Hex Grid',
      interface: { items: [
        { kind: 'socket', in_out: 'OUTPUT', socket_type: 'NodeSocketGeometry', name: 'Geometry', identifier: 'Geometry' },
      ]},
      nodes: [
        { id: 'gout', bl_idname: 'NodeGroupOutput', name: 'Group Output', location: [800, 0], properties: {}, inputs: [], outputs: [] },
        { id: 'grid', bl_idname: 'GeometryNodeMeshGrid', name: 'Grid', location: [-600, 0], properties: {}, inputs: [
          { identifier: 'Size X', name: 'Size X', socket_type: 'NodeSocketFloat', default_value: 5 },
          { identifier: 'Size Y', name: 'Size Y', socket_type: 'NodeSocketFloat', default_value: 5 },
          { identifier: 'Vertices X', name: 'Vertices X', socket_type: 'NodeSocketInt', default_value: 10 },
          { identifier: 'Vertices Y', name: 'Vertices Y', socket_type: 'NodeSocketInt', default_value: 10 },
        ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
        { id: 'dual', bl_idname: 'GeometryNodeDualMesh', name: 'Dual Mesh', location: [-350, 0], properties: {}, inputs: [
          { identifier: 'Mesh', name: 'Mesh', socket_type: 'NodeSocketGeometry' },
        ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
        { id: 'subdiv', bl_idname: 'GeometryNodeSubdivisionSurface', name: 'Subdivision', location: [-100, 0], properties: {}, inputs: [
          { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
          { identifier: 'Level', name: 'Level', socket_type: 'NodeSocketInt', default_value: 2 },
        ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
        { id: 'extrude', bl_idname: 'GeometryNodeExtrudeMesh', name: 'Extrude', location: [150, 0], properties: {}, inputs: [
          { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
        ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
        { id: 'join', bl_idname: 'GeometryNodeJoinGeometry', name: 'Join', location: [400, 0], properties: {}, inputs: [
          { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
        ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
      ],
      links: [
        { from_node: 'grid', from_socket: 'Geometry', to_node: 'dual', to_socket: 'Mesh' },
        { from_node: 'dual', from_socket: 'Geometry', to_node: 'subdiv', to_socket: 'Geometry' },
        { from_node: 'subdiv', from_socket: 'Geometry', to_node: 'extrude', to_socket: 'Geometry' },
        { from_node: 'extrude', from_socket: 'Geometry', to_node: 'join', to_socket: 'Geometry' },
        { from_node: 'join', from_socket: 'Geometry', to_node: 'gout', to_socket: 'Geometry' },
      ],
    },
    { id: 'hex_shader', bl_idname: 'ShaderNodeTree', name: 'Hex Material',
      interface: { items: [] },
      nodes: [
        { id: 'out', bl_idname: 'ShaderNodeOutputMaterial', name: 'Material Output', location: [400, 0], properties: {}, inputs: [
          { identifier: 'Surface', name: 'Surface', socket_type: 'NodeSocketShader' },
        ], outputs: [] },
        { id: 'bsdf', bl_idname: 'ShaderNodeBsdfPrincipled', name: 'Principled BSDF', location: [100, 0], properties: {}, inputs: [
          { identifier: 'Base Color', name: 'Base Color', socket_type: 'NodeSocketColor', default_value: [0.2, 0.6, 0.9, 1] },
          { identifier: 'Metallic', name: 'Metallic', socket_type: 'NodeSocketFloat', default_value: 0.3 },
          { identifier: 'Roughness', name: 'Roughness', socket_type: 'NodeSocketFloat', default_value: 0.4 },
        ], outputs: [{ identifier: 'BSDF', name: 'BSDF', socket_type: 'NodeSocketShader' }] },
        { id: 'noise', bl_idname: 'ShaderNodeTexNoise', name: 'Noise', location: [-300, -150], properties: {}, inputs: [
          { identifier: 'Scale', name: 'Scale', socket_type: 'NodeSocketFloat', default_value: 8 },
          { identifier: 'Detail', name: 'Detail', socket_type: 'NodeSocketFloat', default_value: 4 },
          { identifier: 'Roughness', name: 'Roughness', socket_type: 'NodeSocketFloat', default_value: 0.5 },
        ], outputs: [
          { identifier: 'Fac', name: 'Fac', socket_type: 'NodeSocketFloat' },
          { identifier: 'Color', name: 'Color', socket_type: 'NodeSocketColor' },
        ]},
        { id: 'hsv', bl_idname: 'ShaderNodeHueSaturation', name: 'Hue/Sat', location: [-300, -350], properties: {}, inputs: [
          { identifier: 'Hue', name: 'Hue', socket_type: 'NodeSocketFloat', default_value: 0.55 },
          { identifier: 'Saturation', name: 'Saturation', socket_type: 'NodeSocketFloat', default_value: 1.2 },
          { identifier: 'Value', name: 'Value', socket_type: 'NodeSocketFloat', default_value: 1 },
          { identifier: 'Fac', name: 'Fac', socket_type: 'NodeSocketFloat', default_value: 1 },
          { identifier: 'Color', name: 'Color', socket_type: 'NodeSocketColor' },
        ], outputs: [{ identifier: 'Color', name: 'Color', socket_type: 'NodeSocketColor' }] },
      ],
      links: [
        { from_node: 'bsdf', from_socket: 'BSDF', to_node: 'out', to_socket: 'Surface' },
        { from_node: 'noise', from_socket: 'Color', to_node: 'hsv', to_socket: 'Color' },
        { from_node: 'hsv', from_socket: 'Color', to_node: 'bsdf', to_socket: 'Base Color' },
        { from_node: 'noise', from_socket: 'Fac', to_node: 'bsdf', to_socket: 'Roughness' },
      ],
    },
  ],
};

export const INDEX_OF_NEAREST: BngDocumentT = {
  schema: 'BNG/1', blender_version: '3.6.0',
  trees: [{
    id: 'nearest_demo', bl_idname: 'GeometryNodeTree', name: 'Index of Nearest',
    interface: { items: [
      { kind: 'socket', in_out: 'OUTPUT', socket_type: 'NodeSocketGeometry', name: 'Geometry', identifier: 'Geometry' },
    ]},
    nodes: [
      { id: 'gout', bl_idname: 'NodeGroupOutput', name: 'Group Output', location: [800, 0], properties: {}, inputs: [], outputs: [] },
      { id: 'sphere', bl_idname: 'GeometryNodeMeshUVSphere', name: 'UV Sphere', location: [-600, -150], properties: {}, inputs: [
        { identifier: 'Segments', name: 'Segments', socket_type: 'NodeSocketInt', default_value: 32 },
        { identifier: 'Rings', name: 'Rings', socket_type: 'NodeSocketInt', default_value: 16 },
        { identifier: 'Radius', name: 'Radius', socket_type: 'NodeSocketFloat', default_value: 1 },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
      { id: 'target', bl_idname: 'GeometryNodeMeshCube', name: 'Target Cube', location: [-600, 200], properties: {}, inputs: [
        { identifier: 'Size', name: 'Size', socket_type: 'NodeSocketVector', default_value: [0.5, 0.5, 0.5] },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
      { id: 'sampleNear', bl_idname: 'GeometryNodeSampleNearest', name: 'Sample Nearest', location: [50, 0], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Sample Position', name: 'Sample Position', socket_type: 'NodeSocketVector' },
      ], outputs: [{ identifier: 'Index', name: 'Index', socket_type: 'NodeSocketInt' }] },
      { id: 'sampleIdx', bl_idname: 'GeometryNodeSampleIndex', name: 'Sample Index', location: [300, 0], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Value', name: 'Value', socket_type: 'NodeSocketFloat' },
        { identifier: 'Index', name: 'Index', socket_type: 'NodeSocketInt' },
      ], outputs: [{ identifier: 'Value', name: 'Value', socket_type: 'NodeSocketFloat' }] },
      { id: 'pos', bl_idname: 'GeometryNodeInputPosition', name: 'Position', location: [-200, 50], properties: {}, inputs: [], outputs: [
        { identifier: 'Position', name: 'Position', socket_type: 'NodeSocketVector' },
      ]},
      { id: 'join', bl_idname: 'GeometryNodeJoinGeometry', name: 'Join', location: [600, 0], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
    ],
    links: [
      { from_node: 'sphere', from_socket: 'Geometry', to_node: 'sampleNear', to_socket: 'Geometry' },
      { from_node: 'pos', from_socket: 'Position', to_node: 'sampleNear', to_socket: 'Sample Position' },
      { from_node: 'sampleNear', from_socket: 'Index', to_node: 'sampleIdx', to_socket: 'Index' },
      { from_node: 'sphere', from_socket: 'Geometry', to_node: 'sampleIdx', to_socket: 'Geometry' },
      { from_node: 'sphere', from_socket: 'Geometry', to_node: 'join', to_socket: 'Geometry' },
      { from_node: 'target', from_socket: 'Geometry', to_node: 'join', to_socket: 'Geometry' },
      { from_node: 'join', from_socket: 'Geometry', to_node: 'gout', to_socket: 'Geometry' },
    ],
  }],
};

export const STRING_TO_CURVES: BngDocumentT = {
  schema: 'BNG/1', blender_version: '4.2.0',
  trees: [{
    id: 'text_mograph', bl_idname: 'GeometryNodeTree', name: 'String to Curves Motion Graphics',
    interface: { items: [
      { kind: 'socket', in_out: 'OUTPUT', socket_type: 'NodeSocketGeometry', name: 'Geometry', identifier: 'Geometry' },
    ]},
    nodes: [
      { id: 'gout', bl_idname: 'NodeGroupOutput', name: 'Group Output', location: [800, 0], properties: {}, inputs: [], outputs: [] },
      { id: 'stc', bl_idname: 'GeometryNodeStringToCurves', name: 'String to Curves', location: [-350, 0], properties: {}, inputs: [
        { identifier: 'String', name: 'String', socket_type: 'NodeSocketString', default_value: 'BLENDER' },
        { identifier: 'Size', name: 'Size', socket_type: 'NodeSocketFloat', default_value: 1 },
        { identifier: 'Character Spacing', name: 'Character Spacing', socket_type: 'NodeSocketFloat', default_value: 1 },
      ], outputs: [{ identifier: 'Curve Instances', name: 'Curve Instances', socket_type: 'NodeSocketGeometry' }] },
      { id: 'realize', bl_idname: 'GeometryNodeRealizeInstances', name: 'Realize', location: [-150, 0], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
      { id: 'fill', bl_idname: 'GeometryNodeFillCurve', name: 'Fill Curve', location: [100, 0], properties: {}, inputs: [
        { identifier: 'Curve', name: 'Curve', socket_type: 'NodeSocketGeometry' },
      ], outputs: [{ identifier: 'Mesh', name: 'Mesh', socket_type: 'NodeSocketGeometry' }] },
      { id: 'extrude', bl_idname: 'GeometryNodeExtrudeMesh', name: 'Extrude', location: [350, 0], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
      { id: 'setMat', bl_idname: 'GeometryNodeSetMaterial', name: 'Set Material', location: [600, 0], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
    ],
    links: [
      { from_node: 'stc', from_socket: 'Curve Instances', to_node: 'realize', to_socket: 'Geometry' },
      { from_node: 'realize', from_socket: 'Geometry', to_node: 'fill', to_socket: 'Curve' },
      { from_node: 'fill', from_socket: 'Mesh', to_node: 'extrude', to_socket: 'Geometry' },
      { from_node: 'extrude', from_socket: 'Geometry', to_node: 'setMat', to_socket: 'Geometry' },
      { from_node: 'setMat', from_socket: 'Geometry', to_node: 'gout', to_socket: 'Geometry' },
    ],
  }],
};

export const SMOKE_2D: BngDocumentT = {
  schema: 'BNG/1', blender_version: '3.6.0',
  trees: [{
    id: 'smoke_sim', bl_idname: 'GeometryNodeTree', name: '2D Smoke Puff',
    interface: { items: [
      { kind: 'socket', in_out: 'OUTPUT', socket_type: 'NodeSocketGeometry', name: 'Geometry', identifier: 'Geometry' },
    ]},
    nodes: [
      { id: 'gout', bl_idname: 'NodeGroupOutput', name: 'Group Output', location: [700, 0], properties: {}, inputs: [], outputs: [] },
      { id: 'grid', bl_idname: 'GeometryNodeMeshGrid', name: 'Grid', location: [-600, 0], properties: {}, inputs: [
        { identifier: 'Size X', name: 'Size X', socket_type: 'NodeSocketFloat', default_value: 4 },
        { identifier: 'Size Y', name: 'Size Y', socket_type: 'NodeSocketFloat', default_value: 4 },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
      { id: 's_in', bl_idname: 'GeometryNodeSimulationInput', name: 'Sim Input', location: [-300, 0], properties: {}, inputs: [], outputs: [], state_items: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Velocity', name: 'Velocity', socket_type: 'NodeSocketVector' },
      ]},
      { id: 's_out', bl_idname: 'GeometryNodeSimulationOutput', name: 'Sim Output', location: [500, 0], properties: {}, inputs: [], outputs: [], state_items: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Velocity', name: 'Velocity', socket_type: 'NodeSocketVector' },
      ]},
      { id: 'pos', bl_idname: 'GeometryNodeInputPosition', name: 'Position', location: [0, 100], properties: {}, inputs: [], outputs: [
        { identifier: 'Position', name: 'Position', socket_type: 'NodeSocketVector' },
      ]},
      { id: 'addVec', bl_idname: 'VectorMathNode', name: 'Add Vector', location: [200, 100], properties: { operation: 'ADD' }, inputs: [
        { identifier: 'A', name: 'A', socket_type: 'NodeSocketVector' },
        { identifier: 'B', name: 'B', socket_type: 'NodeSocketVector', default_value: [0, 0, 0.01] },
      ], outputs: [{ identifier: 'Vector', name: 'Vector', socket_type: 'NodeSocketVector' }] },
      { id: 'setPos', bl_idname: 'GeometryNodeSetPosition', name: 'Set Position', location: [300, 0], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Offset', name: 'Offset', socket_type: 'NodeSocketVector' },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
    ],
    links: [
      { from_node: 'grid', from_socket: 'Geometry', to_node: 's_in', to_socket: 'in_Geometry' },
      { from_node: 'pos', from_socket: 'Position', to_node: 'addVec', to_socket: 'A' },
      { from_node: 'addVec', from_socket: 'Vector', to_node: 'setPos', to_socket: 'Offset' },
      { from_node: 's_out', from_socket: 'Geometry', to_node: 'gout', to_socket: 'Geometry' },
    ],
  }],
};

export const GIZMO_ARRAY: BngDocumentT = {
  schema: 'BNG/1', blender_version: '4.1.0',
  trees: [{
    id: 'gizmo_arr', bl_idname: 'GeometryNodeTree', name: 'Gizmo Array',
    interface: { items: [
      { kind: 'socket', in_out: 'OUTPUT', socket_type: 'NodeSocketGeometry', name: 'Geometry', identifier: 'Geometry' },
    ]},
    nodes: [
      { id: 'gout', bl_idname: 'NodeGroupOutput', name: 'Group Output', location: [800, 0], properties: {}, inputs: [], outputs: [] },
      { id: 'line', bl_idname: 'GeometryNodeMeshLine', name: 'Mesh Line', location: [-400, 100], properties: {}, inputs: [
        { identifier: 'Count', name: 'Count', socket_type: 'NodeSocketInt', default_value: 5 },
        { identifier: 'Start Location', name: 'Start Location', socket_type: 'NodeSocketVector', default_value: [0, 0, 0] },
        { identifier: 'Offset', name: 'Offset', socket_type: 'NodeSocketVector', default_value: [1.5, 0, 0] },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
      { id: 'cube', bl_idname: 'GeometryNodeMeshCube', name: 'Cube', location: [-400, 300], properties: {}, inputs: [
        { identifier: 'Size', name: 'Size', socket_type: 'NodeSocketVector', default_value: [1, 1, 1] },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
      { id: 'inst', bl_idname: 'GeometryNodeInstanceOnPoints', name: 'Instance on Points', location: [100, 200], properties: {}, inputs: [
        { identifier: 'Points', name: 'Points', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Instance', name: 'Instance', socket_type: 'NodeSocketGeometry' },
      ], outputs: [{ identifier: 'Instances', name: 'Instances', socket_type: 'NodeSocketGeometry' }] },
      { id: 'realize', bl_idname: 'GeometryNodeRealizeInstances', name: 'Realize', location: [400, 200], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
      { id: 'pos', bl_idname: 'GeometryNodeInputPosition', name: 'Position', location: [-200, -150], properties: {}, inputs: [], outputs: [
        { identifier: 'Position', name: 'Position', socket_type: 'NodeSocketVector' },
      ]},
      { id: 'sep', bl_idname: 'SeparateXYZNode', name: 'Separate XYZ', location: [0, -150], properties: {}, inputs: [
        { identifier: 'Vector', name: 'Vector', socket_type: 'NodeSocketVector' },
      ], outputs: [
        { identifier: 'X', name: 'X', socket_type: 'NodeSocketFloat' },
      ]},
      { id: 'sin', bl_idname: 'ShaderNodeMath', name: 'Sine', location: [200, -100], properties: { operation: 'SINE' }, inputs: [
        { identifier: 'A', name: 'A', socket_type: 'NodeSocketFloat' },
      ], outputs: [{ identifier: 'Value', name: 'Value', socket_type: 'NodeSocketFloat' }] },
      { id: 'comb', bl_idname: 'CombineXYZNode', name: 'Combine', location: [400, -50], properties: {}, inputs: [
        { identifier: 'X', name: 'X', socket_type: 'NodeSocketFloat', default_value: 0 },
        { identifier: 'Y', name: 'Y', socket_type: 'NodeSocketFloat', default_value: 0 },
        { identifier: 'Z', name: 'Z', socket_type: 'NodeSocketFloat' },
      ], outputs: [{ identifier: 'Vector', name: 'Vector', socket_type: 'NodeSocketVector' }] },
      { id: 'setPos', bl_idname: 'GeometryNodeSetPosition', name: 'Set Position', location: [600, 200], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Offset', name: 'Offset', socket_type: 'NodeSocketVector' },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
    ],
    links: [
      { from_node: 'line', from_socket: 'Geometry', to_node: 'inst', to_socket: 'Points' },
      { from_node: 'cube', from_socket: 'Geometry', to_node: 'inst', to_socket: 'Instance' },
      { from_node: 'inst', from_socket: 'Instances', to_node: 'realize', to_socket: 'Geometry' },
      { from_node: 'pos', from_socket: 'Position', to_node: 'sep', to_socket: 'Vector' },
      { from_node: 'sep', from_socket: 'X', to_node: 'sin', to_socket: 'A' },
      { from_node: 'sin', from_socket: 'Value', to_node: 'comb', to_socket: 'Z' },
      { from_node: 'comb', from_socket: 'Vector', to_node: 'setPos', to_socket: 'Offset' },
      { from_node: 'realize', from_socket: 'Geometry', to_node: 'setPos', to_socket: 'Geometry' },
      { from_node: 'setPos', from_socket: 'Geometry', to_node: 'gout', to_socket: 'Geometry' },
    ],
  }],
};

export const MESH_FRACTURING: BngDocumentT = {
  schema: 'BNG/1', blender_version: '3.6.0',
  trees: [{
    id: 'fracture_sim', bl_idname: 'GeometryNodeTree', name: 'Mesh Fracturing',
    interface: { items: [
      { kind: 'socket', in_out: 'OUTPUT', socket_type: 'NodeSocketGeometry', name: 'Geometry', identifier: 'Geometry' },
    ]},
    nodes: [
      { id: 'gout', bl_idname: 'NodeGroupOutput', name: 'Group Output', location: [800, 0], properties: {}, inputs: [], outputs: [] },
      { id: 'cube', bl_idname: 'GeometryNodeMeshCube', name: 'Cube', location: [-700, 0], properties: {}, inputs: [
        { identifier: 'Size', name: 'Size', socket_type: 'NodeSocketVector', default_value: [2, 2, 2] },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
      { id: 'dist', bl_idname: 'GeometryNodeDistributePointsOnFaces', name: 'Distribute', location: [-500, 0], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Density', name: 'Density', socket_type: 'NodeSocketFloat', default_value: 50 },
      ], outputs: [{ identifier: 'Points', name: 'Points', socket_type: 'NodeSocketGeometry' }] },
      { id: 's_in', bl_idname: 'GeometryNodeSimulationInput', name: 'Sim Input', location: [-250, 0], properties: {}, inputs: [], outputs: [], state_items: [
        { identifier: 'Points', name: 'Points', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Fracture', name: 'Fracture', socket_type: 'NodeSocketFloat' },
      ]},
      { id: 's_out', bl_idname: 'GeometryNodeSimulationOutput', name: 'Sim Output', location: [500, 0], properties: {}, inputs: [], outputs: [], state_items: [
        { identifier: 'Points', name: 'Points', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Fracture', name: 'Fracture', socket_type: 'NodeSocketFloat' },
      ]},
      { id: 'rand', bl_idname: 'RandomValueNode', name: 'Random', location: [0, 250], properties: {}, inputs: [
        { identifier: 'Min', name: 'Min', socket_type: 'NodeSocketFloat', default_value: -0.1 },
        { identifier: 'Max', name: 'Max', socket_type: 'NodeSocketFloat', default_value: 0.1 },
      ], outputs: [{ identifier: 'Value', name: 'Value', socket_type: 'NodeSocketFloat' }] },
      { id: 'comb', bl_idname: 'CombineXYZNode', name: 'Combine', location: [200, 200], properties: {}, inputs: [
        { identifier: 'X', name: 'X', socket_type: 'NodeSocketFloat' },
        { identifier: 'Y', name: 'Y', socket_type: 'NodeSocketFloat' },
        { identifier: 'Z', name: 'Z', socket_type: 'NodeSocketFloat' },
      ], outputs: [{ identifier: 'Vector', name: 'Vector', socket_type: 'NodeSocketVector' }] },
      { id: 'setPos', bl_idname: 'GeometryNodeSetPosition', name: 'Set Position', location: [300, 0], properties: {}, inputs: [
        { identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' },
        { identifier: 'Offset', name: 'Offset', socket_type: 'NodeSocketVector' },
      ], outputs: [{ identifier: 'Geometry', name: 'Geometry', socket_type: 'NodeSocketGeometry' }] },
    ],
    links: [
      { from_node: 'cube', from_socket: 'Geometry', to_node: 'dist', to_socket: 'Geometry' },
      { from_node: 'dist', from_socket: 'Points', to_node: 's_in', to_socket: 'in_Points' },
      { from_node: 'rand', from_socket: 'Value', to_node: 'comb', to_socket: 'X' },
      { from_node: 'rand', from_socket: 'Value', to_node: 'comb', to_socket: 'Y' },
      { from_node: 'rand', from_socket: 'Value', to_node: 'comb', to_socket: 'Z' },
      { from_node: 'comb', from_socket: 'Vector', to_node: 'setPos', to_socket: 'Offset' },
      { from_node: 's_out', from_socket: 'Points', to_node: 'gout', to_socket: 'Geometry' },
    ],
  }],
};

export const ALL_FIXTURES = [
  { name: 'Repeat Zone Flower', source: 'repeat_zone_flower_by_MiRA.blend', doc: REPEAT_ZONE_FLOWER, tags: ['repeat_zone', 'instance', 'curve'] },
  { name: 'String to Curves', source: 'string_to_curves_motion_graphics_text.blend', doc: STRING_TO_CURVES, tags: ['string_to_curves', 'fill', 'extrude'] },
  { name: 'Gizmo Array', source: 'gizmo_array.blend', doc: GIZMO_ARRAY, tags: ['gizmo', 'array', 'instance'] },
  { name: 'Hexgrid', source: 'hexgrid_blender_geometry_nodes_demo.blend', doc: HEXGRID, tags: ['dual_mesh', 'subdivision', 'shader'] },
  { name: 'Jiggly Pudding', source: 'jiggly_pudding.blend', doc: JIGGLY_PUDDING, tags: ['simulation'] },
  { name: 'Mesh Fracturing', source: 'mesh_fracturing.blend', doc: MESH_FRACTURING, tags: ['simulation', 'random'] },
  { name: '2D Smoke Simulation', source: '2D_smoke_simulation.blend', doc: SMOKE_2D, tags: ['simulation', 'grid'] },
  { name: 'Index of Nearest', source: 'index_of_nearest.blend', doc: INDEX_OF_NEAREST, tags: ['sample_nearest', 'sample_index'] },
  { name: 'Pebble Scattering', source: 'pebble_scattering.blend', doc: PEBBLE_SCATTERING, tags: ['distribute', 'instance', 'terrain'] },
] as const;
