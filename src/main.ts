import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import * as THREE from 'three'
import { Color, DataTexture, Mesh, PCFSoftShadowMap, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { RGBELoader } from 'three/examples/jsm/Addons.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { injectAnimatedSVG } from './utils/animationHelper'
import { collectMeshesFromScene, animateEdgeDrawing } from './utils/edgeDrawingHelper'
import { createScrollStateMachine } from './utils/scrollStateMachine'

// Register ScrollTrigger plugin with GSAP (required before using ScrollTrigger features)
gsap.registerPlugin(ScrollTrigger)

function loadModel(url: string): Promise<Parameters<Parameters<typeof GLTFLoader.prototype.load>[1]>[0]> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => {
        resolve(gltf)
      },
      undefined,
      (error) => {
        console.error('Error loading GLTF model:', error)
        reject(error)
      }
    )
  })
}

function loadHdri()  {
  return new Promise((resolve, reject) => {
    const rgbeLoader = new RGBELoader();
  rgbeLoader.load(
    '/hdr/cedar_bridge_sunset_1_4k.hdr',
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping
      resolve(texture) 
    },
    undefined,
    (error) => {
      console.error('Error loading HDR environment map:', error);
      reject(error)
    }
  );
  })
}

/**
 * Compute camera position and target to frame a group of objects.
 * Uses bounding box center as look-at target; positions camera at offset for a clear view.
 * Returns fallback if bounds are empty or invalid.
 */
function getCameraFrameForBounds(
  objects: THREE.Object3D[],
  distanceMultiplier: number = 2.5,
  fallback?: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }
): { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } {
  const box = new THREE.Box3()
  objects.filter(Boolean).forEach((obj) => box.expandByObject(obj))
  if (box.isEmpty()) {
    return fallback ?? {
      position: { x: 0, y: 2, z: 2 },
      target: { x: 0, y: 0, z: 0 },
    }
  }
  const center = new THREE.Vector3()
  box.getCenter(center)
  const size = new THREE.Vector3()
  box.getSize(size)
  const maxDim = Math.max(size.x, size.y, size.z, 0.1)
  const distance = Math.max(maxDim * distanceMultiplier, 1.5)
  // Position camera in front and slightly above (common viewing angle)
  const offset = new THREE.Vector3(0.5, 0.4, 1).normalize().multiplyScalar(distance)
  const position = center.clone().add(offset)
  const pos = { x: position.x, y: position.y, z: position.z }
  const tgt = { x: center.x, y: center.y, z: center.z }
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
    return fallback ?? { position: { x: 0, y: 2, z: 2 }, target: { x: 0, y: 0, z: 0 } }
  }
  return { position: pos, target: tgt }
}

function animateCameraToPosition(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  cameraPosition: { x: number; y: number; z: number },
  targetPosition: { x: number; y: number; z: number },
  duration: number = 1.5
) {
  // Animate camera to the specified position
  gsap.to(camera.position, {
    x: cameraPosition.x,
    y: cameraPosition.y,
    z: cameraPosition.z,
    duration,
    ease: "power3.inOut",
  });
  
  // Animate controls to look at the specified target
  gsap.to(controls.target, {
    x: targetPosition.x,
    y: targetPosition.y,
    z: targetPosition.z,
    duration,
    ease: "power3.inOut",
    onUpdate: () => {
      controls.update();
    }
  });
}

/** Remove edge-drawing LineSegments from a root object (for cleanup on section leave). */
function removeEdgeLineSegments(root: THREE.Object3D) {
  const toRemove: THREE.Object3D[] = []
  root.traverse((obj) => {
    if (obj instanceof THREE.LineSegments && obj.name.startsWith('edges-')) {
      toRemove.push(obj)
    }
  })
  toRemove.forEach((obj) => {
    if (obj.parent) obj.parent.remove(obj)
    if (obj instanceof THREE.LineSegments) {
      obj.geometry?.dispose()
      ;(obj.material as THREE.Material)?.dispose()
    }
  })
}

