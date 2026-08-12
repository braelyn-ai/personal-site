import * as THREE from 'three'
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { AppState } from '../types'
import { assetUrl } from '../utils/assetUrl'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

interface NowPlayingResponse {
    track: string
    artist: string
    album: string
    now_playing: boolean
    url: string
    image: string | null
}

// State for iPod screen scrolling
interface IpodScreenState {
    canvas: HTMLCanvasElement
    ctx: CanvasRenderingContext2D
    texture: THREE.CanvasTexture
    track: string
    artist: string
    trackScrollOffset: number
    artistScrollOffset: number
    trackNeedsScroll: boolean
    artistNeedsScroll: boolean
    trackWidth: number
    artistWidth: number
    maxWidth: number
}

let screenState: IpodScreenState | null = null

// Fetch last played track from API
async function fetchLastPlayed(): Promise<{ track: string; artist: string } | null> {
    try {
        const response = await fetch(`${API_BASE}/api/lastfm/now-playing`)
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`)
        }
        const data: NowPlayingResponse = await response.json()
        return {
            track: data.track,
            artist: data.artist
        }
    } catch (error) {
        console.error('Failed to fetch Last.fm data:', error)
    }
    return null
}

// Initialize the iPod screen canvas and texture
function initScreenState(track: string = 'loading...', artist: string = ''): IpodScreenState {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    
    canvas.width = 256
    canvas.height = 192
    
    const maxWidth = canvas.width - 20
    
    // Measure text widths
    ctx.font = 'bold 26px "Chicago", "Geneva", Arial, sans-serif'
    const trackWidth = ctx.measureText(track).width
    
    ctx.font = '22px "Chicago", "Geneva", Arial, sans-serif'
    const artistWidth = ctx.measureText(artist).width
    
    const texture = new THREE.CanvasTexture(canvas)
    
    return {
        canvas,
        ctx,
        texture,
        track,
        artist,
        trackScrollOffset: 0,
        artistScrollOffset: 0,
        trackNeedsScroll: trackWidth > maxWidth,
        artistNeedsScroll: artistWidth > maxWidth,
        trackWidth,
        artistWidth,
        maxWidth
    }
}

// Update track info and recalculate scroll needs
function updateTrackInfo(state: IpodScreenState, track: string, artist: string): void {
    state.track = track
    state.artist = artist
    state.trackScrollOffset = 0
    state.artistScrollOffset = 0
    
    // Measure text widths
    state.ctx.font = 'bold 26px "Chicago", "Geneva", Arial, sans-serif'
    state.trackWidth = state.ctx.measureText(track).width
    state.trackNeedsScroll = state.trackWidth > state.maxWidth
    
    state.ctx.font = '22px "Chicago", "Geneva", Arial, sans-serif'
    state.artistWidth = state.ctx.measureText(artist).width
    state.artistNeedsScroll = state.artistWidth > state.maxWidth
}

// Redraw the screen with current scroll offsets
function redrawScreen(state: IpodScreenState): void {
    const { canvas, ctx, track, artist, trackScrollOffset, artistScrollOffset, trackNeedsScroll, artistNeedsScroll, trackWidth, artistWidth, maxWidth } = state
    
    // Clear and draw background
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height)
    gradient.addColorStop(0, '#a8c8e8')
    gradient.addColorStop(1, '#6898c8')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    
    // "Now Playing" header
    ctx.font = 'bold 22px "Chicago", "Geneva", Arial, sans-serif'
    ctx.fillStyle = '#1a1a1a'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText('braelyn is listening to:', canvas.width / 2, 30)
    
    // Draw song title (with scrolling if needed)
    ctx.font = 'bold 26px "Chicago", "Geneva", Arial, sans-serif'
    ctx.fillStyle = '#000000'
    
    if (trackNeedsScroll) {
        // Save context and clip to text area
        ctx.save()
        ctx.beginPath()
        ctx.rect(10, 65, maxWidth, 40)
        ctx.clip()
        
        // Draw scrolling text - left aligned with offset
        ctx.textAlign = 'left'
        const gap = 60 // Gap between end and start of text
        const totalWidth = trackWidth + gap
        const x = 10 - trackScrollOffset
        ctx.fillText(track, x, 75)
        // Draw second copy for seamless loop
        ctx.fillText(track, x + totalWidth, 75)
        
        ctx.restore()
    } else {
        ctx.textAlign = 'center'
        ctx.fillText(track, canvas.width / 2, 75)
    }
    
    // Draw artist (with scrolling if needed)
    ctx.font = '22px "Chicago", "Geneva", Arial, sans-serif'
    ctx.fillStyle = '#333333'
    
    if (artistNeedsScroll) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(10, 105, maxWidth, 35)
        ctx.clip()
        
        ctx.textAlign = 'left'
        const gap = 60
        const totalWidth = artistWidth + gap
        const x = 10 - artistScrollOffset
        ctx.fillText(artist, x, 115)
        ctx.fillText(artist, x + totalWidth, 115)
        
        ctx.restore()
    } else {
        ctx.textAlign = 'center'
        ctx.fillText(artist, canvas.width / 2, 115)
    }
    
    state.texture.needsUpdate = true
}

// Update function to be called from animation loop
// Scrolling text redraws are throttled to 20fps; offsets derive from absolute
// time so the scroll speed is unaffected
let lastScreenRedrawTime = 0
const SCREEN_REDRAW_INTERVAL = 1 / 20

export function updateIpodScreen(time: number): void {
    if (!screenState) return

    // Only redraw when text is scrolling, at most 20 times per second
    if (!screenState.trackNeedsScroll && !screenState.artistNeedsScroll) return
    if (time - lastScreenRedrawTime < SCREEN_REDRAW_INTERVAL) return
    lastScreenRedrawTime = time

    const scrollSpeed = 40 // pixels per second
    const gap = 60

    // Update track scroll
    if (screenState.trackNeedsScroll) {
        const totalWidth = screenState.trackWidth + gap
        screenState.trackScrollOffset = (time * scrollSpeed) % totalWidth
    }

    // Update artist scroll
    if (screenState.artistNeedsScroll) {
        const totalWidth = screenState.artistWidth + gap
        screenState.artistScrollOffset = (time * scrollSpeed) % totalWidth
    }

    redrawScreen(screenState)
}

export function loadIpodClassic(loader: GLTFLoader, scene: THREE.Scene, state: AppState): Promise<void> {
    return new Promise((resolve, reject) => {
    loader.load(assetUrl('ipod_classic.glb'), (gltf) => {
        const model = gltf.scene
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())

        const pivot = new THREE.Group()
        scene.add(pivot)

        model.position.copy(center).negate()
        pivot.add(model)

        // Scale the iPod to a realistic desk size
        const targetHeight = 0.8
        const maxDim = Math.max(size.x, size.y, size.z)
        const scale = targetHeight / maxDim
        pivot.scale.set(scale, scale, scale)

        // Position to the left of the notepad (notepad is at x=3, z=1.6)
        // Desk surface is around y=0.5
        pivot.position.set(1.5, 0.05, 1.55)

        // Rotate to lay flat, face up
        pivot.rotation.x = -Math.PI / 2

        model.traverse(child => {
            if (child instanceof THREE.Mesh) {
                child.castShadow = true
                child.receiveShadow = true

                // Reduce screen glow by lowering emissive intensity
                if (child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material]
                    materials.forEach(mat => {
                        if (mat instanceof THREE.MeshStandardMaterial && mat.emissive) {
                            mat.emissiveIntensity = 0.2
                        }
                    })
                }
            }
        })

        // Initialize screen state with loading text
        screenState = initScreenState()
        redrawScreen(screenState)
        
        const screenMaterial = new THREE.MeshBasicMaterial({
            map: screenState.texture,
            side: THREE.DoubleSide
        })
        
        // Create a plane for the screen - use world coordinates for now
        const screenGeometry = new THREE.PlaneGeometry(0.38, 0.28)
        const screenMesh = new THREE.Mesh(screenGeometry, screenMaterial)
        
        // Position directly in world space, at iPod location, facing up
        screenMesh.position.set(1.5, 0.09, 1.34)  // On iPod screen area
        screenMesh.rotation.x = -Math.PI / 2  // Face up
        
        // Add directly to scene
        scene.add(screenMesh)
        state.ipodScreenMesh = screenMesh
        
        // Fetch Last.fm data and update texture
        fetchLastPlayed().then(data => {
            if (data && screenState) {
                updateTrackInfo(screenState, data.track, data.artist)
                redrawScreen(screenState)
            }
        })

        state.ipodPivot = pivot
        resolve()
    }, undefined, (error) => {
        console.error('Failed to load ipod_classic.glb. File may not be served correctly by the server:', error)
        reject(error)
    })
    })
}

