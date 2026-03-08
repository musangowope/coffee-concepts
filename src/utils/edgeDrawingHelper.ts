import * as THREE from 'three'
import gsap from 'gsap'

export interface CollectMeshesOptions {
  excludeNames?: string[]
  /** Exclude any mesh that is a descendant of (or is) one of these objects. More robust than name matching. */
  excludeObjects?: THREE.Object3D[]
}

export interface EdgeDrawingOptions {
  edgeColor?: number
  edgeThreshold?: number
  duration?: number
  staggerDelay?: number
  ease?: string
  revealSolid?: boolean
  solidFadeDuration?: number
  /** Delay before edge drawing starts (reduces camera glitch). */
  startDelay?: number
  /** Meshes to process per frame (0 = all at once). Chunked setup avoids blocking the camera. */
  setupChunkSize?: number
}

const EDGE_VERTEX_SHADER = `
  attribute float lineProgress;
  varying float vLineProgress;
  void main() {
    vLineProgress = lineProgress;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const EDGE_FRAGMENT_SHADER = `
  uniform float uReveal;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying float vLineProgress;
  void main() {
    if (vLineProgress > uReveal) discard;
    gl_FragColor = vec4(uColor, uOpacity);
  }
`

/** Builds edge geometry with a lineProgress attribute (0..1 along total length) for progressive draw. */
function createEdgesGeometryWithProgress(
  meshGeometry: THREE.BufferGeometry,
  edgeThreshold: number
): THREE.BufferGeometry {
  const edgesGeometry = new THREE.EdgesGeometry(meshGeometry.clone(), edgeThreshold)
  const pos = edgesGeometry.getAttribute('position')
  const count = pos.count
  const segmentCount = count / 2
  const progress = new Float32Array(count)

  let totalLength = 0
  const v = new THREE.Vector3()
  const lengths: number[] = []
  for (let i = 0; i < segmentCount; i++) {
    v.fromBufferAttribute(pos, 2 * i)
    const a = v.clone()
    v.fromBufferAttribute(pos, 2 * i + 1)
    const len = a.distanceTo(v)
    lengths.push(len)
    totalLength += len
  }

  let cumulative = 0
  for (let i = 0; i < segmentCount; i++) {
    const len = lengths[i]
    const startProgress = totalLength > 0 ? cumulative / totalLength : 0
    const endProgress = totalLength > 0 ? (cumulative + len) / totalLength : 1
    progress[2 * i] = startProgress
    progress[2 * i + 1] = endProgress
    cumulative += len
  }

  edgesGeometry.setAttribute('lineProgress', new THREE.BufferAttribute(progress, 1))
  return edgesGeometry
}

function isDescendantOf(obj: THREE.Object3D, ancestors: THREE.Object3D[]): boolean {
  let current: THREE.Object3D | null = obj
  while (current) {
    if (ancestors.includes(current)) return true
    current = current.parent
  }
  return false
}

/**
 * Collects all Mesh objects from a scene (or group), optionally excluding by name or by object hierarchy.
 */
export function collectMeshesFromScene(
  root: THREE.Object3D,
  options: CollectMeshesOptions = {}
): THREE.Mesh[] {
  const { excludeNames = [], excludeObjects = [] } = options
  const nameSet = new Set(excludeNames)
  const meshes: THREE.Mesh[] = []

  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      if (nameSet.has(object.name)) return
      if (excludeObjects.length && isDescendantOf(object, excludeObjects)) return
      meshes.push(object)
    }
  })

  return meshes
}

interface EdgeLineMaterialUniforms {
  uReveal: { value: number }
  uOpacity: { value: number }
  uColor: { value: THREE.Color }
}

/**
 * Creates edge line segments for a mesh with shader-based progressive draw.
 * Caller is responsible for adding the line to the scene.
 */
export function createEdgeLinesForMesh(
  mesh: THREE.Mesh,
  options: { edgeColor?: number; edgeThreshold?: number } = {}
): THREE.LineSegments {
  const { edgeColor = 0x333333, edgeThreshold = 15 } = options

  const edgesGeometry = createEdgesGeometryWithProgress(mesh.geometry, edgeThreshold)
  const color = new THREE.Color(edgeColor)
  const uniforms = {
    uReveal: { value: 0 },
    uOpacity: { value: 1 },
    uColor: { value: color },
  }
  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as THREE.ShaderMaterial['uniforms'],
    vertexShader: EDGE_VERTEX_SHADER,
    fragmentShader: EDGE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  })

  const lineSegments = new THREE.LineSegments(edgesGeometry, material)
  lineSegments.position.copy(mesh.position)
  lineSegments.quaternion.copy(mesh.quaternion)
  lineSegments.scale.copy(mesh.scale)
  lineSegments.name = `edges-${mesh.name}`

  return lineSegments
}

function addDrawingTweens(
  timeline: gsap.core.Timeline,
  meshes: THREE.Mesh[],
  lineSegmentsByMesh: Map<THREE.Mesh, THREE.LineSegments>,
  totalDrawTime: number,
  options: {
    duration: number
    staggerDelay: number
    ease: string
    startDelay: number
    revealSolid: boolean
    solidFadeDuration: number
  }
): void {
  const { duration, staggerDelay, ease, startDelay, revealSolid, solidFadeDuration } = options
  const progress = { value: 0 }
  timeline.to(
    progress,
    {
      value: 1,
      duration: totalDrawTime,
      ease,
      delay: startDelay,
      onUpdate: () => {
        const t = progress.value * totalDrawTime
        meshes.forEach((mesh, index) => {
          const lineSegments = lineSegmentsByMesh.get(mesh)!
          const mat = lineSegments.material as THREE.ShaderMaterial
          const uniforms = mat.uniforms as unknown as EdgeLineMaterialUniforms
          const start = index * staggerDelay
          const localProgress = Math.max(0, Math.min(1, (t - start) / duration))
          uniforms.uReveal.value = localProgress
        })
      },
    },
    0
  )
  if (revealSolid) {
    timeline.add(
      () => {
        meshes.forEach((mesh) => {
          const lineSegments = lineSegmentsByMesh.get(mesh)!
          const mat = lineSegments.material as THREE.ShaderMaterial
          const uniforms = mat.uniforms as unknown as EdgeLineMaterialUniforms
          mesh.visible = true
          const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          meshMaterials.forEach((m) => {
            const std = m as THREE.MeshStandardMaterial
            if (std && std.opacity !== undefined) {
              gsap.to(std, {
                opacity: 1,
                duration: solidFadeDuration,
                ease: 'power2.out',
              })
            }
          })
          gsap.to(uniforms.uOpacity, {
            value: 0,
            duration: solidFadeDuration,
            ease: 'power2.in',
            onComplete: () => {
              lineSegments.removeFromParent()
              lineSegments.geometry.dispose()
              mat.dispose()
            },
          })
        })
      },
      startDelay + totalDrawTime
    )
  }
}

/**
 * Runs the drawing animation: edge lines are drawn progressively along their length (shader uReveal), then solid mesh is revealed.
 * Setup can be chunked across frames to avoid blocking the camera.
 */
export function animateEdgeDrawing(
  meshes: THREE.Mesh[],
  options: EdgeDrawingOptions = {}
): gsap.core.Timeline {
  const {
    edgeColor = 0x333333,
    edgeThreshold = 15,
    duration = 0.8,
    staggerDelay = 0.06,
    ease = 'power2.out',
    revealSolid = true,
    solidFadeDuration = 0.4,
    startDelay = 0,
    setupChunkSize = 3,
  } = options

  const timeline = gsap.timeline()
  const lineSegmentsByMesh = new Map<THREE.Mesh, THREE.LineSegments>()
  const totalDrawTime = meshes.length * staggerDelay + duration

  function processMesh(mesh: THREE.Mesh): void {
    const lineSegments = createEdgeLinesForMesh(mesh, { edgeColor, edgeThreshold })
    if (mesh.parent) mesh.parent.add(lineSegments)
    lineSegmentsByMesh.set(mesh, lineSegments)
    mesh.visible = false
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    meshMaterials.forEach((mat) => {
      const m = mat as THREE.MeshStandardMaterial
      if (m && m.opacity !== undefined) {
        m.transparent = true
        m.opacity = 0
      }
    })
  }

  function onSetupComplete(): void {
    addDrawingTweens(timeline, meshes, lineSegmentsByMesh, totalDrawTime, {
      duration,
      staggerDelay,
      ease,
      startDelay,
      revealSolid,
      solidFadeDuration,
    })
  }

  if (setupChunkSize <= 0 || meshes.length <= setupChunkSize) {
    meshes.forEach(processMesh)
    onSetupComplete()
    return timeline
  }

  let index = 0
  function doChunk(): void {
    const end = Math.min(index + setupChunkSize, meshes.length)
    for (let i = index; i < end; i++) processMesh(meshes[i])
    index = end
    if (index < meshes.length) {
      requestAnimationFrame(doChunk)
    } else {
      onSetupComplete()
    }
  }
  requestAnimationFrame(doChunk)

  return timeline
}
