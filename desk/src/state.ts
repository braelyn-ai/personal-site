import type { AppState } from './types'

export const state: AppState = {
    isCameraLocked: true,
    isFocusingOnScreen: false,
    isTypingOnScreen: false,
    isFocusingOnNotepad: false,
    isFocusingOnButton: false,
    isFocusingOnIpod: false,
    isFocusingOnBike: false,
    isFocusingOnCar: false,
    isEmergencyStopped: false,
    isBlackout: false,
    renderPaused: false,
    isAudioPlaying: false,
    isIntro: true,
    introAnimationProgress: 0,
    introGlitchStartTime: null,
    introSceneReady: false,
    introMusicReady: false,
    introDoorOpenStartTime: null,
    introAwaitingLandscape: false,
    doorOpenSound: null,
    doorKnockSound: null,
    sniffSound: null,
    emergencySwitchSound: null,
    lampBuzzSound: null,
    technoMusic: null,
    musicFilter: null,
    doorPivot: null,
    doorHingePivot: null,
    doorLight: null,
    doorWalls: [],
    doorUI: null,
    doorEnterMesh: null,
    doorRotatePrompt: null,
    computerPivot: null,
    notepadPivot: null,
    powerPilePivot: null,

    // Garage Assets
    floorPivots: [],
    barrierPivots: [],
    wallPivots: [],
    speakerPivots: [],
    carPivot: null,
    bikePivot: null,
    cessnaPivot: null,

    // Backrooms Assets
    backroomsPivot: null,
    backroomsLights: [],
    horrorMonsterPivot: null,
    horrorMonsterRevealTime: null,
    horrorMonsterFadeStartTime: null,
    creepyKnockSound: null,
    horrorFadeSound: null,
    jumpscareSound: null,
    jumpscareTriggered: false,
    deathSequenceStartTime: null,

    armSegments: { base: null, arm: null },
    roomLights: [],
    raveLights: [],
    currentLightShow: 'lightShow2',
    lightShows: {
        lightShow1: null, // Will store original configuration
        lightShow2: null, // Will store white strobe configuration
        lightShow3: null  // Will store bouncing red light
    },
    bouncingLight: null, // Single light for Light Show 3
    octocatPivot: null,
    bagelPivot: null,
    napkinPivot: null,
    ipodPivot: null,
    ipodScreenMesh: null
}
