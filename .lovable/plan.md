

## Problem Analysis

Two root causes found:

### 1. "ElevenLabs" still showing in Verification step (step 5)
`StepVerification.tsx` still has `elevenlabs` in its `componentIcons`, `componentLabels`, and `optionalResults` filter (line 201). The health-check edge function likely also still returns ElevenLabs results.

### 2. Button disabled — WhatsApp completion check is wrong
In `useOnboardingStatus.ts` line 117, the `whatsapp` step checks for `whatsapp_access_token && whatsapp_phone_number_id && whatsapp_business_account_id` — but the wizard saves **Evolution API** fields (`evolution_api_url`, `evolution_api_key`, `evolution_instance`). So the WhatsApp required step is **never marked complete**, meaning `requiredIncomplete.length > 0`, which disables the button.

Similarly, the `verification` step (line 137) checks `whatsapp_access_token` which also fails.

## Plan

### 1. Fix `useOnboardingStatus.ts` — update WhatsApp completion check
Change the `whatsapp` case to check Evolution API fields instead:
```tsx
case 'whatsapp':
  return {
    ...step,
    isComplete: !!((settings as any).evolution_api_url && (settings as any).evolution_instance),
  };
```
Also update `verification` case to remove `whatsapp_access_token` dependency.

### 2. Clean `StepVerification.tsx` — remove ElevenLabs references
- Remove `elevenlabs` from `componentIcons` and `componentLabels`
- Remove `'elevenlabs'` from `optionalResults` filter (line 201)
- Remove `Mic` import if unused

### 3. Clean `SystemHealthCard.tsx` — remove ElevenLabs references
- Remove `elevenlabs` from its icon and label maps

### Files changed
- `src/hooks/useOnboardingStatus.ts` — fix whatsapp/verification completion logic
- `src/components/onboarding/StepVerification.tsx` — remove elevenlabs
- `src/components/SystemHealthCard.tsx` — remove elevenlabs

