import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { AppState } from '../types'
import { maybeShowToolbarTip } from '../mobile'

// Camera position constants
const ZOOM_POS = new THREE.Vector3(-2.8, 2.8, 1.2)
const ZOOM_TARGET = new THREE.Vector3(-3.4, 2.5, -0.1)
const NOTEPAD_POS = new THREE.Vector3(2.8, 2.5, 2.0)
const NOTEPAD_TARGET = new THREE.Vector3(3, 1.2, 1.6)
const BUTTON_ZOOM_POS = new THREE.Vector3(3.0, 1.5, 0.5)
const BUTTON_ZOOM_TARGET = new THREE.Vector3(3.0, 0.5, -1.5)
const IPOD_POS = new THREE.Vector3(1.5, 1.2, 1.5)
const IPOD_TARGET = new THREE.Vector3(1.5, 0.0, 1.4)
const BIKE_POS = new THREE.Vector3(-6.0, 2.0, 1.5)
const BIKE_TARGET = new THREE.Vector3(-5.4, 1.9, 0.6)
const CAR_POS = new THREE.Vector3(-2.2, 2.0, 0.8)
const CAR_TARGET = new THREE.Vector3(-3.0, 1.9, -0.2)
const DEFAULT_POS = new THREE.Vector3(1, 4, 8)
const DEFAULT_TARGET = new THREE.Vector3(0, 0, 0)

// Intro camera position (further back, behind the door)
const INTRO_POS = new THREE.Vector3(1, 4, 20)
const INTRO_TARGET = new THREE.Vector3(0, 0, 0)

export function updateCamera(camera: THREE.PerspectiveCamera, controls: OrbitControls, state: AppState): void {
    // During intro, keep camera at intro position until user clicks
    if (state.isIntro) {
        if (state.introAnimationProgress === 0) {
            // Waiting for click - keep camera at intro position
            return
        }
        
        // Animate from intro to default position
        const progress = Math.min(state.introAnimationProgress, 1)
        
        // Use easeOutCubic for smooth deceleration
        const eased = 1 - Math.pow(1 - progress, 3)
        
        const targetPos = new THREE.Vector3().lerpVectors(INTRO_POS, DEFAULT_POS, eased)
        const targetLookAt = new THREE.Vector3().lerpVectors(INTRO_TARGET, DEFAULT_TARGET, eased)
        
        camera.position.copy(targetPos)
        controls.target.copy(targetLookAt)
        
        // Update animation progress
        state.introAnimationProgress += 0.015
        
        // Animation complete
        if (state.introAnimationProgress >= 1) {
            state.isIntro = false
            state.introAnimationProgress = 0
            // Hide the door, light, walls, and UI after animation
            if (state.doorPivot) {
                state.doorPivot.visible = false
            }
            if (state.doorLight) {
                // Don't toggle visibility: removing a shadow-casting light changes the
                // light count baked into every lit shader and forces a full recompile.
                // Zero it out and stop re-rendering its shadow map instead.
                state.doorLight.intensity = 0
                state.doorLight.shadow.autoUpdate = false
            }
            if (state.doorUI) {
                state.doorUI.visible = false
            }
            state.doorWalls.forEach(wall => {
                wall.visible = false
            })
            // Arrived at the desk: good moment to tell iPhone Safari users about fullscreen
            maybeShowToolbarTip()
        }
        return
    }
    
    if (state.isFocusingOnScreen) {
        camera.position.lerp(ZOOM_POS, 0.05)
        controls.target.lerp(ZOOM_TARGET, 0.05)
    } else if (state.isFocusingOnNotepad) {
        camera.position.lerp(NOTEPAD_POS, 0.05)
        controls.target.lerp(NOTEPAD_TARGET, 0.05)
    } else if (state.isFocusingOnButton) {
        camera.position.lerp(BUTTON_ZOOM_POS, 0.05)
        controls.target.lerp(BUTTON_ZOOM_TARGET, 0.05)
    } else if (state.isFocusingOnIpod) {
        camera.position.lerp(IPOD_POS, 0.05)
        controls.target.lerp(IPOD_TARGET, 0.05)
    } else if (state.isFocusingOnBike) {
        camera.position.lerp(BIKE_POS, 0.05)
        controls.target.lerp(BIKE_TARGET, 0.05)
    } else if (state.isFocusingOnCar) {
        camera.position.lerp(CAR_POS, 0.05)
        controls.target.lerp(CAR_TARGET, 0.05)
    } else if (state.isCameraLocked) {
        if (camera.position.distanceTo(DEFAULT_POS) > 0.1 || controls.target.distanceTo(DEFAULT_TARGET) > 0.1) {
            camera.position.lerp(DEFAULT_POS, 0.05)
            controls.target.lerp(DEFAULT_TARGET, 0.05)
        }
    }
}
