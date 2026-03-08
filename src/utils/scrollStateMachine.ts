import { ScrollTrigger } from 'gsap/ScrollTrigger'

export interface SectionConfig {
  index: number
  scrollDuration: number
  cameraPosition?: { x: number; y: number; z: number }
  cameraTarget?: { x: number; y: number; z: number }
  onEnter?: () => void
}

export interface ScrollStateMachineConfig {
  trigger: HTMLElement
  pinTarget: HTMLElement
  sections: SectionConfig[]
  onEnterSection?: (sectionIndex: number) => void
  onLeaveSection?: (sectionIndex: number) => void
}

export function createScrollStateMachine(config: ScrollStateMachineConfig) {
  const { trigger, pinTarget, sections, onEnterSection, onLeaveSection } = config
  const sectionCount = sections.length

  // Total scroll distance = sum of section heights (each = scrollDuration * vh)
  const totalScrollHeight = sections.reduce(
    (sum, s) => sum + s.scrollDuration * window.innerHeight,
    0
  )

  // Set trigger height to create scroll space
  trigger.style.height = `${totalScrollHeight}px`

  const scrollTriggers: ScrollTrigger[] = []

  // Derive section from progress (avoids boundary issues with separate triggers)
  const getSectionFromProgress = (progress: number): number => {
    if (sectionCount <= 1) return 1
    if (sectionCount === 2) {
      return progress < 0.25 ? 1 : 2
    }
    const threshold = 1 / sectionCount
    for (let i = 0; i < sectionCount; i++) {
      if (progress < (i + 1) * threshold) return i + 1
    }
    return sectionCount
  }

  let lastSection = 0

  // Main ScrollTrigger: pin canvas, snap, and detect section from progress
  const mainTrigger = ScrollTrigger.create({
    trigger,
    start: 'top top',
    end: `+=${totalScrollHeight}px`,
    pin: pinTarget,
    pinSpacing: true,
    scrub: 1,
    snap: {
      // Use [0, 0.5] for 2 sections so we never hit progress 1 (which releases the pin)
      snapTo:
        sectionCount > 1
          ? Array.from({ length: sectionCount }, (_, i) =>
              sectionCount === 2 ? i * 0.5 : i / (sectionCount - 1)
            )
          : 0,
      duration: { min: 0.1, max: 0.35 },
      delay: 0.03,
      ease: 'power2.out',
    },
    onUpdate: (self) => {
      const section = getSectionFromProgress(self.progress)
      if (section !== lastSection) {
        if (lastSection > 0) onLeaveSection?.(lastSection)
        lastSection = section
        onEnterSection?.(section)
        sections[section - 1]?.onEnter?.()
      }
    },
    onSnapComplete: (self) => {
      // Fire again when snap lands, in case onUpdate missed the final section
      const section = getSectionFromProgress(self.progress)
      if (section !== lastSection) {
        if (lastSection > 0) onLeaveSection?.(lastSection)
        lastSection = section
        onEnterSection?.(section)
        sections[section - 1]?.onEnter?.()
      }
    },
  })
  scrollTriggers.push(mainTrigger)

  // Fire initial section enter
  lastSection = 1
  onEnterSection?.(1)
  sections[0]?.onEnter?.()

  return {
    kill: () => scrollTriggers.forEach((st) => st.kill()),
    refresh: () => ScrollTrigger.refresh(),
  }
}
