

## Problem

The "Começar a Usar o Sistema" button is disabled because the `canComplete` condition in `StepFinish.tsx` requires the validation edge function to return a non-error status:

```tsx
const canComplete = validation?.overallStatus !== 'error' && requiredIncomplete.length === 0;
```

The `validate-setup` function marks the overall status as `'error'` if **any** single check fails (e.g., `LOVABLE_API_KEY` missing, WhatsApp connection issue, or ElevenLabs key invalid). This blocks the button even when all onboarding steps are visually complete.

## Plan

### 1. Update `StepFinish.tsx` — decouple button from validation errors

Change the `canComplete` logic so the button is always available once the wizard steps are complete. Validation results remain visible as informational, but don't block completion:

```tsx
// Before
const canComplete = validation?.overallStatus !== 'error' && requiredIncomplete.length === 0;

// After  
const canComplete = requiredIncomplete.length === 0;
```

Remove the conditional error message below the button (or change it to a softer warning that doesn't imply the button is blocked).

This is a 2-line change in `src/components/onboarding/StepFinish.tsx` (lines ~230-235).

