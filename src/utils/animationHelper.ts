import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import gsap from 'gsap';

interface AnimationOptions {
  duration?: number;
  delay?: number;
  strokeDuration?: number;
  staggerDelay?: number;
  ease?: string;
  pixelScale?: number;
  /** Scale factor 0–1 to shrink SVG to fit within placeholder (default 1) */
  sizeScale?: number;
}

/**
 * Injects an animated SVG as a CSS2DObject positioned at a placeholder mesh
 * The SVG will be progressively drawn using stroke-dasharray animation,
 * then filled with color for a hand-drawn effect
 */
export async function injectAnimatedSVG(
  svgPath: string,
  placeholder: THREE.Mesh,
  scene: THREE.Scene,
  options: AnimationOptions = {}
): Promise<CSS2DObject | null> {
  const {
    delay = 0,
    strokeDuration = 0.85,
    staggerDelay = 0.02,
    ease = 'power2.out',
    pixelScale = 100,
    sizeScale = 1
  } = options;

  try {
    // Load SVG file
    const response = await fetch(svgPath);
    if (!response.ok) {
      throw new Error(`Failed to load SVG: ${response.statusText}`);
    }
    const svgText = await response.text();

    // Parse SVG
    const container = document.createElement('div');
    container.innerHTML = svgText;
    const svg = container.querySelector('svg');

    if (!svg) {
      console.error('No SVG element found in file:', svgPath);
      return null;
    }

    // Get dimensions from world-space bounding box so we match both PlaneGeometry
    // and BufferGeometry (GLTF meshes) and correctly account for all transforms
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(placeholder);
    const size = new THREE.Vector3();
    box.getSize(size);
    // Use two largest dimensions (smallest = thickness for flat planes)
    const [dim0, dim1] = [size.x, size.y, size.z].sort((a, b) => b - a).slice(0, 2);
    const geometryWidth = Math.max(dim0, 0.001);
    const geometryHeight = Math.max(dim1, 0.001);
    const w = geometryWidth * pixelScale * sizeScale;
    const h = geometryHeight * pixelScale * sizeScale;
    svg.setAttribute('width', `${w}px`);
    svg.setAttribute('height', `${h}px`);
    svg.style.display = 'block';

    // Create CSS2DObject - use world transform so it overlays correctly when placeholder is nested
    const label = new CSS2DObject(container);
    scene.updateMatrixWorld(true);
    placeholder.getWorldPosition(label.position);
    placeholder.getWorldQuaternion(label.quaternion);
    label.scale.set(1, 1, 1);

    scene.add(label);

    // Placeholder starts invisible
    placeholder.visible = false;
    if (placeholder.material) {
      const material = placeholder.material as THREE.MeshStandardMaterial;
      material.transparent = true;
      material.opacity = 0;
    }

    // Animate SVG paths
    const paths = svg.querySelectorAll('path');
    const tl = gsap.timeline({ delay });

    // Store path data for animation
    interface PathData {
      element: SVGPathElement;
      originalFill: string;
      originalFillOpacity: string;
      originalStroke: string | null;
      originalStrokeWidth: string;
    }

    const pathData: PathData[] = [];

    // Setup all paths for drawing animation
    paths.forEach((path) => {
      const pathElement = path as SVGPathElement;

      // Store original attributes
      const originalFill = pathElement.getAttribute('fill') || 'black';
      const originalFillOpacity = pathElement.getAttribute('fill-opacity') || '1';
      const originalStroke = pathElement.getAttribute('stroke');
      const originalStrokeWidth = pathElement.getAttribute('stroke-width') || '2';

      // Skip paths with no fill
      if (originalFill === 'none') return;

      // Get path length for stroke animation
      const pathLength = pathElement.getTotalLength();

      // Hide fill initially
      pathElement.setAttribute('fill', originalFill);
      pathElement.setAttribute('fill-opacity', '0');

      // Set up stroke for drawing effect - light grey pencil style.
      // Use inline style so it overrides the SVG paths' existing style="...stroke-width:...".
      pathElement.style.stroke = '#555555';
      pathElement.style.strokeWidth = '2';

      // Set up stroke-dasharray for drawing animation
      pathElement.style.strokeDasharray = `${pathLength}`;
      pathElement.style.strokeDashoffset = `${pathLength}`;

      // Store data
      pathData.push({
        element: pathElement,
        originalFill,
        originalFillOpacity,
        originalStroke,
        originalStrokeWidth
      });
    });

    // Animate all strokes (drawing effect)
    pathData.forEach((data, index) => {
      tl.to(data.element, {
        strokeDashoffset: 0,
        duration: strokeDuration,
        ease: ease
      }, index * staggerDelay);
    });

    // Calculate total stroke animation duration
    const totalStrokeDuration = pathData.length * staggerDelay + strokeDuration;

    // At 75% through drawing: pause, fade out SVG, fade in placeholder
    tl.add(() => {
      // Pause the timeline to stop further drawing
      tl.pause();

      // Fade out the SVG container
      gsap.to(container, {
        opacity: 0,
        duration: 0.5,
        ease: 'power2.in',
        onComplete: () => {
          // Remove SVG from scene
          scene.remove(label);

          // Fade in the placeholder
          placeholder.visible = true;
          if (placeholder.material) {
            gsap.to(placeholder.material, {
              opacity: 1,
              duration: 0.5,
              ease: 'power2.out'
            });
          }
        }
      });
    }, totalStrokeDuration * 0.75);

    return label;
  } catch (error) {
    console.error('Error injecting animated SVG:', error);
    return null;
  }
}

/**
 * Removes the SVG and restores the original mesh
 * Fades in the mesh and removes the CSS2DObject from the scene
 */
export function removeSVG(
  label: CSS2DObject | null,
  placeholder: THREE.Mesh,
  scene: THREE.Scene,
  options: { duration?: number; ease?: string } = {}
): void {
  const { duration = 0.5, ease = 'power2.out' } = options;

  if (!label) return;

  // Make mesh visible and fade it in
  placeholder.visible = true;
  
  if (placeholder.material) {
    const material = placeholder.material as THREE.MeshStandardMaterial;
    material.transparent = true;
    material.opacity = 0;
    
    gsap.to(material, {
      opacity: 1,
      duration,
      ease,
      onComplete: () => {
        // Remove the CSS2D label from scene
        scene.remove(label);
      }
    });
  } else {
    // If no material to fade, just remove immediately
    scene.remove(label);
  }
}
