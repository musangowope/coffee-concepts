import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import * as THREE from 'three'
import { Color, DataTexture, Mesh, PCFSoftShadowMap, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { RGBELoader } from 'three/examples/jsm/Addons.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { injectAnimatedSVG } from './utils/animationHelper'

/***
 * 
 * absolute position of rendering
 * pages will be on top
 * on scroll to each page, camera will 
 */

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
   camera.position.set(0, 2, 5);
   camera.lookAt(0, 0, 0);
   
  // Renderer setup
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  document.body.appendChild(renderer.domElement);

  // CSS2D Renderer setup for SVG overlay
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  document.body.appendChild(labelRenderer.domElement);
  
   
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
  
  // Orbit controls - will be updated when panningCamera loads
  let controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 0, 0);
  
  const gltf = await loadModel('/models/coffee-interaction-new.glb')

  // Get character meshes from the model
  const originalGirl = gltf.scene.getObjectByName('coffee-interaction-one-girl') as Mesh
  const originalGuy = gltf.scene.getObjectByName('coffee-interaction-one-guy') as Mesh
  
  scene.add(gltf.scene)

  // Inject animated SVGs for characters
  await injectAnimatedSVG('/svgs/coffee-interaction-one-girl.svg', originalGirl, scene, {
    delay: 0,
    strokeDuration: 0.85,
    staggerDelay: 0.02,
    ease: 'power2.out',
    pixelScale: 400
  })

  await injectAnimatedSVG('/svgs/coffee-interaction-one-guy.svg', originalGuy, scene, {
    delay: 0.5,
    strokeDuration: 0.85,
    staggerDelay: 0.02,
    ease: 'power2.out',
    pixelScale: 1000
  })

  // Use first camera from the GLTF, if present
  if (gltf.cameras && gltf.cameras.length > 0) {
    panningCamera = gltf.cameras[0] as PerspectiveCamera

    // Match aspect ratio and projection to the main viewport
    panningCamera.aspect = window.innerWidth / window.innerHeight
    panningCamera.updateProjectionMatrix()


    const targetMesh = scene.getObjectByName('Lamp')
    const targetPosition = new Vector3();
    targetMesh?.getWorldPosition(targetPosition);
    

    // Update controls to use panningCamera
    controls.dispose();
    controls = new OrbitControls(panningCamera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Start at top-right, then animate to current view over 2s
    panningCamera.position.set(6.860931918015912, 2.0749506072477795, 1.1721779560488745);
    controls.target.set(-0.13345254686968805, 0.8917313135270899, 1.268141442661222);

    animateCameraToPosition(
      panningCamera,
      controls,
      { x: 4.357924909446508, y: 1.2261918584490348, z: -0.18343955417343433 },
      { x: -0.08205130591604112, y: 0.47509423891549646, z: -0.12252274294563543 },
      5
    );

    // Helpful for debugging in DevTools
    ;(window as any).panningCamera = panningCamera
    console.log('Loaded panningCamera from GLTF:', panningCamera)
  }

  // Expose tracked camera position (updated every frame) for scroll/UI or DevTools
  ;(window as any).cameraPositionTracked = cameraPositionTracked
   
  //  // Grid helper
  //  const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
  //  scene.add(gridHelper);
   
  //  // Axes helper
  //  const axesHelper = new THREE.AxesHelper(5);
  //  scene.add(axesHelper);
   
   // Handle window resize
   window.addEventListener('resize', () => {
       const activeCamera = panningCamera ?? camera;
       activeCamera.aspect = window.innerWidth / window.innerHeight;
       activeCamera.updateProjectionMatrix();
       renderer.setSize(window.innerWidth, window.innerHeight);
       labelRenderer.setSize(window.innerWidth, window.innerHeight);
       controls.update();
   });
   
  // Animation loop
  let frameCount = 0;
  function animate() {
      requestAnimationFrame(animate);
      
      // Animate point light position
      const time = Date.now() * 0.001;
      pointLight.position.x = Math.sin(time) * 5;
      pointLight.position.z = Math.cos(time) * 5;
      
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
        console.log('cameraPositionTracked', { ...cameraPositionTracked });
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
