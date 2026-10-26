// Phone support: the scene is built for wide screens, so phones must be held
// sideways. In portrait we cover the page with a "rotate your phone" prompt.

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

// Called from the door's enter tap (a user gesture, which fullscreen requires).
// iPhone Safari has no fullscreen API, so this just does nothing there.
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
