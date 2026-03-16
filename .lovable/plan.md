

## Problem

The onboarding popup keeps appearing because:
1. `hasSeenWizard` (localStorage flag) was never set — the user likely completed configuration but didn't click the final "Começar a usar o sistema" button, OR localStorage was cleared
2. `isComplete` returns false because not all optional steps are marked complete

The popup auto-opens when `!isComplete && !hasSeenWizard`.

## Plan

### 1. Make the wizard auto-open smarter (`src/App.tsx`)

Add a check against the actual database settings. If the core required settings (company_name, sdr_name, whatsapp_access_token) are already configured, don't auto-open the wizard — even if `hasSeenWizard` is false.

Update `useOnboardingStatus` to expose a `hasRequiredConfig` boolean that checks if identity + whatsapp steps are complete.

### 2. Update `useOnboardingStatus` hook

Add a derived value:
```tsx
const hasRequiredConfig = steps
  .filter(s => s.isRequired)
  .every(s => s.isComplete);
```

Export it in the return object.

### 3. Update auto-open logic in `AppLayout` (`src/App.tsx`)

```tsx
const { isComplete, hasSeenWizard, loading, hasRequiredConfig } = useOnboardingStatus();

useEffect(() => {
  if (!loading && !isComplete && !hasSeenWizard && !hasRequiredConfig) {
    setShowOnboarding(true);
  }
}, [loading, isComplete, hasSeenWizard, hasRequiredConfig]);
```

### 4. Update `OnboardingBanner` visibility

Same logic — hide the banner if required config is already done:
```tsx
if (loading || isComplete || hasSeenWizard || hasRequiredConfig) return null;
```

This is a ~5-line change across 3 files. The wizard will only auto-open for truly unconfigured systems.

