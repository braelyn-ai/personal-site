import * as THREE from 'three'

// Compile shaders (in parallel where supported) and upload textures for `object`,
// using `targetScene`'s current lights and fog, so the first real frame doesn't stall.
export async function prewarm(
    renderer: THREE.WebGLRenderer,
    object: THREE.Object3D,
    camera: THREE.Camera,
    targetScene: THREE.Scene | null = null
): Promise<void> {
    // Scene materials are only ever drawn into composer render targets, which use
    // a different shader variant (no tone mapping, linear output) than the canvas.
    // compile() reads the bound target synchronously, so restore it right away.
    const warmupTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
    const previousTarget = renderer.getRenderTarget()
    renderer.setRenderTarget(warmupTarget)
    const compiling = renderer.compileAsync(object, camera, targetScene)
    renderer.setRenderTarget(previousTarget)
    await compiling
    warmupTarget.dispose()

    // Upload textures within a small per-frame budget instead of all at once on first draw
    const textures = new Set<THREE.Texture>()
    object.traverse(obj => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh) return
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const mat of materials) {
            for (const value of Object.values(mat)) {
                if (value && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture)
            }
        }
    })
    const queue = [...textures]
    while (queue.length > 0) {
        const frameStart = performance.now()
        while (queue.length > 0 && performance.now() - frameStart < 8) {
            renderer.initTexture(queue.shift()!)
        }
        await new Promise(requestAnimationFrame)
    }
}
