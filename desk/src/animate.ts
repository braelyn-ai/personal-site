import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import type { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import type { RenderPixelatedPass } from 'three/examples/jsm/postprocessing/RenderPixelatedPass.js'
import type { AppState } from './types'
import { Terminal } from './meshes/Terminal'
import { Oscilloscope } from './meshes/Oscilloscope'
import { updateCamera } from './animations/cameraAnimation'
import { updateRaveLights } from './animations/raveLights'
import { updateEffects } from './animations/effects'
import { updateScene } from './animations/sceneUpdates'
import { updateDeathScreen } from './utils/deathScreen'

export interface AnimationDependencies {
    controls: OrbitControls
    camera: THREE.PerspectiveCamera
    state: AppState
    crtPass: ShaderPass
    terminal: Terminal
    oscilloscope: Oscilloscope
    composer: EffectComposer
    renderPixelatedPass: RenderPixelatedPass
    whiteOutPass: ShaderPass
}

export function createAnimationLoop(deps: AnimationDependencies): () => void {
    const { controls, camera, state, crtPass, terminal, oscilloscope, composer, renderPixelatedPass, whiteOutPass } = deps

    function animate(): void {
        requestAnimationFrame(animate)
        controls.update()

        const time = Date.now() * 0.001

        updateCamera(camera, controls, state)
        updateScene(state, time)
        updateRaveLights(state, time)
        updateEffects(crtPass, whiteOutPass, renderPixelatedPass, state)

        // Pulsate enter button opacity (0.6 to 1.0) - only when not glitching
        if (state.isIntro && state.doorEnterMesh && !state.introGlitchStartTime) {
            const material = state.doorEnterMesh.material as THREE.MeshBasicMaterial
            // Pulsate using sine wave: oscillates between 0.6 and 1.0
            material.opacity = 0.8 + 0.2 * Math.sin(time * 2)
        }

        // Handle intro glitch effect
        if (state.isIntro && state.introGlitchStartTime && state.doorUI) {
            const glitchElapsed = Date.now() - state.introGlitchStartTime
            const glitchDuration = 800 // 0.8 seconds of glitching
            const postGlitchDelay = 1500
            
            if (glitchElapsed < glitchDuration) {
                // Glitch effect: rapidly toggle visibility with random timing
                const glitchSpeed = 50 + Math.random() * 100
                const visible = Math.sin(glitchElapsed / glitchSpeed * Math.PI) > 0
                state.doorUI.visible = visible
                
                // Also randomly offset position slightly for extra glitch feel
                if (state.doorUI.visible) {
                    state.doorUI.position.x = (Math.random() - 0.5) * 0.1
                    state.doorUI.position.y = 2.5 + (Math.random() - 0.5) * 0.1
                }
            } else {
                // Glitch done - hide UI completely
                state.doorUI.visible = false
                state.doorUI.position.x = 0
                state.doorUI.position.y = 2.5

                // Phone still in portrait: show the rotate sign on the door until it turns
                if (state.doorRotatePrompt) {
                    state.doorRotatePrompt.visible = state.introAwaitingLandscape
                    if (state.introAwaitingLandscape) {
                        const phone = state.doorRotatePrompt.getObjectByName('rotate_phone')
                        if (phone) phone.rotation.z = rotateHintAngle(time)
                    }
                }
                
                // Wait additional delay after glitch, then start door opening if scene is ready
                if (glitchElapsed >= glitchDuration + postGlitchDelay && 
                    state.introSceneReady && state.introMusicReady && !state.introAwaitingLandscape && !state.introDoorOpenStartTime) {
                    state.introDoorOpenStartTime = Date.now()
                    
                    // Play door open sound
                    if (state.doorOpenSound && !state.doorOpenSound.isPlaying) {
                        state.doorOpenSound.play()
                    }
                }
            }
        }

        // Handle door opening animation
        if (state.isIntro && state.introDoorOpenStartTime) {
            const doorElapsed = Date.now() - state.introDoorOpenStartTime
            const doorOpenDuration = 2500 // 2.5 seconds to open door
            const targetAngle = (130 * Math.PI) / 180 // 130 degrees (opens to the right)
            
            // Animate the low-pass filter frequency as door opens (400 -> 2500 Hz)
            if (state.musicFilter) {
                const filterProgress = Math.min(doorElapsed / doorOpenDuration, 1)
                const filterEased = 1 - Math.pow(1 - filterProgress, 2)
                state.musicFilter.frequency.value = 400 + (2100 * filterEased)
            }
            
            if (state.doorHingePivot) {
                if (doorElapsed < doorOpenDuration) {
                    // Ease out cubic for smooth door opening
                    const progress = doorElapsed / doorOpenDuration
                    const eased = 1 - Math.pow(1 - progress, 3)
                    state.doorHingePivot.rotation.y = targetAngle * eased
                } else {
                    // Door fully open - start camera movement
                    state.doorHingePivot.rotation.y = targetAngle
                    if (state.introAnimationProgress === 0) {
                        state.introAnimationProgress = 0.001
                    }
                }
            } else {
                // No door hinge found, just start camera after duration
                if (doorElapsed >= doorOpenDuration && state.introAnimationProgress === 0) {
                    state.introAnimationProgress = 0.001
                }
            }
        }

        // Render
        terminal.update()
        // Check if in backrooms (used to disable oscilloscope and show horror monster)
        const isInBackrooms = state.backroomsPivot && state.backroomsPivot.visible
        if (!isInBackrooms) {
            oscilloscope.update()
        }

        // Show horror monster when focusing on something in the backrooms
        if (state.horrorMonsterPivot) {
            const isFocusingOnSomething = state.isFocusingOnScreen || state.isFocusingOnNotepad
            
            // Start reveal timer when focusing on something (0.5s delay)
            if (!!isInBackrooms && isFocusingOnSomething && !state.horrorMonsterPivot.visible && !state.horrorMonsterRevealTime) {
                state.horrorMonsterRevealTime = Date.now()
                state.horrorMonsterFadeStartTime = null // Reset fade if re-focusing
            }
            
            // Reveal monster after 0.5s delay
            if (state.horrorMonsterRevealTime && !state.horrorMonsterPivot.visible) {
                const elapsed = Date.now() - state.horrorMonsterRevealTime
                if (elapsed >= 500) {
                    state.horrorMonsterPivot.visible = true
                    // Reset opacity to full when revealing
                    state.horrorMonsterPivot.traverse(child => {
                        if (child instanceof THREE.Mesh) {
                            const material = child.material as THREE.MeshStandardMaterial
                            if (material && material.isMeshStandardMaterial) {
                                material.opacity = 1
                            }
                        }
                    })
                    // Play creepy knock sound
                    if (state.creepyKnockSound && state.creepyKnockSound.buffer && !state.creepyKnockSound.isPlaying) {
                        if (state.creepyKnockSound.context.state === 'suspended') {
                            state.creepyKnockSound.context.resume()
                        }
                        state.creepyKnockSound.play()
                    }
                }
            }
            
            // Start fade timer when zooming out (3s wait + 3s fade)
            if (state.horrorMonsterPivot.visible && !isFocusingOnSomething && !state.horrorMonsterFadeStartTime) {
                state.horrorMonsterFadeStartTime = Date.now()
            }
            
            // Cancel fade if focusing again
            if (isFocusingOnSomething && state.horrorMonsterFadeStartTime) {
                state.horrorMonsterFadeStartTime = null
                // Reset opacity to full
                state.horrorMonsterPivot.traverse(child => {
                    if (child instanceof THREE.Mesh) {
                        const material = child.material as THREE.MeshStandardMaterial
                        if (material && material.isMeshStandardMaterial) {
                            material.opacity = 1
                        }
                    }
                })
            }
            
            // Handle fade out: 3s wait, then 3s fade, then jumpscare at 4s
            if (state.horrorMonsterFadeStartTime && state.horrorMonsterPivot.visible) {
                const elapsed = Date.now() - state.horrorMonsterFadeStartTime
                const waitTime = 3000
                const fadeDuration = 3000
                const jumpscareTime = 10000 // 10 seconds after zoom out
                
                // Trigger jumpscare at 4 seconds
                if (elapsed >= jumpscareTime && !state.jumpscareTriggered) {
                    state.jumpscareTriggered = true
                    
                    // Play jumpscare sound
                    if (state.jumpscareSound && state.jumpscareSound.buffer) {
                        if (state.jumpscareSound.context.state === 'suspended') {
                            state.jumpscareSound.context.resume()
                        }
                        if (state.jumpscareSound.isPlaying) state.jumpscareSound.stop()
                        state.jumpscareSound.play()
                    }
                    
                    // Stop horror fade sound if playing
                    if (state.horrorFadeSound && state.horrorFadeSound.isPlaying) {
                        state.horrorFadeSound.stop()
                    }
                    
                    // Move monster right in front of camera
                    const cameraDirection = new THREE.Vector3()
                    camera.getWorldDirection(cameraDirection)
                    state.horrorMonsterPivot.position.set(1, 1, 2)
                    
                    // Set opacity back to 1 instantly
                    state.horrorMonsterPivot.traverse(child => {
                        if (child instanceof THREE.Mesh) {
                            const material = child.material as THREE.MeshStandardMaterial
                            if (material && material.isMeshStandardMaterial) {
                                material.opacity = 1
                            }
                        }
                    })
                    
                    // Start death sequence 2 second after jumpscare
                    state.deathSequenceStartTime = Date.now() + 2000
                }
                
                // Handle death sequence
                if (state.deathSequenceStartTime && Date.now() >= state.deathSequenceStartTime) {
                    const deathElapsed = Date.now() - state.deathSequenceStartTime
                    const deathDuration = 5000 // 5 seconds for full death sequence
                    const deathProgress = Math.min(deathElapsed / deathDuration, 1)
                    
                    updateDeathScreen(deathProgress)
                    
                    // Refresh page after death sequence completes
                    if (deathProgress >= 1) {
                        window.location.reload()
                    }
                }
                
                // Normal fade logic (only if jumpscare hasn't triggered)
                if (elapsed >= waitTime && !state.jumpscareTriggered) {
                    const fadeProgress = Math.min((elapsed - waitTime) / fadeDuration, 1)
                    const opacity = 1 - fadeProgress
                    
                    // Play horror fade sound when fade starts
                    if (state.horrorFadeSound && state.horrorFadeSound.buffer && !state.horrorFadeSound.isPlaying) {
                        if (state.horrorFadeSound.context.state === 'suspended') {
                            state.horrorFadeSound.context.resume()
                        }
                        state.horrorFadeSound.play()
                    }
                    
                    state.horrorMonsterPivot.traverse(child => {
                        if (child instanceof THREE.Mesh) {
                            const material = child.material as THREE.MeshStandardMaterial
                            if (material && material.isMeshStandardMaterial) {
                                material.opacity = opacity
                            }
                        }
                    })
                }
            }
            
            // Sporadic head bobbing animation when visible
            if (state.horrorMonsterPivot.visible && !state.jumpscareTriggered) {
                const baseY = -3.5 // Original y position from HorrorMonster.ts
                // Combine multiple sine waves at different frequencies for unpredictable movement
                const bob1 = Math.sin(time * 0.7) * 0.15          // Slow primary bob
                const bob2 = Math.sin(time * 1.9) * 0.08          // Medium frequency
                const bob3 = Math.sin(time * 4.3) * 0.04          // Quick jitter
                const bob4 = Math.sin(time * 0.3) * 0.1           // Very slow drift
                state.horrorMonsterPivot.position.y = baseY + bob1 + bob2 + bob3 + bob4
            }
        }

        // Camera Rumble (140 BPM)
        let shakeX = 0
        let shakeY = 0
        let shakeZ = 0

        if (state.isAudioPlaying && !state.isEmergencyStopped) {
            // 140 BPM = 2.333 beats per second
            const beatFreq = 140 / 60
            // Sawtooth wave 0->1 for beat timing
            const beat = (time * beatFreq) % 1

            // Sharp decay envelope (starts at 1, drops fast) creates the "kick" rhythmic feel
            const envelope = Math.pow(1 - beat, 4)

            // High frequency rumble (noise) synced to the beat envelope
            // "Sharp" vibration comes from random noise + fast attack
            const intensity = 0.025
            shakeX = (Math.random() - 0.5) * intensity * envelope
            shakeY = (Math.random() - 0.5) * intensity * envelope
            shakeZ = (Math.random() - 0.5) * intensity * envelope

            camera.position.x += shakeX
            camera.position.y += shakeY
            camera.position.z += shakeZ
        }

        // Paused while shaders compile in the background (the canvas keeps its last frame)
        if (!state.renderPaused) composer.render()

        // Restore camera position to prevent drift/fighting with controls
        if (state.isAudioPlaying && !state.isEmergencyStopped) {
            camera.position.x -= shakeX
            camera.position.y -= shakeY
            camera.position.z -= shakeZ
        }
    }

    return animate
}

// Phone icon tilt for the rotate prompt: hold upright, turn sideways, hold, turn back
function rotateHintAngle(time: number): number {
    const p = (time % 2.4) / 2.4
    const ease = (t: number) => t * t * (3 - 2 * t)
    let amount = 0
    if (p < 0.2) amount = 0
    else if (p < 0.5) amount = ease((p - 0.2) / 0.3)
    else if (p < 0.8) amount = 1
    else amount = 1 - ease((p - 0.8) / 0.2)
    return amount * Math.PI / 2
}
