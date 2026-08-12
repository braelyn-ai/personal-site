import * as THREE from 'three'
import type { AppState } from './types'
import type { Terminal } from './meshes/Terminal'
import type { Notepad } from './meshes/Notepad'
import type { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { assetUrl } from './utils/assetUrl'
import { trackEvent } from './utils/trackEvent'
import { markFound } from './easterEggs'
import { ensureBackroomsLoaded } from './objects/Backrooms'

// Helper to detect mobile devices
function isMobileDevice(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        (window.innerWidth <= 768 && 'ontouchstart' in window)
}

// Helper to create text texture (for updating enter button)
function createTextTexture(text: string, fontSize: number = 64, color: string = '#ffffff'): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    
    canvas.width = 512
    canvas.height = 128
    
    ctx.fillStyle = 'transparent'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    
    ctx.font = `bold ${fontSize}px Arial, sans-serif`
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
}

export function setupInteractions(
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    state: AppState,
    notepad: Notepad,
    terminal: Terminal,
    crtPass: ShaderPass
): void {
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    // Audio Setup
    const listener = new THREE.AudioListener()
    camera.add(listener)

    // Create position helpers for directional audio (relative to camera)
    const technoPosition = new THREE.Object3D()
    technoPosition.position.set(0, -2, -5) // Below and in front of camera
    camera.add(technoPosition)

    const sound = new THREE.PositionalAudio(listener)
    sound.setRefDistance(5)
    sound.setRolloffFactor(0.5)
    technoPosition.add(sound)
    state.technoMusic = sound

    // Create muffled effect (low-pass filter) - starts very muffled, opens up when door opens
    const filter = listener.context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 400 // Start very muffled, will increase when door opens
    sound.setFilter(filter)
    state.musicFilter = filter

    // Add Reverb to the filtered signal
    const convolver = listener.context.createConvolver()
    const reverbGain = listener.context.createGain()
    reverbGain.gain.value = 0.3

    // Generate impulse response for reverb
    const rate = listener.context.sampleRate
    const length = rate * 1.5 // 1.5 seconds tail
    const impulse = listener.context.createBuffer(2, length, rate)
    const leftChannel = impulse.getChannelData(0)
    const rightChannel = impulse.getChannelData(1)

    for (let i = 0; i < length; i++) {
        const decay = Math.pow(1 - i / length, 2.0)
        // Add some noise to each channel
        leftChannel[i] = (Math.random() * 2 - 1) * decay
        rightChannel[i] = (Math.random() * 2 - 1) * decay
    }
    convolver.buffer = impulse

    // Connect wet path: Filter -> Convolver -> ReverbGain -> MasterGain
    filter.connect(convolver)
    convolver.connect(reverbGain)
    reverbGain.connect(sound.gain)

    const audioLoader = new THREE.AudioLoader()
    audioLoader.load(assetUrl('berghain.mp3'), function (buffer) {
        sound.setBuffer(buffer)
        sound.setLoop(true)
        sound.setVolume(0.5)
        sound.offset = 120 // Start at 2 minutes
    }, undefined, function (error) {
        console.warn('Failed to load berghain.mp3:', error)
    })

    // Emergency switch sound
    const emergencySwitchSound = new THREE.Audio(listener)
    audioLoader.load(assetUrl('loud-switch.mp3'), function (buffer) {
        emergencySwitchSound.setBuffer(buffer)
        emergencySwitchSound.setLoop(false)
        emergencySwitchSound.setVolume(1.0)
    }, undefined, function (error) {
        console.warn('Failed to load loud-switch.mp3:', error)
    })
    state.emergencySwitchSound = emergencySwitchSound

    // Lamp buzz sound for backrooms (with reverb) - positioned above camera
    const buzzPosition = new THREE.Object3D()
    buzzPosition.position.set(0, 4, 0) // Above the camera
    camera.add(buzzPosition)
    
    const lampBuzzSound = new THREE.PositionalAudio(listener)
    lampBuzzSound.setRefDistance(3)
    lampBuzzSound.setRolloffFactor(0.3)
    buzzPosition.add(lampBuzzSound)
    
    // Create reverb for lamp buzz
    const buzzConvolver = listener.context.createConvolver()
    const buzzReverbGain = listener.context.createGain()
    buzzReverbGain.gain.value = 0.15 // Subtle reverb
    
    // Generate impulse response for reverb (shorter tail for ambient hum)
    const buzzLength = rate * 0.8 // 0.8 seconds tail
    const buzzImpulse = listener.context.createBuffer(2, buzzLength, rate)
    const buzzLeft = buzzImpulse.getChannelData(0)
    const buzzRight = buzzImpulse.getChannelData(1)
    
    for (let i = 0; i < buzzLength; i++) {
        const decay = Math.pow(1 - i / buzzLength, 2.5)
        buzzLeft[i] = (Math.random() * 2 - 1) * decay
        buzzRight[i] = (Math.random() * 2 - 1) * decay
    }
    buzzConvolver.buffer = buzzImpulse
    
    audioLoader.load(assetUrl('lamp-buzz.mp3'), function (buffer) {
        lampBuzzSound.setBuffer(buffer)
        lampBuzzSound.setLoop(true)
        
        // Connect reverb: source -> convolver -> reverbGain -> output
        lampBuzzSound.gain.connect(buzzConvolver)
        buzzConvolver.connect(buzzReverbGain)
        buzzReverbGain.connect(listener.context.destination)
    }, undefined, function (error) {
        console.warn('Failed to load lamp-buzz.mp3:', error)
    })
    state.lampBuzzSound = lampBuzzSound

    let audioStarted = false

    // Helper function to update pointer and handle hover effects
    function updatePointerAndHover(clientX: number, clientY: number) {
        pointer.x = (clientX / window.innerWidth) * 2 - 1
        pointer.y = -(clientY / window.innerHeight) * 2 + 1
        raycaster.setFromCamera(pointer, camera)

        let cursorStyle = "url('/pointer.png'), auto"

        // During intro, check for hovering over door UI elements (but not while glitching)
        if (state.isIntro && state.introAnimationProgress === 0 && state.doorUI && !state.introGlitchStartTime) {
            const intersects = raycaster.intersectObjects(state.doorUI.children, true)

            // Reset all clickable elements to normal scale
            state.doorUI.children.forEach(child => {
                if (child.name.startsWith('social_') || child.name === 'door_enter') {
                    child.scale.lerp(new THREE.Vector3(1, 1, 1), 0.2)
                }
            })

            // Loop through intersects to find a clickable element
            for (const hit of intersects) {
                const hitObject = hit.object
                const hitName = hitObject.name
                if (hitName.startsWith('social_') || hitName === 'door_enter') {
                    // Scale up hovered element
                    hitObject.scale.lerp(new THREE.Vector3(1.15, 1.15, 1.15), 0.3)
                    document.body.style.cursor = "url('/click.png'), pointer"
                    return
                }
            }
            document.body.style.cursor = "url('/pointer.png'), auto"
            return
        }

        // Mode 1: Focusing on Notepad - check for specific links
        if (state.isFocusingOnNotepad && state.notepadPivot) {
            let paperMesh: THREE.Mesh | null = null
            state.notepadPivot.traverse(child => {
                if (child instanceof THREE.Mesh && (child.name === 'Torus002_Material002_0' || child.name.includes('Torus.002'))) {
                    paperMesh = child
                }
            })

            let linkHovered = false
            if (paperMesh) {
                const intersects = raycaster.intersectObject(paperMesh)
                if (intersects.length > 0 && intersects[0].uv) {
                    const uv = intersects[0].uv

                    let hoveredIndex = -1
                    notepad.blogPosts.forEach((post, index) => {
                        const texU = uv.x * 1.2 - 0.1
                        const texV = uv.y * 1.2 - 0.1
                        const scaledX = texU * 1024
                        const scaledY = texV * 1448

                        if (scaledX > 140 && scaledX < 900 && scaledY > post.y + 350 && scaledY < post.y + 450) {
                            hoveredIndex = index
                        }
                    })

                    notepad.setHovered(hoveredIndex)
                    if (hoveredIndex !== -1) linkHovered = true
                } else {
                    notepad.setHovered(-1)
                }
            } else {
                notepad.setHovered(-1)
            }

            if (linkHovered) cursorStyle = "url('/click.png'), pointer"

        }
        // Mode 2: General View - check for clickable objects
        else if (state.isCameraLocked) {
            let objectHovered = false

            const checkIntersect = (pivot: THREE.Group | null | undefined) => {
                if (!pivot) return false
                return raycaster.intersectObjects(pivot.children, true).length > 0
            }

            // Check interactions based on click handler logic
            if (checkIntersect(state.powerPilePivot)) objectHovered = true
            else if (state.computerPivot && raycaster.intersectObjects(state.computerPivot.children, true).some(hit => hit.object.name.toLowerCase().includes('cube_screen_0'))) objectHovered = true
            else if (checkIntersect(state.notepadPivot)) objectHovered = true
            else if (checkIntersect(state.emergencyButtonPivot)) objectHovered = true
            else if (checkIntersect(state.octocatPivot)) objectHovered = true
            else if (checkIntersect(state.bagelPivot)) objectHovered = true
            else if (checkIntersect(state.ipodPivot)) objectHovered = true
            else if (checkIntersect(state.bikePivot)) objectHovered = true
            else if (checkIntersect(state.carPivot)) objectHovered = true

            if (objectHovered) cursorStyle = "url('/click.png'), pointer"
        }

        document.body.style.cursor = cursorStyle
    }

    window.addEventListener('mousemove', (event: MouseEvent) => {
        updatePointerAndHover(event.clientX, event.clientY)
    })

    // Add touch event support for mobile devices
    window.addEventListener('touchmove', (event: TouchEvent) => {
        if (event.touches.length > 0) {
            const touch = event.touches[0]
            updatePointerAndHover(touch.clientX, touch.clientY)
        }
    })

    // Helper function to handle click/tap interactions
    function handleClickInteraction(clientX: number, clientY: number) {
        pointer.x = (clientX / window.innerWidth) * 2 - 1
        pointer.y = -(clientY / window.innerHeight) * 2 + 1

        // Handle intro click - check for door UI interactions
        if (state.isIntro && state.introAnimationProgress === 0) {
            raycaster.setFromCamera(pointer, camera)
            
            if (state.doorUI) {
                const intersects = raycaster.intersectObjects(state.doorUI.children, true)
                
                // Loop through all intersects to find a clickable object
                // (title mesh or other unnamed objects might be hit first)
                for (const hit of intersects) {
                    const hitObject = hit.object
                    const hitName = hitObject.name
                    
                    // Handle social icon clicks
                    if (hitName.startsWith('social_') && hitObject.userData.url) {
                        trackEvent({ eventType: 'social_click', eventData: hitName })
                        // Use anchor element + touchend for Safari compatibility
                        const link = document.createElement('a')
                        link.href = hitObject.userData.url
                        link.target = '_blank'
                        link.rel = 'noopener noreferrer'
                        document.body.appendChild(link)
                        link.click()
                        document.body.removeChild(link)
                        return
                    }
                    
                    // Handle enter button click
                    if (hitName === 'door_enter') {
                        // Play knock sound
                        if (state.doorKnockSound && !state.doorKnockSound.isPlaying) {
                            state.doorKnockSound.play()
                        }
                        
                        // Play audio on enter
                        if (!audioStarted) {
                            if (sound.context.state === 'suspended') {
                                sound.context.resume()
                            }
                            if (sound.buffer) {
                                sound.play()
                                audioStarted = true
                                state.isAudioPlaying = true
                            }
                        }
                        
                        if (isMobileDevice()) {
                            const enterMesh = hitObject as THREE.Mesh
                            const material = enterMesh.material as THREE.MeshBasicMaterial
                            
                            // Update texture to show mobile message
                            const newTexture = createTextTexture('view on desktop only', 32)
                            material.map = newTexture
                            material.needsUpdate = true
                            
                            // Update geometry to be wider for the longer text
                            enterMesh.geometry.dispose()
                            enterMesh.geometry = new THREE.PlaneGeometry(5, 1)
                            
                            // After a delay, show the second line
                            setTimeout(() => {
                                const secondTexture = createTextTexture("(it's worth it i promise)", 28)
                                material.map = secondTexture
                                material.needsUpdate = true
                            }, 2000)
                            
                            return
                        }
                        
                        // Start glitch effect (camera movement happens after glitch + scene ready)
                        state.introGlitchStartTime = Date.now()
                        trackEvent({ eventType: 'door_enter' })
                        return
                    }
                }
            }
            return // Don't process other clicks during intro
        }

        // Play audio on first click (if not started during intro)
        if (!audioStarted) {
            if (sound.context.state === 'suspended') {
                sound.context.resume()
            }
            if (sound.buffer) {
                sound.play()
                audioStarted = true
                state.isAudioPlaying = true
            }
        }

        raycaster.setFromCamera(pointer, camera)

        // Check power pile first to prevent computer zoom
        if (state.powerPilePivot) {
            const intersects = raycaster.intersectObjects(state.powerPilePivot.children, true)
            if (intersects.length > 0) {
                if (state.isCameraLocked && !state.pixelationAnimationStartTime && !isMobileDevice()) {
                    // Start pixelation animation (skip on mobile for performance)
                    state.pixelationAnimationStartTime = Date.now()
                    // Play sniff sound
                    if (state.sniffSound && !state.sniffSound.isPlaying) {
                        state.sniffSound.play()
                    }
                    trackEvent({ eventType: 'power_pile_click' })
                    markFound('powder')
                }
                return // Don't process other clicks
            }
        }

        if (state.computerPivot) {
            const intersects = raycaster.intersectObjects(state.computerPivot.children, true)
            const hasScreen = intersects.some(hit => hit.object.name.toLowerCase().includes('cube_screen_0'))
            if (hasScreen) {
                if (state.isCameraLocked) {
                    state.isFocusingOnScreen = true
                    state.isFocusingOnNotepad = false
                    terminal.setFocused(true)  // Terminal.setFocused handles session init
                    trackEvent({ eventType: 'computer_click' })
                    markFound('terminal')
                }
                return
            }
        }

        if (state.notepadPivot) {
            const intersects = raycaster.intersectObjects(state.notepadPivot.children, true)
            if (intersects.length > 0) {
                if (state.isCameraLocked && !state.isFocusingOnNotepad) {
                    // First click: zoom into notepad
                    state.isFocusingOnNotepad = true
                    state.isFocusingOnScreen = false
                    terminal.setFocused(false)
                    trackEvent({ eventType: 'notepad_click' })
                    markFound('notepad')
                } else if (state.isFocusingOnNotepad && !(state.backroomsPivot && state.backroomsPivot.visible)) {
                    // Already focused on notepad - check if clicking a blog post (disabled in backrooms)
                    let paperMesh: THREE.Mesh | null = null
                    state.notepadPivot.traverse(child => {
                        if (child instanceof THREE.Mesh && (child.name === 'Torus002_Material002_0' || child.name.includes('Torus.002'))) {
                            paperMesh = child
                        }
                    })

                    if (paperMesh) {
                        const paperIntersects = raycaster.intersectObject(paperMesh)
                        if (paperIntersects.length > 0 && paperIntersects[0].uv) {
                            const uv = paperIntersects[0].uv

                            notepad.blogPosts.forEach((post) => {
                                const texU = uv.x * 1.2 - 0.1
                                const texV = uv.y * 1.2 - 0.1
                                const scaledX = texU * 1024
                                const scaledY = texV * 1448

                                if (scaledX > 140 && scaledX < 900 && scaledY > post.y + 350 && scaledY < post.y + 450) {
                                    // Open blog post in new tab
                                    const url = notepad.getPostUrl(post.slug)
                                    trackEvent({ eventType: 'blog_post_click', eventData: post.slug })
                                    window.open(url, '_blank')
                                }
                            })
                        }
                    }
                }
                return
            }
        }

        if (state.octocatPivot) {
            const intersects = raycaster.intersectObjects(state.octocatPivot.children, true)
            if (intersects.length > 0) {
                trackEvent({ eventType: 'octocat_click' })
                markFound('octocat')
                window.open('https://github.com/braelyn-ai/personal-site', '_blank')
                return
            }
        }

        if (state.bagelPivot) {
            const intersects = raycaster.intersectObjects(state.bagelPivot.children, true)
            if (intersects.length > 0) {
                trackEvent({ eventType: 'bagel_click' })
                markFound('bagel')
                window.open('https://goldenboy.pizza/bagel-ratings', '_blank')
                return
            }
        }

        if (state.ipodPivot) {
            const intersects = raycaster.intersectObjects(state.ipodPivot.children, true)
            if (intersects.length > 0) {
                if (state.isCameraLocked && !state.isFocusingOnIpod) {
                    state.isFocusingOnIpod = true
                    state.isFocusingOnScreen = false
                    state.isFocusingOnNotepad = false
                    state.isFocusingOnButton = false
                    state.isFocusingOnBike = false
                    state.isFocusingOnCar = false
                    terminal.setFocused(false)
                    trackEvent({ eventType: 'ipod_click' })
                    markFound('ipod')
                }
                return
            }
        }

        if (state.bikePivot) {
            const intersects = raycaster.intersectObjects(state.bikePivot.children, true)
            if (intersects.length > 0) {
                if (state.isCameraLocked && !state.isFocusingOnBike) {
                    state.isFocusingOnBike = true
                    state.isFocusingOnScreen = false
                    state.isFocusingOnNotepad = false
                    state.isFocusingOnButton = false
                    state.isFocusingOnIpod = false
                    state.isFocusingOnCar = false
                    terminal.setFocused(false)
                    trackEvent({ eventType: 'bike_click' })
                    markFound('r1')
                }
                return
            }
        }

        if (state.carPivot) {
            const intersects = raycaster.intersectObjects(state.carPivot.children, true)
            if (intersects.length > 0) {
                if (state.isCameraLocked && !state.isFocusingOnCar) {
                    state.isFocusingOnCar = true
                    state.isFocusingOnScreen = false
                    state.isFocusingOnNotepad = false
                    state.isFocusingOnButton = false
                    state.isFocusingOnIpod = false
                    state.isFocusingOnBike = false
                    terminal.setFocused(false)
                    trackEvent({ eventType: 'car_click' })
                    markFound('rx7')
                }
                return
            }
        }

        if (state.emergencyButtonPivot) {
            const intersects = raycaster.intersectObjects(state.emergencyButtonPivot.children, true)
            if (intersects.length > 0) {
                if (!state.isFocusingOnButton) {
                    // Zoom in on button
                    state.isFocusingOnButton = true
                    state.isCameraLocked = true
                    state.isFocusingOnScreen = false
                    state.isFocusingOnNotepad = false
                    terminal.setFocused(false)
                    trackEvent({ eventType: 'emergency_button_focus' })
                    // Kick off lazy load of backrooms assets while user stares at the button
                    ensureBackroomsLoaded()
                } else if (!state.isEmergencyStopped) {
                    trackEvent({ eventType: 'emergency_button_activate' })
                    markFound('backrooms')
                    // Ensure backrooms is loaded (no-op if already fetched during focus)
                    ensureBackroomsLoaded()
                    // Sequence: Turn off rave lights -> Pause -> Zoom out -> Pause -> Turn off all lights
                    state.isEmergencyStopped = true
                    
                    // Start button press animation
                    state.emergencyButtonPressTime = Date.now()

                    // Play emergency switch sound
                    if (state.emergencySwitchSound) {
                        if (state.emergencySwitchSound.isPlaying) state.emergencySwitchSound.stop()
                        state.emergencySwitchSound.play()
                    }

                    // Stop the techno music
                    if (state.technoMusic && state.technoMusic.isPlaying) {
                        state.technoMusic.stop()
                    }

                    // Hide the warning text
                    if (state.emergencyText) state.emergencyText.visible = false

                    // 1. Rave lights off (handled by loop via state.isEmergencyStopped)

                    // 2. Pause then Zoom out
                    setTimeout(() => {
                        state.isFocusingOnButton = false

                        // 3. Pause then Turn off all lights
                        setTimeout(() => {
                            state.isBlackout = true

                            // Play emergency switch sound again for lights off
                            if (state.emergencySwitchSound) {
                                if (state.emergencySwitchSound.isPlaying) state.emergencySwitchSound.stop()
                                state.emergencySwitchSound.play()
                            }

                            state.roomLights.forEach(light => {
                                // @ts-ignore
                                light.visible = false
                            })

                            // 4. After 3s of darkness, swap environment (await backrooms load in case slow network)
                            setTimeout(() => {
                                ensureBackroomsLoaded().then(() => {
                                // Remove Garage Assets
                                state.floorPivots.forEach(p => p.visible = false)
                                state.barrierPivots.forEach(p => p.visible = false)
                                state.wallPivots.forEach(p => p.visible = false)
                                state.speakerPivots.forEach(p => p.visible = false)
                                if (state.carPivot) state.carPivot.visible = false
                                if (state.bikePivot) state.bikePivot.visible = false
                                if (state.powerPilePivot) state.powerPilePivot.visible = false
                                if (state.cessnaPivot) state.cessnaPivot.visible = false

                                // Show Backrooms
                                if (state.backroomsPivot) state.backroomsPivot.visible = true

                                // Disable fog for bright backrooms
                                scene.fog = null

                                // Reduce vignette for backrooms
                                crtPass.uniforms['vignetteStrength'].value = 0.3

                                // Enable Backrooms Lights
                                state.backroomsLights.forEach(light => light.visible = true)

                                // Hide the octocat
                                if (state.octocatPivot) state.octocatPivot.visible = false

                                // Hide the bagel
                                if (state.bagelPivot) state.bagelPivot.visible = false

                                // Hide the iPod and its screen
                                if (state.ipodPivot) state.ipodPivot.visible = false
                                if (state.ipodScreenMesh) state.ipodScreenMesh.visible = false

                                // Hide the napkin
                                if (state.napkinPivot) state.napkinPivot.visible = false

                                // Play lamp buzz sound on loop
                                if (state.lampBuzzSound) {
                                    if (state.lampBuzzSound.context.state === 'suspended') {
                                        state.lampBuzzSound.context.resume()
                                    }
                                    if (!state.lampBuzzSound.isPlaying) {
                                        state.lampBuzzSound.play()
                                    }
                                }

                                // Switch notepad and terminal to demonic backrooms mode
                                notepad.setBackroomsMode(true)
                                terminal.setBackroomsMode(true)
                                })
                            }, 3000)
                        }, 1000)
                    }, 1000)
                }
                return
            }
        }

        // If we get here, nothing clickable was hit - return camera to default position
        if (state.isFocusingOnScreen || state.isFocusingOnNotepad || state.isFocusingOnIpod || state.isFocusingOnButton || state.isFocusingOnBike || state.isFocusingOnCar) {
            state.isFocusingOnScreen = false
            state.isTypingOnScreen = false
            state.isFocusingOnNotepad = false
            state.isFocusingOnIpod = false
            state.isFocusingOnButton = false
            state.isFocusingOnBike = false
            state.isFocusingOnCar = false
            terminal.setFocused(false)
            notepad.setHovered(-1)
        }
    }

    window.addEventListener('click', (event: MouseEvent) => {
        handleClickInteraction(event.clientX, event.clientY)
    })

    // Use touchend for mobile - more analogous to click (finger lifted = action)
    // and Safari may be more lenient with it than touchstart
    window.addEventListener('touchend', (event: TouchEvent) => {
        if (event.changedTouches.length > 0) {
            const touch = event.changedTouches[0]
            event.preventDefault() // Prevent click from also firing
            handleClickInteraction(touch.clientX, touch.clientY)
        }
    })
}
