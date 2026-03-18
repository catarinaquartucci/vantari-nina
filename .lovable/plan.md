

## Problem

Three issues:
1. **ElevenLabs step** (step 4/index 3) in the wizard causes validation errors (402/401) and shows as failed in the finish step checklist
2. **"Começar a Usar o Sistema" button** — already decoupled from validation errors, but ElevenLabs still pollutes the validation results
3. **Wizard reappears on reload** — `markWizardSeen()` sets localStorage but `handleComplete` does `window.location.reload()` after 800ms, and the `hasRequiredConfig` / `hasSeenWizard` checks may not prevent reopening if the page reloads before state is fully persisted

## Plan

### 1. Remove ElevenLabs step from wizard (OnboardingWizard.tsx)

- Remove `StepElevenLabs` import and its `case 3` in `renderStep()`
- Remove all ElevenLabs form state variables (elevenLabsApiKey, elevenLabsVoiceId, etc.)
- Remove ElevenLabs fields from `saveSettings()` and `validateStepData()`
- Shift step indices: Business Hours becomes step 3, Verification step 4, Finish step 5
- Update `isOptionalStep()` to remove `'elevenlabs'`
- Total steps go from 7 to 6

### 2. Remove ElevenLabs from onboarding status (useOnboardingStatus.ts)

- Remove the `elevenlabs` step definition from the steps array
- Steps become: identity, whatsapp, agent, business_hours, verification, finish

### 3. Remove ElevenLabs from validation (validate-setup edge function + StepFinish.tsx)

- In `supabase/functions/validate-setup/index.ts`: remove the ElevenLabs validation block
- In `StepFinish.tsx`: remove `elevenlabs` from `componentLabels`

### 4. Fix wizard persistence

- In `handleComplete()` in OnboardingWizard.tsx: set localStorage directly before reload to guarantee persistence: `localStorage.setItem('onboarding_wizard_seen', 'true')`
- In `AppLayout` (App.tsx): also check `localStorage.getItem('onboarding_wizard_seen') === 'true'` as a direct guard, not just via the hook (the hook already does this, but ensure the reload timing doesn't cause a race)

### Files changed
- `src/components/OnboardingWizard.tsx` — remove ElevenLabs step & state
- `src/hooks/useOnboardingStatus.ts` — remove elevenlabs step
- `src/components/onboarding/StepFinish.tsx` — remove elevenlabs label
- `supabase/functions/validate-setup/index.ts` — remove ElevenLabs check

