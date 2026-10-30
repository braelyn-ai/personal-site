import type { AppState } from '../types'
import { updateIpodScreen } from '../objects/IpodClassic'

const BOUNCING_LIGHT_INTENSITY = 50

export function updateScene(state: AppState, time: number): void {
    // Update iPod screen scrolling text
    updateIpodScreen(time)
    // Check if in backrooms (used to disable animations)
    const isInBackrooms = state.backroomsPivot && state.backroomsPivot.visible

    // Arm Animation (disabled in backrooms)
    if (state.armSegments.arm && !isInBackrooms) {
        const rawTriangle = (2 / Math.PI) * Math.asin(Math.sin(time * 0.7))
        const clamped = Math.max(-1, Math.min(1, rawTriangle * 1.02))
        state.armSegments.arm.rotation.x = clamped * 0.1
    }

    // Show/hide lights based on active show
    const showRaveLights = state.currentLightShow !== 'lightShow3' && !state.isEmergencyStopped
    // Lights are switched off by intensity, never visibility: changing which lights are
    // visible changes the light count compiled into every shader and freezes the page.
    // updateRaveLights() sets the real intensities afterwards while the show is running.
    state.raveLights.forEach(item => {
        if (!showRaveLights) item.light.intensity = 0
        // Skip shadow-map renders for spotlights that are switched off
        if (item.light.castShadow && item.light.shadow) item.light.shadow.autoUpdate = showRaveLights
    })
    if (state.bouncingLight) {
        const showBouncing = state.currentLightShow === 'lightShow3' && !state.isEmergencyStopped
        state.bouncingLight.intensity = showBouncing ? BOUNCING_LIGHT_INTENSITY : 0
    }

    // Emergency Text Flashing
    if (state.emergencyText) {
        if (state.isFocusingOnButton && !isInBackrooms) {
            state.emergencyText.visible = Math.floor(time * 2) % 2 === 0
        } else {
            state.emergencyText.visible = false
        }
    }

    // Emergency Button Press Animation
    if (state.emergencyButtonTopPivot && state.emergencyButtonPressTime) {
        const elapsed = Date.now() - state.emergencyButtonPressTime
        const pressDuration = 150 // Quick press down in 150ms
        const pressDepth = 0.15 // How far down the top moves (in local units)
        
        if (elapsed < pressDuration) {
            // Ease out for snappy press feel
            const progress = elapsed / pressDuration
            const eased = 1 - Math.pow(1 - progress, 3)
            state.emergencyButtonTopPivot.position.y = -pressDepth * eased
        } else {
            // Keep pressed down
            state.emergencyButtonTopPivot.position.y = -pressDepth
        }
    }
}
