import * as THREE from 'three'
import type { AppState } from '../types'

export function setupLights(scene: THREE.Scene, state: AppState): void {
    // --- BASIC LIGHTING ---
    const ambientLight = new THREE.AmbientLight(0x101020, 0.1)
    scene.add(ambientLight)
    state.roomLights.push(ambientLight)

    const spotLight = new THREE.SpotLight(0xffaa55, 20)
    spotLight.position.set(3, 6, 2)
    spotLight.angle = Math.PI / 6
    spotLight.penumbra = 0.5
    spotLight.decay = 2
    spotLight.distance = 50
    spotLight.castShadow = true
    spotLight.shadow.mapSize.width = 1024
    spotLight.shadow.mapSize.height = 1024
    spotLight.shadow.bias = -0.0001
    scene.add(spotLight)
    state.roomLights.push(spotLight)
    scene.add(spotLight.target)
    spotLight.target.position.set(0, 0, 0)

    const screenLight = new THREE.PointLight(0x00ffaa, 2, 5)
    screenLight.position.set(-4, 1.5, 1.5)
    scene.add(screenLight)
    state.roomLights.push(screenLight)

    const rimLight = new THREE.DirectionalLight(0x4455ff, 1)
    rimLight.position.set(-5, 5, -5)
    scene.add(rimLight)
    state.roomLights.push(rimLight)

    const deskFrontLight = new THREE.PointLight(0xffffff, 2, 15)
    deskFrontLight.position.set(0, -1, 7)
    scene.add(deskFrontLight)
    state.roomLights.push(deskFrontLight)

    // --- RAVE LIGHTS SETUP ---
    const raveColors = [0xff0000, 0xffffff]

    // 1. RectAreaLights (Base wash)
    for (let i = -1; i <= 1; i++) {
        const speed = 0.5 + Math.random() * 0.5

        // Upward
        const rectLight = new THREE.RectAreaLight(raveColors[(i + 1) % raveColors.length], 5, 20, 10)
        rectLight.position.set(i * 25, -9, -29)
        rectLight.lookAt(i * 25, 20, -30) // Look up at upper wall
        scene.add(rectLight)
        state.raveLights.push({ light: rectLight, type: 'rect', speed, offset: i })

        // Downward
        const rectLightDown = new THREE.RectAreaLight(raveColors[(i + 1) % raveColors.length], 5, 20, 10)
        rectLightDown.position.set(i * 25, -9, -29)
        rectLightDown.lookAt(i * 25, -20, -30) // Look down at lower wall
        scene.add(rectLightDown)
        state.raveLights.push({ light: rectLightDown, type: 'rect', speed, offset: i })
    }

    // 2. Left Wall Lights
    for (let i = 0; i < 3; i++) {
        const speed = 0.5 + Math.random() * 0.5
        const zPos = -20 + i * 25 // Spaced along the wall

        // Upward
        const rectLight = new THREE.RectAreaLight(raveColors[i % raveColors.length], 5, 20, 10)
        rectLight.position.set(-49, -9, zPos)
        rectLight.lookAt(-50, 0, zPos)
        scene.add(rectLight)
        state.raveLights.push({ light: rectLight, type: 'rect', speed, offset: i + 5 })

        // Downward
        const rectLightDown = new THREE.RectAreaLight(raveColors[i % raveColors.length], 5, 20, 10)
        rectLightDown.position.set(-49, -9, zPos)
        rectLightDown.lookAt(-50, -20, zPos)
        scene.add(rectLightDown)
        state.raveLights.push({ light: rectLightDown, type: 'rect', speed, offset: i + 5 })
    }

    // 3. SpotLights (Beams)
    for (let i = -2; i <= 2; i++) {
        const spot = new THREE.SpotLight(raveColors[(i + 2) % raveColors.length], 100)
        spot.position.set(i * 15, -9, -20)
        spot.target.position.set(i * 10, 10, -35)
        spot.angle = Math.PI / 8
        spot.penumbra = 0.5
        spot.decay = 1.5
        spot.distance = 100
        spot.castShadow = true
        spot.shadow.bias = -0.0001

        scene.add(spot)
        scene.add(spot.target)
        state.raveLights.push({
            light: spot,
            type: 'spot',
            baseX: i * 15,
            targetBaseX: i * 10,
            speed: 1 + Math.random(),
            offset: i * 2
        })
    }

    // Save Light Show 1 configuration (original)
    state.lightShows.lightShow1 = state.raveLights.map(item => ({
        speed: item.speed,
        offset: item.offset,
        type: item.type,
        baseX: item.baseX,
        targetBaseX: item.targetBaseX
    }))

    // Create Light Show 2 configuration (white strobe, all in sync)
    state.lightShows.lightShow2 = state.raveLights.map(item => ({
        speed: 3.0, // Fast strobe speed, same for all
        offset: 0,  // All in sync (no offset)
        type: item.type,
        baseX: item.baseX,
        targetBaseX: item.targetBaseX
    }))

    // Create Light Show 3: Single bouncing red light
    // Room perimeter: back wall at z=-30, left wall at x=-50, front at z=20, right at x=50
    const bouncingLight = new THREE.PointLight(0xff0000, 50, 30)
    bouncingLight.position.set(-50, 0, -30) // Start at back-left corner
    bouncingLight.intensity = 0 // Off by default (dimmed, not hidden, to avoid shader recompiles)
    scene.add(bouncingLight)
    state.bouncingLight = bouncingLight
    state.lightShows.lightShow3 = { light: bouncingLight }
}
