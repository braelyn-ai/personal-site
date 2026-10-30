import * as THREE from 'three'
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { AppState } from '../types'
import { assetUrl } from '../utils/assetUrl'

let backroomsLoadPromise: Promise<void> | null = null
let backroomsLoaderFn: (() => Promise<void>) | null = null

export function prepareBackroomsLoader(loader: GLTFLoader, scene: THREE.Scene, state: AppState): void {
    backroomsLoaderFn = () => loadBackrooms(loader, scene, state)
}

export function ensureBackroomsLoaded(): Promise<void> {
    if (!backroomsLoadPromise) {
        backroomsLoadPromise = backroomsLoaderFn ? backroomsLoaderFn() : Promise.resolve()
    }
    return backroomsLoadPromise
}

export function loadBackrooms(loader: GLTFLoader, scene: THREE.Scene, state: AppState): Promise<void> {
    return new Promise((resolve, reject) => {
    loader.load(assetUrl('backrooms_map_packed_blender_3.2.0.glb'), (gltf) => {
        const model = gltf.scene
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())

        const pivot = new THREE.Group()
        state.backroomsPivot = pivot
        scene.add(pivot)
        
        // Hide initially
        pivot.visible = false

        model.position.copy(center).negate()
        pivot.add(model)
        
        // Scale up (Backrooms map usually needs checking, assuming it needs to be room scale)
        // The current room is roughly 40-100 units wide.
        pivot.scale.set(5, 5, 5)
        
        // Position so camera (at 0,0,0 or similar) is inside a corridor
        pivot.position.set(15, -32, 15)

        // Store light meshes to add lights to later
        const lightMeshes: THREE.Mesh[] = []
        
        model.traverse(child => {
            if (child instanceof THREE.Mesh) {
                child.receiveShadow = true
                // Backrooms usually self-lit or diffuse, but let's allow shadows
                child.castShadow = true
                
                // Check if this mesh represents a light fixture
                const name = child.name.toLowerCase()
                const material = Array.isArray(child.material) ? child.material[0] : child.material
                const isLightMesh = name.includes('light') || 
                                   name.includes('lamp') || 
                                   name.includes('bulb') || 
                                   name.includes('fixture') ||
                                   name.includes('ceiling') ||
                                   (material && material instanceof THREE.MeshStandardMaterial && material.emissive && 
                                    (material.emissive.r > 0 || 
                                     material.emissive.g > 0 || 
                                     material.emissive.b > 0))
                
                if (isLightMesh) {
                    lightMeshes.push(child)
                }
            }
        })
        
        // Add lights at each light mesh position (getWorldPosition updates the
        // matrices itself, so no need to wait a tick)
        {
            lightMeshes.forEach(mesh => {
                // Get world position of the mesh
                const worldPosition = new THREE.Vector3()
                mesh.getWorldPosition(worldPosition)
                
                // Create a point light at this position
                const meshLight = new THREE.PointLight(0xffaa00, 5, 50)
                meshLight.position.copy(worldPosition)
                meshLight.visible = false
                scene.add(meshLight)
                state.backroomsLights.push(meshLight)
            })
        }
        
        // Backrooms Lighting (Yellow Haze) - Really bright, no fog
        const backroomsAmbient = new THREE.AmbientLight(0xffaa00, 3.0)
        backroomsAmbient.visible = false
        scene.add(backroomsAmbient)
        state.backroomsLights.push(backroomsAmbient)
        
        // Hum/Buzz lights - Central overhead
        const pointLight = new THREE.PointLight(0xffaa00, 8, 200)
        pointLight.position.set(-50, -15, 20)
        pointLight.visible = false
        scene.add(pointLight)
        state.backroomsLights.push(pointLight)
        
        // Additional fill - Large ceiling panel
        const rectLight = new THREE.RectAreaLight(0xffaa00, 15, 200, 200)
        rectLight.position.set(-50, -10, 20)
        rectLight.lookAt(-50, -32, 20)
        rectLight.visible = false
        scene.add(rectLight)
        state.backroomsLights.push(rectLight)
        
        // Extra overhead fill for maximum brightness
        const rectLight2 = new THREE.RectAreaLight(0xffaa00, 12, 180, 180)
        rectLight2.position.set(-30, -12, 10)
        rectLight2.lookAt(-30, -32, 10)
        rectLight2.visible = false
        scene.add(rectLight2)
        state.backroomsLights.push(rectLight2)
        resolve()
    }, undefined, (error) => {
        console.error('Failed to load backrooms_map_packed_blender_3.2.0.glb:', error)
        reject(error)
    })
    })
}
