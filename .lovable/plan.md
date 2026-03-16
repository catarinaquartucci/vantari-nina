

## Problem

After completing the onboarding wizard, two issues persist:

1. **OnboardingBanner on Dashboard** — It only checks `isComplete` (all steps technically complete), but does NOT check `hasSeenWizard`. So even after finishing the wizard, the banner keeps showing if some optional steps aren't marked as complete.

2. **Wizard auto-open logic** — This correctly checks `hasSeenWizard`, so the modal itself shouldn't reopen. But the banner is the likely culprit.

## Plan

### 1. Update `OnboardingBanner` to respect wizard completion

In `src/components/OnboardingBanner.tsx`, add `hasSeenWizard` from the `useOnboardingStatus` hook and hide the banner when the wizard has been completed:

```tsx
const { loading, isComplete, hasSeenWizard, steps, completionPercentage } = useOnboardingStatus();

if (loading || isComplete || hasSeenWizard) return null;
```

### 2. Update `AppLayout` wizard auto-open logic

In `src/App.tsx`, also prevent the wizard from auto-opening if `hasSeenWizard` is true (already implemented, but worth confirming no regression).

This is a minimal, single-line change that ensures the banner disappears once the user completes the onboarding flow.

