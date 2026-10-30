import * as THREE from 'three'

export interface RaveLightItem {
    light: THREE.RectAreaLight | THREE.SpotLight
    type: 'rect' | 'spot'
    speed?: number
    offset?: number
    baseX?: number
    targetBaseX?: number
}

export interface LightShowConfig {
    speed?: number
    offset?: number
    type?: 'rect' | 'spot'
    baseX?: number
    targetBaseX?: number
}

export interface LightShow3Config {
    light: THREE.PointLight
}

export interface AppState {
    isCameraLocked: boolean
    isFocusingOnScreen: boolean
    isTypingOnScreen: boolean
    isTypingOnScreen: boolean
    isFocusingOnNotepad: boolean
    isFocusingOnButton: boolean
    isFocusingOnIpod: boolean
    isFocusingOnBike: boolean
    isFocusingOnCar: boolean
    isEmergencyStopped: boolean
    isBlackout: boolean
    renderPaused: boolean
    isAudioPlaying: boolean
    isIntro: boolean
    introAnimationProgress: number
    introGlitchStartTime: number | null
    introSceneReady: boolean
    introMusicReady: boolean
    introDoorOpenStartTime: number | null
    introAwaitingLandscape: boolean
    doorOpenSound: THREE.Audio | null
    doorKnockSound: THREE.Audio | null
    sniffSound: THREE.Audio | null
    emergencySwitchSound: THREE.Audio | null
    lampBuzzSound: THREE.PositionalAudio | null
    technoMusic: THREE.PositionalAudio | null
    musicFilter: BiquadFilterNode | null
    doorPivot: THREE.Group | null
    doorHingePivot: THREE.Group | null
    doorLight: THREE.SpotLight | null
    doorWalls: THREE.Group[]
    doorUI: THREE.Group | null
    doorEnterMesh: THREE.Mesh | null
    doorRotatePrompt: THREE.Group | null
    computerPivot: THREE.Group | null
    notepadPivot: THREE.Group | null
    powerPilePivot: THREE.Group | null

    // Garage Assets
    floorPivots: THREE.Group[]
    barrierPivots: THREE.Group[]
    wallPivots: THREE.Group[]
    speakerPivots: THREE.Group[]
    carPivot: THREE.Group | null
    bikePivot: THREE.Group | null
    cessnaPivot: THREE.Group | null

    // Backrooms Assets
    backroomsPivot: THREE.Group | null
    backroomsLights: THREE.Light[]
    horrorMonsterPivot: THREE.Group | null
    horrorMonsterRevealTime: number | null
    horrorMonsterFadeStartTime: number | null
    creepyKnockSound: THREE.Audio | null
    horrorFadeSound: THREE.Audio | null
    jumpscareSound: THREE.Audio | null
    jumpscareTriggered: boolean
    deathSequenceStartTime: number | null

    armSegments: {
        base: THREE.Group | null
        arm: THREE.Group | null
    }
    roomLights: THREE.Light[]
    raveLights: RaveLightItem[]
    currentLightShow: 'lightShow1' | 'lightShow2' | 'lightShow3'
    lightShows: {
        lightShow1: LightShowConfig[] | null
        lightShow2: LightShowConfig[] | null
        lightShow3: LightShow3Config | null
    }
    bouncingLight: THREE.PointLight | null
    emergencyButtonPivot?: THREE.Group
    emergencyButtonTopPivot?: THREE.Group
    emergencyButtonPressTime?: number
    emergencyText?: THREE.Mesh
    pixelationAnimationStartTime?: number
    octocatPivot: THREE.Group | null
    bagelPivot: THREE.Group | null
    napkinPivot: THREE.Group | null
    ipodPivot: THREE.Group | null
    ipodScreenMesh: THREE.Mesh | null
}
