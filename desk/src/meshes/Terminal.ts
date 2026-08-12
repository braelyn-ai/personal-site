import * as THREE from 'three'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'
import { terminalSession } from '../terminalSession'
import { markFound } from '../easterEggs'

// Import xterm CSS - will be bundled by vite
import '@xterm/xterm/css/xterm.css'

// Zalgo text combining characters (for backrooms mode)
const ZALGO_UP = [
    '\u0300', '\u0301', '\u0302', '\u0303', '\u0304', '\u0305', '\u0306', '\u0307',
    '\u0308', '\u0309', '\u030A', '\u030B', '\u030C', '\u030D', '\u030E', '\u030F',
    '\u0310', '\u0311', '\u0312', '\u0313', '\u0314', '\u0315', '\u031A', '\u031B',
    '\u033D', '\u033E', '\u033F', '\u0340', '\u0341', '\u0342', '\u0343', '\u0344',
    '\u0346', '\u034A', '\u034B', '\u034C', '\u0350', '\u0351', '\u0352', '\u0357',
    '\u0358', '\u035B', '\u035D', '\u035E', '\u0360', '\u0361'
]

const ZALGO_DOWN = [
    '\u0316', '\u0317', '\u0318', '\u0319', '\u031C', '\u031D', '\u031E', '\u031F',
    '\u0320', '\u0321', '\u0322', '\u0323', '\u0324', '\u0325', '\u0326', '\u0327',
    '\u0328', '\u0329', '\u032A', '\u032B', '\u032C', '\u032D', '\u032E', '\u032F',
    '\u0330', '\u0331', '\u0332', '\u0333', '\u0339', '\u033A', '\u033B', '\u033C',
    '\u0345', '\u0347', '\u0348', '\u0349', '\u034D', '\u034E', '\u0353', '\u0354',
    '\u0355', '\u0356', '\u0359', '\u035A', '\u035C', '\u035F', '\u0362'
]

const ZALGO_MID = [
    '\u0334', '\u0335', '\u0336', '\u0337', '\u0338', '\u0488', '\u0489'
]

function zalgoify(text: string, intensity: number): string {
    const upCount = Math.min(Math.floor(intensity * 1.5), 15)
    const downCount = Math.min(Math.floor(intensity * 1.5), 15)
    const midCount = Math.min(Math.floor(intensity * 0.5), 5)
    
    let result = ''
    for (const char of text) {
        result += char
        for (let i = 0; i < upCount; i++) {
            result += ZALGO_UP[Math.floor(Math.random() * ZALGO_UP.length)]
        }
        for (let i = 0; i < midCount; i++) {
            result += ZALGO_MID[Math.floor(Math.random() * ZALGO_MID.length)]
        }
        for (let i = 0; i < downCount; i++) {
            result += ZALGO_DOWN[Math.floor(Math.random() * ZALGO_DOWN.length)]
        }
    }
    return result
}

export class Terminal {
    // Output canvas (what gets rendered to 3D texture)
    canvas: HTMLCanvasElement
    ctx: CanvasRenderingContext2D
    texture: THREE.CanvasTexture
    
    // xterm.js instance
    private xterm: XTerm
    private fitAddon: FitAddon
    private xtermContainer: HTMLDivElement
    
    // State
    isFocused: boolean
    isBackroomsMode: boolean
    backroomsKeystrokeCount: number
    
    // Header
    private logo: HTMLImageElement
    private headerHeight = 70
    
    // Callback
    onTypingStart: (() => void) | null = null

    // Redraw only when content changes (xterm render, logo load, connection status)
    private dirty = true

    // Cleanup
    private unsubscribeOutput: (() => void) | null = null
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null

