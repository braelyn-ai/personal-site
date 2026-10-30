// Phone support: the scene is built for wide screens. The door can be seen in
// portrait; after tapping enter, the door shows a rotate prompt and only opens
// once the phone is sideways. From then on, portrait gets a full-screen prompt.

// The phone version of the desk isn't good enough yet. While false, phones see the
// door with a "view on desktop only" message instead of entering. Flip to true to
// bring back the landscape flow below.
export const MOBILE_DESK_ENABLED = false

const portraitQuery = window.matchMedia('(orientation: portrait)')

export function isMobileDevice(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        (window.matchMedia('(pointer: coarse)').matches && Math.min(window.innerWidth, window.innerHeight) <= 900)
}

export function setupMobile(): void {
    if (!isMobileDevice()) return
    document.documentElement.classList.add('is-mobile')

    const overlay = document.createElement('div')
    overlay.className = 'rotate-overlay'
    overlay.innerHTML = `
        <div class="rotate-phone" aria-hidden="true"></div>
        <div class="rotate-title">rotate your phone</div>
        <div class="rotate-subtitle">this place only exists sideways</div>
    `
    document.body.appendChild(overlay)

    // Stop iOS from scrolling or rubber-banding the page behind the canvas
    document.addEventListener('touchmove', e => e.preventDefault(), { passive: false })
    // Block pinch zoom gestures in Safari (it ignores user-scalable=no)
    document.addEventListener('gesturestart', e => e.preventDefault())
}

// Runs `onLandscape` once the phone is sideways (right away, synchronously, if it
// already is or this isn't a phone). After that, portrait gets the full-screen prompt.
export function requireLandscape(onLandscape: () => void): void {
    if (!isMobileDevice()) {
        onLandscape()
        return
    }
    const done = () => {
        document.documentElement.classList.add('needs-landscape')
        onLandscape()
    }
    if (!portraitQuery.matches) {
        done()
        return
    }
    const onChange = () => {
        if (portraitQuery.matches) return
        portraitQuery.removeEventListener('change', onChange)
        // Give iOS a moment to settle the new viewport size before the door opens
        setTimeout(done, 350)
    }
    portraitQuery.addEventListener('change', onChange)
}

// Called from the door's enter tap (a user gesture, which fullscreen requires).
// On Android this also locks to landscape, which rotates the screen by itself.
// iPhone Safari has no fullscreen API, so this does nothing there.
export function enterImmersiveMode(): void {
    if (!isMobileDevice()) return
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }
    const request = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el)
    if (!request || document.fullscreenElement) return
    Promise.resolve(request())
        .then(() => {
            const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
            return orientation?.lock?.('landscape')
        })
        .catch(() => { /* not supported or denied: fine, keep going */ })
}

// iPhone Safari won't let a page hide its own toolbar, so tell the visitor how.
// Skipped when launched from the home screen (no toolbar there) or once dismissed.
const TIP_KEY = 'toolbarTipSeen'

export function maybeShowToolbarTip(): void {
    const isIOS = /iPhone|iPod/.test(navigator.userAgent)
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone ||
        window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches
    if (!isIOS || standalone) return
    try {
        if (localStorage.getItem(TIP_KEY)) return
    } catch { /* storage blocked: show the tip anyway */ }

    const tip = document.createElement('div')
    tip.className = 'toolbar-tip'
    tip.innerHTML = `
        <span>tip: tap <b>aA</b> → <b>Hide Toolbar</b>, or <b>Share</b> → <b>Add to Home Screen</b> for fullscreen</span>
        <button type="button" aria-label="Dismiss">✕</button>
    `
    const dismiss = () => {
        tip.remove()
        try { localStorage.setItem(TIP_KEY, '1') } catch { /* ignore */ }
    }
    // touchend, not click: the page blocks default touch behavior
    tip.querySelector('button')!.addEventListener('touchend', e => { e.stopPropagation(); dismiss() })
    tip.addEventListener('touchend', e => e.stopPropagation())
    document.body.appendChild(tip)
    // Once seen, never again (even if they ignore it), then get out of the way
    try { localStorage.setItem(TIP_KEY, '1') } catch { /* ignore */ }
    setTimeout(() => tip.remove(), 10000)
}