async function init() {
   // Scene setup
   const scene = new Scene();
   scene.background = new Color(0xffffff);
   
   // Camera setup
   const camera = new PerspectiveCamera(
       75, // Field of view
       window.innerWidth / window.innerHeight, // Aspect ratio
       0.1, // Near clipping plane
       1000 // Far clipping plane
   );
   camera.position.set(5.357228497131374, 2.436162250553856, 2.363640289202176);
   camera.lookAt(-0.16691434991137194, 0.1807196080658024, 0.4737018424073966);
   
  // Renderer setup
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const canvasContainer = document.getElementById('canvas-container')!
  canvasContainer.appendChild(renderer.domElement);

  // CSS2D Renderer setup for SVG overlay
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  canvasContainer.appendChild(labelRenderer.domElement);
  
   
   // Lighting
   // Ambient light for overall illumination
   const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
   scene.add(ambientLight);
   
   // Directional light with shadows
   const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
   directionalLight.position.set(5, 10, 5);
   directionalLight.castShadow = true;
   directionalLight.shadow.camera.left = -10;
   directionalLight.shadow.camera.right = 10;
   directionalLight.shadow.camera.top = 10;
   directionalLight.shadow.camera.bottom = -10;
   scene.add(directionalLight);
   
   // Point light for extra drama
   const pointLight = new THREE.PointLight(0x4488ff, 0.5);
   pointLight.position.set(-5, 3, -5);
   scene.add(pointLight);
   
   // Load HDR environment map
   const hdriTexture = await loadHdri() as DataTexture
   scene.environment = hdriTexture;

     
  // Geometries and Meshes

  // Camera embedded in the GLTF (if any)
  let panningCamera: PerspectiveCamera | undefined;

  // Tracked panning camera position (updated every frame)
  const cameraPositionTracked = {
    position: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
  };
  
  // Orbit controls - will be updated when panningCamera loads (disabled to allow scroll)
  let controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enabled = false; // Disable to prevent interfering with scroll
  controls.target.set(-0.16691434991137194, 0.1807196080658024, 0.4737018424073966);
  
  const gltf = await loadModel('/models/coffee-interaction copy.glb')

  // Get character meshes from the model
  const originalGirl = gltf.scene.getObjectByName('coffee-interaction-one-girl') as Mesh
  const originalGuy = gltf.scene.getObjectByName('coffee-interaction-one-guy') as Mesh
  

  // Bean bang area objects
  const beanBangAreaObjects = {
    lamp: gltf.scene.getObjectByName('Beanbag_Area_Lamp'),
    beanBagOne: gltf.scene.getObjectByName('Beanbag_Area_Bag_One'),
    beanBagTwo: gltf.scene.getObjectByName('Beanbag_Area_Bag_Two'),
  }


  // Hide bean bang area objects initially (Section 2 will draw them)
  Object.values(beanBangAreaObjects).forEach((obj) => {
    if (obj) {
      obj.traverse((child) => {
        if (child instanceof Mesh) (child as Mesh).visible = false
      })
      obj.visible = false
    }
  })

  scene.add(gltf.scene)

  // Section 1 meshes: all except characters and beanBag area
  const meshesToDraw = collectMeshesFromScene(gltf.scene, {
    excludeNames: ['coffee-interaction-one-girl', 'coffee-interaction-one-guy'],
    excludeObjects: Object.values(beanBangAreaObjects).filter(Boolean) as THREE.Object3D[],
  })

  // BeanBag area meshes for Section 2 (collect meshes from each object)
  const beanBagMeshes = Object.values(beanBangAreaObjects)
    .filter(Boolean)
    .flatMap((obj) => collectMeshesFromScene(obj!, {})) as Mesh[]

  // Use first camera from the GLTF, if present
  if (gltf.cameras && gltf.cameras.length > 0) {
    panningCamera = gltf.cameras[0] as PerspectiveCamera

    // Match aspect ratio and projection to the main viewport
    panningCamera.aspect = window.innerWidth / window.innerHeight
    panningCamera.updateProjectionMatrix()

    // Update controls to use panningCamera
    controls.dispose()
    controls = new OrbitControls(panningCamera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.enabled = false // Disable to prevent interfering with scroll

    // Initial camera position and target
    panningCamera.position.set(5.357228497131374, 2.436162250553856, 2.363640289202176)
    controls.target.set(-0.16691434991137194, 0.1807196080658024, 0.4737018424073966)

    ;(window as any).panningCamera = panningCamera
  }

  const activeCamera = panningCamera ?? camera

  // Section configs for scroll state machine
  const section1CameraPos = { x: 4.357924909446508, y: 1.2261918584490348, z: -0.18343955417343433 }
  const section1CameraTarget = { x: -0.08205130591604112, y: 0.47509423891549646, z: -0.12252274294563543 }
  // Section 2: compute camera from beanbag area bounds
  scene.updateMatrixWorld(true)
  const beanBagObjects = Object.values(beanBangAreaObjects).filter(Boolean) as THREE.Object3D[]
  const section2Frame = getCameraFrameForBounds(beanBagObjects, 2.5, {
    position: section1CameraPos,
    target: section1CameraTarget,
  })


  let section1EdgeDrawingTimeline: gsap.core.Timeline | null = null
  let section2EdgeDrawingTimeline: gsap.core.Timeline | null = null
  const activeLabels: InstanceType<typeof CSS2DObject>[] = []

  const scrollWrapper = document.getElementById('scroll-wrapper')!
  const { refresh: refreshScrollState } = createScrollStateMachine({
    trigger: scrollWrapper,
    pinTarget: canvasContainer,
    sections: [
      { index: 1, scrollDuration: 5 },
      { index: 2, scrollDuration: 5 },
    ],
    onLeaveSection: (sectionIndex) => {
      const fadeDuration = 0.4
      if (sectionIndex === 1) {
        section1EdgeDrawingTimeline?.kill()
        section1EdgeDrawingTimeline = null
        removeEdgeLineSegments(gltf.scene)
        activeLabels.forEach((label) => {
          if (label.parent) label.parent.remove(label)
        })
        activeLabels.length = 0
        const section1Mats = meshesToDraw.flatMap((m) =>
          (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]
        ).filter((m) => m?.opacity !== undefined)
        const section1Placeholders = [originalGirl, originalGuy].filter(Boolean) as Mesh[]
        const section1PlaceholderMats = section1Placeholders.flatMap((p) =>
          p.material ? (Array.isArray(p.material) ? p.material : [p.material]) as THREE.MeshStandardMaterial[] : []
        ).filter((m) => m?.opacity !== undefined)
        const allSection1Mats = [...section1Mats, ...section1PlaceholderMats]
        if (allSection1Mats.length > 0) {
          allSection1Mats.forEach((m) => { m.transparent = true })
          gsap.to(allSection1Mats, {
            opacity: 0,
            duration: fadeDuration,
            ease: 'power2.in',
            onComplete: () => {
              meshesToDraw.forEach((m) => { m.visible = false })
              section1Placeholders.forEach((p) => { p.visible = false })
            },
          })
        } else {
          meshesToDraw.forEach((m) => { m.visible = false })
          section1Placeholders.forEach((p) => { p.visible = false })
        }
      } else if (sectionIndex === 2) {
        section2EdgeDrawingTimeline?.kill()
        section2EdgeDrawingTimeline = null
        removeEdgeLineSegments(gltf.scene)
        const section2Mats = beanBagMeshes.flatMap((m) =>
          (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]
        ).filter((m) => m?.opacity !== undefined)
        if (section2Mats.length > 0) {
          section2Mats.forEach((m) => { m.transparent = true })
          gsap.to(section2Mats, {
            opacity: 0,
            duration: fadeDuration,
            ease: 'power2.in',
            onComplete: () => {
              beanBagMeshes.forEach((m) => { m.visible = false })
              Object.values(beanBangAreaObjects).forEach((obj) => {
                if (obj) obj.visible = false
              })
            },
          })
        } else {
          beanBagMeshes.forEach((m) => { m.visible = false })
          Object.values(beanBangAreaObjects).forEach((obj) => {
            if (obj) obj.visible = false
          })
        }
      }
    },
    onEnterSection: (sectionIndex) => {
      if (sectionIndex === 1) {
        animateCameraToPosition(activeCamera, controls, section1CameraPos, section1CameraTarget, 2)
        scene.children.filter((c): c is InstanceType<typeof CSS2DObject> => c instanceof CSS2DObject).forEach((label) => {
          scene.remove(label)
        })
        originalGirl.visible = true
        originalGuy.visible = true
        if (originalGirl.material) {
          const mat = originalGirl.material as THREE.MeshStandardMaterial
          mat.transparent = true
          mat.opacity = 1
        }
        if (originalGuy.material) {
          const mat = originalGuy.material as THREE.MeshStandardMaterial
          mat.transparent = true
          mat.opacity = 1
        }
        meshesToDraw.forEach((mesh) => {
          mesh.visible = false
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          mats.forEach((m) => {
            const mat = m as THREE.MeshStandardMaterial
            if (mat?.opacity !== undefined) {
              mat.transparent = true
              mat.opacity = 0
            }
          })
        })
        Object.values(beanBangAreaObjects).forEach((obj) => {
          if (obj) obj.visible = false
        })
        if (meshesToDraw.length > 0) {
          section1EdgeDrawingTimeline = animateEdgeDrawing(meshesToDraw, {
            duration: 1.5,
            staggerDelay: 0.02,
            ease: 'power2.out',
            revealSolid: true,
            solidFadeDuration: 0.4,
            startDelay: 0.6,
            setupChunkSize: 3,
          })
        }
        injectAnimatedSVG('/svgs/coffee-interaction-one-girl.svg', originalGirl, scene, {
          delay: 0,
          strokeDuration: 0.85,
          staggerDelay: 0.02,
          ease: 'power2.out',
          pixelScale: 400,
          sizeScale: 2.5,
        }).then((label) => {
          if (label) activeLabels.push(label)
        })
        injectAnimatedSVG('/svgs/coffee-interaction-one-guy.svg', originalGuy, scene, {
          delay: 0.5,
          strokeDuration: 0.85,
          staggerDelay: 0.02,
          ease: 'power2.out',
          pixelScale: 1000,
          sizeScale: 1.75,
        }).then((label) => {
          if (label) activeLabels.push(label)
        })
      } else if (sectionIndex === 2) {
        animateCameraToPosition(activeCamera, controls, section2Frame.position, section2Frame.target, 2)
        Object.values(beanBangAreaObjects).forEach((obj) => {
          if (obj) obj.visible = true
        })
        beanBagMeshes.forEach((mesh) => {
          mesh.visible = false
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          mats.forEach((m) => {
            const mat = m as THREE.MeshStandardMaterial
            if (mat?.opacity !== undefined) {
              mat.transparent = true
              mat.opacity = 0
            }
          })
        })
        if (beanBagMeshes.length > 0) {
          section2EdgeDrawingTimeline = animateEdgeDrawing(beanBagMeshes, {
            duration: 1.5,
            staggerDelay: 0.02,
            ease: 'power2.out',
            revealSolid: true,
            solidFadeDuration: 0.4,
            startDelay: 0.3,
            setupChunkSize: 3,
          })
        }
      }
    },
  })

  // Expose tracked camera position (updated every frame) for scroll/UI or DevTools
  ;(window as any).cameraPositionTracked = cameraPositionTracked

  // Limited mouse-based camera rotation: offset look-at in Y and Z for subtle depth
  const MOUSE_PARALLAX_ENABLED = false
  const MOUSE_PARALLAX_LIMIT_Y = 0.15
  const MOUSE_PARALLAX_LIMIT_Z = 0.15
  const MOUSE_PARALLAX_LERP = 0.06
  let mouseNormX = 0
  let mouseNormY = 0
  const mouseOffset = new Vector3(0, 0, 0)
  const desiredOffset = new Vector3(0, 0, 0)
  const baseTarget = new Vector3(0, 0, 0)

  if (MOUSE_PARALLAX_ENABLED) {
    renderer.domElement.addEventListener('pointermove', (e: PointerEvent) => {
      mouseNormX = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1))
      mouseNormY = Math.max(-1, Math.min(1, 1 - (e.clientY / window.innerHeight) * 2))
    }, { passive: true })

    renderer.domElement.addEventListener('pointerleave', () => {
      mouseNormX = 0
      mouseNormY = 0
    })
  }
   
    
   // Handle window resize
   window.addEventListener('resize', () => {
       const activeCamera = panningCamera ?? camera;
       activeCamera.aspect = window.innerWidth / window.innerHeight;
       activeCamera.updateProjectionMatrix();
       renderer.setSize(window.innerWidth, window.innerHeight);
       labelRenderer.setSize(window.innerWidth, window.innerHeight);
       controls.update();
       refreshScrollState();
   });
   
  // Animation loop
  let frameCount = 0;
  function animate() {
      requestAnimationFrame(animate);
      
      // Animate point light position
      const time = Date.now() * 0.001;
      pointLight.position.x = Math.sin(time) * 5;
      pointLight.position.z = Math.cos(time) * 5;
      
      // Limited mouse parallax: recover base target, lerp offset, apply
      if (MOUSE_PARALLAX_ENABLED) {
        baseTarget.copy(controls.target).sub(mouseOffset)
        desiredOffset.set(0, mouseNormY * MOUSE_PARALLAX_LIMIT_Y, mouseNormX * MOUSE_PARALLAX_LIMIT_Z)
        mouseOffset.lerp(desiredOffset, MOUSE_PARALLAX_LERP)
        controls.target.copy(baseTarget).add(mouseOffset)
      }
      
      // Update orbit controls
      controls.update();

      // Determine active camera
      const activeCamera = panningCamera ?? camera;

      // Track panning camera position and target (for scroll/UI or debugging)
      cameraPositionTracked.position.x = activeCamera.position.x;
      cameraPositionTracked.position.y = activeCamera.position.y;
      cameraPositionTracked.position.z = activeCamera.position.z;
      cameraPositionTracked.target.x = controls.target.x;
      cameraPositionTracked.target.y = controls.target.y;
      cameraPositionTracked.target.z = controls.target.z;

      // Throttled console log (~1x per second) to avoid flooding
      frameCount++;
      if (frameCount % 60 === 0) {
        // console.log('cameraPositionTracked', { ...cameraPositionTracked });
      }
      
      // Render both WebGL and CSS2D scenes
      renderer.render(scene, activeCamera);
      labelRenderer.render(scene, activeCamera);
  }
  
  animate();
}

document.addEventListener('DOMContentLoaded', () => {
  init()
})