    constructor(width = 1024, height = 768) {
        // Create output canvas for THREE.js texture
        this.canvas = document.createElement('canvas')
        this.canvas.width = width
        this.canvas.height = height
        const ctx = this.canvas.getContext('2d')
        if (!ctx) throw new Error('Could not get 2d context')
        this.ctx = ctx

        this.texture = new THREE.CanvasTexture(this.canvas)
        this.texture.colorSpace = THREE.SRGBColorSpace
        this.texture.flipY = false

        this.isFocused = false
        this.isBackroomsMode = false
        this.backroomsKeystrokeCount = 0

        // Create offscreen container for xterm
        this.xtermContainer = document.createElement('div')
        this.xtermContainer.className = 'xterm-offscreen-container'
        this.xtermContainer.style.width = `${width}px`
        this.xtermContainer.style.height = `${height - this.headerHeight}px`
        document.body.appendChild(this.xtermContainer)

        // Initialize xterm.js with retro green theme
        this.xterm = new XTerm({
            theme: {
                background: '#000000',
                foreground: '#00ff00',
                cursor: '#00ff00',
                cursorAccent: '#000000',
                selectionBackground: '#00ff0044',
                black: '#000000',
                red: '#ff0000',
                green: '#00ff00',
                yellow: '#ffff00',
                blue: '#0066ff',
                magenta: '#ff00ff',
                cyan: '#00ffff',
                white: '#ffffff',
                brightBlack: '#666666',
                brightRed: '#ff6666',
                brightGreen: '#66ff66',
                brightYellow: '#ffff66',
                brightBlue: '#6699ff',
                brightMagenta: '#ff66ff',
                brightCyan: '#66ffff',
                brightWhite: '#ffffff',
            },
            fontFamily: 'monospace',
            fontSize: 18,
            lineHeight: 1.2,
            cursorBlink: true,
            cursorStyle: 'block',
            allowTransparency: false,
            scrollback: 1000,
            cols: 80,
            rows: 24,
        })

        this.fitAddon = new FitAddon()
        this.xterm.loadAddon(this.fitAddon)
        
        // Open xterm in the container
        this.xterm.open(this.xtermContainer)
        
        // Use Canvas renderer instead of WebGL for easier capture
        const canvasAddon = new CanvasAddon()
        this.xterm.loadAddon(canvasAddon)
        
        // Fit to container after a small delay to ensure DOM is ready
        setTimeout(() => {
            try {
                this.fitAddon.fit()
            } catch {
                // Fit may fail, that's ok
            }
        }, 100)

        // Load logo
        this.logo = new Image()
        this.logo.src = '/logo.svg'
        this.logo.onload = () => { this.dirty = true }
        this.logo.onerror = () => { this.dirty = true }

        // Setup input handling
        this.setupInput()
        this.setupOutputHandler()
        
        // Trigger draw whenever xterm renders
        this.xterm.onRender(() => {
            this.dirty = true
        })
        
        // Initial content
        this.xterm.write('Welcome to my terminal. You have full access.\r\n\r\n')
        
        // Initial draw after a small delay
        setTimeout(() => { this.dirty = true }, 150)
    }

    private outputBuffer = ''

    private setupOutputHandler(): void {
        // Subscribe to PTY output and write to xterm
        this.unsubscribeOutput = terminalSession.onOutput((data: string) => {
            if (!this.isBackroomsMode) {
                this.xterm.write(data)
            }

            // Buffer recent output for easter egg detection
            this.outputBuffer += data
            // Keep buffer from growing unbounded
            if (this.outputBuffer.length > 2000) {
                this.outputBuffer = this.outputBuffer.slice(-1000)
            }

            if (this.outputBuffer.includes('ZORK: The Braelyn Edition')) {
                markFound('zork')
            }
            if (this.outputBuffer.includes('You have completed ZORK')) {
                markFound('zork_completed')
            }
            if (this.outputBuffer.includes('just kidding')) {
                markFound('rmrf')
            }
        })
    }

    private setupInput(): void {
        // Forward xterm input to PTY
        this.xterm.onData((data: string) => {
            if (this.isFocused && !this.isBackroomsMode) {
                terminalSession.sendInput(data)
                if (this.onTypingStart) {
                    this.onTypingStart()
                }
            }
        })

        // Handle keyboard events when focused
        this.keydownHandler = (e: KeyboardEvent) => {
            if (!this.isFocused) return

            // Backrooms mode: every keystroke prints zalgo ERROR
            if (this.isBackroomsMode) {
                if (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace') {
                    e.preventDefault()
                    this.backroomsKeystrokeCount++
                    const intensity = Math.min(1 + Math.floor(this.backroomsKeystrokeCount / 3), 10)
                    const errorText = zalgoify('ERROR', intensity)
                    this.xterm.writeln(errorText)
                }
                return
            }

            // Let xterm handle everything else
            // Focus the xterm textarea to receive input
            const textarea = this.xtermContainer.querySelector('textarea')
            if (textarea && document.activeElement !== textarea) {
                textarea.focus()
            }
        }

        window.addEventListener('keydown', this.keydownHandler)
    }

    setBackroomsMode(enabled: boolean): void {
        this.isBackroomsMode = enabled
        if (enabled) {
            this.backroomsKeystrokeCount = 0
            this.xterm.clear()
            this.xterm.writeln(zalgoify('SYSTEM CORRUPTED', 3))
        }
    }

    setFocused(focused: boolean): void {
        this.isFocused = focused

        // Initialize terminal session when focused for the first time
        if (focused && !terminalSession.isConnected()) {
            terminalSession.initSession().then(success => {
                if (success) {
                    // Terminal connected - resize PTY to match xterm
                    const dims = this.fitAddon.proposeDimensions()
                    if (dims) {
                        terminalSession.resize(dims.rows, dims.cols)
                    }
                }
                // Connection status indicator in the header changed
                this.dirty = true
            })
        }

        // Focus/blur xterm
        if (focused) {
            const textarea = this.xtermContainer.querySelector('textarea')
            if (textarea) {
                textarea.focus()
            }
            this.xterm.focus()
        } else {
            this.xterm.blur()
        }
    }

    update(): void {
        // When not focused, only redraw when content changed (xterm render, logo
        // load, connection status). While focused, redraw every frame so the
        // blinking cursor stays live regardless of xterm's render events.
        if (!this.dirty && !this.isFocused) return
        this.dirty = false
        this.draw()
        if (this.texture) {
            this.texture.needsUpdate = true
        }
    }

    draw(): void {
        const { ctx, canvas } = this

        // Clear canvas with black background
        ctx.fillStyle = '#000000'
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        // Draw header first
        this.drawHeader()

        // Get xterm's canvas layers and composite them
        // Try multiple selectors as xterm.js structure varies by version
        const xtermElement = this.xtermContainer.querySelector('.xterm') as HTMLElement
        
        if (xtermElement) {
            // Find all canvases within xterm (could be in .xterm-screen or directly)
            const canvases = xtermElement.querySelectorAll('canvas')
            
            const destY = this.headerHeight
            const destHeight = canvas.height - this.headerHeight
            
            // Draw each canvas layer in order
            const marginX = 40
            canvases.forEach((xtermCanvas: HTMLCanvasElement) => {
                if (xtermCanvas.width > 0 && xtermCanvas.height > 0) {
                    try {
                        ctx.drawImage(
                            xtermCanvas,
                            0, 0, xtermCanvas.width, xtermCanvas.height,
                            marginX, destY, canvas.width - marginX * 2, destHeight
                        )
                    } catch (e) {
                        // Canvas might be tainted or not ready
                        console.warn('Failed to draw xterm canvas:', e)
                    }
                }
            })
            
            // If no canvases found, xterm might still be initializing
            if (canvases.length === 0) {
                // Draw placeholder text
                ctx.fillStyle = '#00ff00'
                ctx.font = '24px monospace'
                ctx.fillText('Initializing terminal...', 40, destY + 40)
            }
        }
    }

    private drawHeader(): void {
        const { ctx, canvas } = this

        // Header background
        ctx.fillStyle = '#000000'
        ctx.fillRect(0, 0, canvas.width, this.headerHeight)

        // Header text
        ctx.fillStyle = '#00ff00'
        ctx.font = 'bold 32px monospace'
        ctx.textAlign = 'left'
        ctx.fillText('TERMINAL v1.0', 40, 45)

        // Braelyn.ai branding (top right)
        ctx.textAlign = 'right'
        ctx.fillText('Braelyn.ai', canvas.width - 40, 45)
        ctx.textAlign = 'left'

        // Header line
        ctx.strokeStyle = '#00ff00'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(40, 60)
        ctx.lineTo(canvas.width - 40, 60)
        ctx.stroke()

        // Connection status indicator
        const isConnected = terminalSession.isConnected()
        ctx.fillStyle = isConnected ? '#00ff00' : '#ff6600'
        ctx.beginPath()
        ctx.arc(canvas.width - 200, 40, 8, 0, Math.PI * 2)
        ctx.fill()

        // Logo
        if (this.logo.complete && this.logo.naturalWidth !== 0) {
            const logoWidth = 180
            const logoHeight = 180
            ctx.drawImage(this.logo, canvas.width - logoWidth - 20, -55, logoWidth, logoHeight)
        }
    }

    destroy(): void {
        // Clean up subscription
        if (this.unsubscribeOutput) {
            this.unsubscribeOutput()
            this.unsubscribeOutput = null
        }

        // Remove event listener
        if (this.keydownHandler) {
            window.removeEventListener('keydown', this.keydownHandler)
            this.keydownHandler = null
        }

        // Dispose xterm
        this.xterm.dispose()
        
        // Remove container
        if (this.xtermContainer.parentNode) {
            this.xtermContainer.parentNode.removeChild(this.xtermContainer)
        }
    }
}
